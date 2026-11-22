const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const QRCode = require('qrcode');
const { loadSettings, saveSettings, getNetworkAddresses } = require('./config');
const crypto = require('crypto');
const { buildTurnServers } = require('./turn');
const { loadOrCreateCert } = require('./tls');
const { licenseStatus } = require('./license');

const RATE_MAX_FAILS = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_BLOCK_MS = 5 * 60 * 1000;
const DEFAULT_ALLOWED_HOSTS = ['cast.homaklab.com', 'awp.homaklab.com', 'localhost', '127.0.0.1'];
const PRIVATE_HOST_RE = /^(10\.|192\.168\.|127\.|172\.(1[6-9]|2\d|3[01])\.)/;
const MAX_SENDERS = 4;
const MAX_RATE_ENTRIES = 5000;
const MAX_ICE_SERVERS = 10;
const ICE_URL_RE = /^(stun|stuns|turn|turns):[^\s]{1,200}$/i;
const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

function clampNumber(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Host (with optional :port) that should be reached over plain http (LAN / loopback).
function isLocalHost(hostWithPort) {
  const host = String(hostWithPort || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || PRIVATE_HOST_RE.test(host);
}

function sanitizeIceServers(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const item of list.slice(0, MAX_ICE_SERVERS)) {
    if (!isPlainObject(item)) continue;
    const urls = (Array.isArray(item.urls) ? item.urls : [item.urls])
      .filter(u => typeof u === 'string' && ICE_URL_RE.test(u));
    if (urls.length === 0) continue;
    const entry = { urls: urls.length === 1 ? urls[0] : urls };
    if (typeof item.username === 'string') entry.username = item.username.slice(0, 200);
    if (typeof item.credential === 'string') entry.credential = item.credential.slice(0, 200);
    out.push(entry);
  }
  return out;
}

function sanitizeSettingsUpdate(incoming) {
  const out = {};
  if ('deviceName' in incoming) out.deviceName = cleanText(incoming.deviceName, 80, 'Homak Cast Receiver');
  if (typeof incoming.requireApproval === 'boolean') out.requireApproval = incoming.requireApproval;
  if (typeof incoming.adaptiveBitrate === 'boolean') out.adaptiveBitrate = incoming.adaptiveBitrate;
  if ('defaultFps' in incoming) out.defaultFps = clampNumber(incoming.defaultFps, 5, 120, 60);
  if ('maxBitrateKbps' in incoming) out.maxBitrateKbps = clampNumber(incoming.maxBitrateKbps, 500, 50000, 8000);
  if ('stunServers' in incoming) {
    const stun = sanitizeIceServers(incoming.stunServers);
    if (stun) out.stunServers = stun;
  }
  return out;
}

function sanitizeAnnotation(data) {
  const unit = (v) => clampNumber(v, 0, 1, 0);
  switch (data.type) {
    case 'laser':
      return { type: 'laser', x: unit(data.x), y: unit(data.y) };
    case 'draw':
      return {
        type: 'draw',
        x0: unit(data.x0), y0: unit(data.y0), x1: unit(data.x1), y1: unit(data.y1),
        color: typeof data.color === 'string' && COLOR_RE.test(data.color) ? data.color : '#ff1744',
        size: clampNumber(data.size, 1, 32, 4)
      };
    case 'clear':
      return { type: 'clear' };
    default:
      return null;
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function cleanText(value, max = 80, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
  return cleaned || fallback;
}

class SignalingServer {
  constructor(options = {}) {
    this.port = options.port || process.env.PORT || loadSettings().port || 5240;
    this.httpsPort = options.httpsPort || process.env.HTTPS_PORT || null;
    this.httpsServer = null;
    this.publicHost = options.publicHost || process.env.PUBLIC_HOST || 'cast.homaklab.com';
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: (origin, cb) => cb(null, this.isOriginAllowed(origin)),
        methods: ['GET', 'POST']
      },
      allowRequest: (req, cb) => cb(null, this.isOriginAllowed(req.headers.origin, req.headers.host)),
      maxHttpBufferSize: 1e6
    });

    this.settings = loadSettings();
    // Where the license comes from: the embedded server gets the receiver's live settings, standalone runs read the file.
    this.getLicense = typeof options.getLicense === 'function' ? options.getLicense : () => loadSettings().license;

    // Multi-receiver state
    // pin -> { socketId, deviceName, createdAt, inUse: boolean, activeSenders: Map<senderSocketId, senderInfo>, maxSenders: number }
    this.receiversByPin = new Map();
    // socketId -> pin
    this.pinsByReceiverSocket = new Map();
    // senderSocketId -> receiverSocketId
    this.activePairs = new Map();

    this.rateLimits = new Map(); // ip -> { attempts, lastAttempt, blockedUntil }
    this.pendingApprovals = new Map(); // senderSocketId -> { timeoutId, senderInfo, receiverSocketId, pin }
    this.approvalPrefBySocket = new Map(); // receiverSocketId -> boolean (per-receiver requireApproval)

    this.initExpress();
    this.initSocket();

    this.rateLimitCleaner = setInterval(() => this.pruneRateLimits(), 60 * 1000);
    if (this.rateLimitCleaner.unref) this.rateLimitCleaner.unref();
  }

  allowedHosts() {
    const extra = (process.env.EXTRA_ALLOWED_HOSTS || '').split(',').map(h => h.trim()).filter(Boolean);
    return new Set([this.publicHost, ...DEFAULT_ALLOWED_HOSTS, ...extra].filter(Boolean));
  }

  isOriginAllowed(origin, requestHost) {
    // Native/Electron clients (no Origin, file://) and same-origin pages are always fine.
    if (!origin || origin === 'null' || origin.startsWith('file://')) return true;
    try {
      const u = new URL(origin);
      if (requestHost && u.host === requestHost) return true;
      return this.allowedHosts().has(u.hostname);
    } catch (e) {
      return false;
    }
  }

  isAllowedBaseUrl(raw) {
    if (typeof raw !== 'string' || raw.length > 300) return false;
    try {
      const u = new URL(raw);
      if (u.username || u.password) return false;
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      if (PRIVATE_HOST_RE.test(u.hostname)) return true;
      return u.protocol === 'https:' && this.allowedHosts().has(u.hostname);
    } catch (e) {
      return false;
    }
  }

  // Proxy headers are only honoured when the TCP peer is loopback (cloudflared / reverse proxy
  // on the same host). Direct LAN/Internet peers cannot spoof their address to dodge rate limits.
  getClientIp(headers, peerAddress) {
    const peer = peerAddress || 'unknown';
    if (!LOOPBACK_ADDRS.has(peer)) return peer;
    const cf = headers && headers['cf-connecting-ip'];
    if (cf) return String(cf).trim();
    const xff = headers && headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
    return peer;
  }

  isLoopbackRequest(socket) {
    const h = socket.handshake.headers || {};
    if (h['cf-connecting-ip'] || h['x-forwarded-for'] || h['x-forwarded-host']) return false;
    const addr = socket.handshake.address || '';
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  }

  getReceiverForSocket(socketId) {
    const pin = this.pinsByReceiverSocket.get(socketId);
    return pin ? this.receiversByPin.get(pin) : null;
  }

  generateUniquePin() {
    for (let i = 0; i < 1000; i++) {
      const pin = crypto.randomInt(100000, 1000000).toString();
      if (!this.receiversByPin.has(pin)) return pin;
    }
    throw new Error('PIN space exhausted');
  }

  /** Current license limits (expiry, device cap). */
  limits() {
    try {
      return licenseStatus(this.getLicense());
    } catch (err) {
      return licenseStatus(null);
    }
  }

  /** Simultaneous senders allowed for a receiver: the hard cap, lowered by the license. */
  effectiveMax(receiver) {
    return Math.min((receiver && receiver.maxSenders) || MAX_SENDERS, this.limits().maxDevices);
  }

  createReceiverRecord(socketId, deviceName, activeSenders = new Map()) {
    return {
      socketId,
      deviceName: deviceName || this.settings.deviceName || 'Homak Cast Receiver',
      createdAt: Date.now(),
      inUse: activeSenders.size >= MAX_SENDERS,
      activeSenders,
      maxSenders: MAX_SENDERS
    };
  }

  // Give a receiver a fresh PIN while keeping its name and (optionally) its active senders.
  rotatePin(receiverSocketId, { keepSenders = false } = {}) {
    const oldPin = this.pinsByReceiverSocket.get(receiverSocketId);
    if (!oldPin) return null;
    const old = this.receiversByPin.get(oldPin);
    this.receiversByPin.delete(oldPin);
    const newPin = this.generateUniquePin();
    const record = this.createReceiverRecord(
      receiverSocketId,
      old && old.deviceName,
      keepSenders && old ? old.activeSenders : new Map()
    );
    this.receiversByPin.set(newPin, record);
    this.pinsByReceiverSocket.set(receiverSocketId, newPin);
    return { pin: newPin, record };
  }

  // Tray helpers (embedded server): act on every receiver registered here.
  generateNewPin() {
    for (const id of [...this.pinsByReceiverSocket.keys()]) {
      const rotated = this.rotatePin(id, { keepSenders: true });
      if (rotated) {
        this.io.to(id).emit('pin-update', { pin: rotated.pin, qrUrl: this.buildConnectUrl(null, rotated.pin) });
      }
    }
  }

  terminateStream(reason = 'Yayın sona erdi.') {
    for (const id of [...this.pinsByReceiverSocket.keys()]) {
      this.terminateStreamForSocket(id, reason);
    }
  }

  getPrimaryLanAddress() {
    const addresses = getNetworkAddresses();
    const lan = addresses.find(a => a.isLocal && a.address.startsWith('192.168.')) ||
                addresses.find(a => a.isLocal && !a.address.startsWith('172.') && !a.address.startsWith('10.77.')) ||
                addresses.find(a => a.isLocal) || addresses[0];
    return lan ? lan.address : '127.0.0.1';
  }

  buildConnectUrl(headers, pin) {
    const h = headers || {};
    let host = h['x-forwarded-host'] || h.host || '';
    if (!host || host.startsWith('127.0.0.1') || host.startsWith('localhost')) {
      host = this.publicHost || 'cast.homaklab.com';
    }
    const forwardedProto = h['x-forwarded-proto'];
    const protocol = forwardedProto ? String(forwardedProto).split(',')[0].trim()
      : (isLocalHost(host) || /:5240$/.test(host) ? 'http' : 'https');
    return `${protocol}://${host}/${pin ? `?code=${pin}` : ''}`;
  }

  getConnectUrl(req, pin) {
    return this.buildConnectUrl(req && req.headers, pin);
  }

  getConnectUrlForSocket(socket, pin, customBaseUrl) {
    if (customBaseUrl && this.isAllowedBaseUrl(customBaseUrl)) {
      return `${customBaseUrl.replace(/\/+$/, '')}/?code=${pin}`;
    }
    return this.buildConnectUrl(socket.handshake.headers, pin);
  }

  checkRateLimit(ip) {
    const data = this.rateLimits.get(ip);
    const now = Date.now();
    if (data && data.blockedUntil > now) {
      const waitSeconds = Math.ceil((data.blockedUntil - now) / 1000);
      return { allowed: false, error: `Çok fazla hatalı deneme yapıldı. Lütfen ${waitSeconds} saniye bekleyin.` };
    }
    return { allowed: true };
  }

  recordFailedAttempt(ip) {
    const now = Date.now();
    let data = this.rateLimits.get(ip);
    if (!data || now - data.firstAttempt > RATE_WINDOW_MS) {
      data = { attempts: 0, firstAttempt: now, blockedUntil: 0 };
    }
    data.attempts += 1;
    if (data.attempts >= RATE_MAX_FAILS) {
      data.blockedUntil = now + RATE_BLOCK_MS;
      data.attempts = 0;
      data.firstAttempt = now;
    }
    this.rateLimits.set(ip, data);
    if (this.rateLimits.size > MAX_RATE_ENTRIES) this.pruneRateLimits(true);
  }

  // Intentionally NOT called on a successful pairing: otherwise an attacker could reset
  // their own counter by pairing with a receiver they control. Kept for admin/tests.
  resetRateLimit(ip) {
    this.rateLimits.delete(ip);
  }

  pruneRateLimits(force = false) {
    const now = Date.now();
    for (const [ip, data] of this.rateLimits) {
      if (data.blockedUntil < now && now - data.firstAttempt > RATE_WINDOW_MS) {
        this.rateLimits.delete(ip);
      }
    }
    // Hard cap: drop non-blocked entries so a flood of distinct peers cannot grow memory.
    if (force && this.rateLimits.size > MAX_RATE_ENTRIES) {
      for (const [ip, data] of this.rateLimits) {
        if (data.blockedUntil < now) this.rateLimits.delete(ip);
        if (this.rateLimits.size <= MAX_RATE_ENTRIES) break;
      }
    }
  }

  initExpress() {
    this.app.use(express.json());
    this.app.disable('x-powered-by');
    this.app.use((req, res, next) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'no-referrer');
      const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
      if (proto === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=15552000');
      }
      res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "connect-src 'self' ws: wss:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'"
      ].join('; '));
      next();
    });
    this.app.use(express.static(path.join(__dirname, 'public'), {
      etag: false,
      maxAge: 0
    }));

    // Status endpoint
    this.app.get('/api/status', (req, res) => {
      const addresses = getNetworkAddresses();
      res.json({
        ok: true,
        service: 'Homak Cast Signaling & Web Sender',
        domain: this.publicHost,
        port: this.port,
        httpsPort: this.httpsServer ? Number(this.httpsPort) : null,
        addresses,
        receiverOnline: this.receiversByPin.size > 0,
        totalReceivers: this.receiversByPin.size,
        activeStreams: this.activePairs.size,
        connectUrl: this.getConnectUrl(req)
      });
    });

    // QR Code data URL generator (Land of Legends High-Contrast Crisp Black on White)
    this.app.get('/api/qr', async (req, res) => {
      try {
        const pin = String(req.query.code || '').replace(/\D/g, '').slice(0, 6);
        const requestedUrl = req.query.url;
        const targetUrl = requestedUrl && this.isAllowedBaseUrl(requestedUrl)
          ? requestedUrl
          : this.getConnectUrl(req, pin);
        const qrImage = await QRCode.toDataURL(targetUrl, {
          width: 360,
          margin: 1,
          color: {
            dark: '#0a0e17',
            light: '#ffffff'
          }
        });
        res.json({ ok: true, qr: qrImage, url: targetUrl, pin });
      } catch (err) {
        console.error('[HomakCast] QR generation failed:', err);
        res.status(500).json({ ok: false, error: 'QR kod oluşturulamadı.' });
      }
    });

    // Verify PIN code via REST
    this.app.post('/api/verify-code', (req, res) => {
      const clientIp = this.getClientIp(req.headers, req.socket.remoteAddress);
      const check = this.checkRateLimit(clientIp);
      if (!check.allowed) {
        return res.status(429).json({ ok: false, error: check.error });
      }

      const { code } = req.body || {};
      if (!code || typeof code !== 'string') {
        return res.status(400).json({ ok: false, error: 'Geçersiz kod biçimi.' });
      }

      const normalizedInput = code.replace(/\s+/g, '');
      const receiver = this.receiversByPin.get(normalizedInput);

      if (!receiver) {
        this.recordFailedAttempt(clientIp);
        return res.status(400).json({ ok: false, error: 'Eşleştirme kodu hatalı veya alıcı çevrimdışı.' });
      }
      const limits = this.limits();
      if (limits.expired) {
        return res.status(403).json({ ok: false, error: 'Alıcının lisans süresi dolmuş. Yöneticiyle iletişime geçin.' });
      }
      const max = this.effectiveMax(receiver);
      if (receiver.activeSenders && receiver.activeSenders.size >= max) {
        return res.status(409).json({ ok: false, error: `Alıcı maksimum yayın kapasitesine ulaştı (${max}/${max}).` });
      }
      return res.json({ ok: true, message: 'Kod doğrulandı.', deviceName: receiver.deviceName });
    });

    // Direct download endpoint for Windows Receiver Portable EXE
    this.app.get(['/download', '/download/portable', '/Homak-Cast-Receiver.exe'], (req, res) => {
      const exePath = path.join(__dirname, 'public', 'downloads', 'Homak-Cast-Receiver.exe');
      res.download(exePath, 'Homak-Cast-Receiver.exe', (err) => {
        if (err && !res.headersSent) {
          res.status(404).send('İndirme dosyası hazırlanıyor veya bulunamadı.');
        }
      });
    });

    // Windows Receiver Setup / Installer EXE
    this.app.get(['/download/setup', '/download/installer', '/Homak-Cast-Setup.exe'], (req, res) => {
      const exePath = path.join(__dirname, 'public', 'downloads', 'Homak-Cast-Setup.exe');
      res.download(exePath, 'Homak-Cast-Setup.exe', (err) => {
        if (err && !res.headersSent) {
          res.status(404).send('Kurulum paketi hazırlanıyor veya bulunamadı.');
        }
      });
    });

    // Android APK download endpoint
    this.app.get(['/download/android', '/download/apk', '/Homak-Cast.apk'], (req, res) => {
      const apkPath = path.join(__dirname, 'public', 'downloads', 'Homak-Cast.apk');
      res.download(apkPath, 'Homak-Cast.apk', (err) => {
        if (err && !res.headersSent) {
          res.status(404).send('Android APK paketi bulunamadı.');
        }
      });
    });

    // Fallback route to web sender
    this.app.get('/{*splat}', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
  }

  initSocket() {
    this.io.on('connection', (socket) => {
      const clientIp = this.getClientIp(socket.handshake.headers, socket.handshake.address);

      // Never let a malformed payload crash the process.
      const onSafe = (evt, fn) => socket.on(evt, (...args) => {
        try {
          fn(...args);
        } catch (err) {
          console.error(`[HomakCast] Handler error (${evt}):`, err.message);
        }
      });

      // 1. Identify as Receiver
      onSafe('register-receiver', (rawData, callback) => {
        const data = isPlainObject(rawData) ? rawData : {};
        // If receiver already had a PIN, remove it first
        const oldPin = this.pinsByReceiverSocket.get(socket.id);
        if (oldPin) {
          this.receiversByPin.delete(oldPin);
        }

        const pin = this.generateUniquePin();
        const receiverData = this.createReceiverRecord(
          socket.id,
          cleanText(data.deviceName, 80, this.settings.deviceName || 'Homak Cast Receiver')
        );

        this.receiversByPin.set(pin, receiverData);
        this.pinsByReceiverSocket.set(socket.id, pin);
        if (typeof data.requireApproval === 'boolean') {
          this.approvalPrefBySocket.set(socket.id, data.requireApproval);
        }

        console.log(`[HomakCast] Receiver registered: ${socket.id} with PIN: ${pin} (${receiverData.deviceName})`);

        const connectUrl = this.getConnectUrlForSocket(socket, pin, data.customBaseUrl);

        if (typeof callback === 'function') {
          callback({
            ok: true,
            pin,
            qrUrl: connectUrl,
            settings: this.settings,
            networkAddresses: getNetworkAddresses()
          });
        }

        socket.emit('pin-update', {
          pin,
          qrUrl: connectUrl,
          createdAt: receiverData.createdAt
        });
      });

      // 2. Sender request pairing with 6-digit PIN
      onSafe('request-pairing', (rawData, callback) => {
        const data = isPlainObject(rawData) ? rawData : {};
        const check = this.checkRateLimit(clientIp);
        if (!check.allowed) {
          if (typeof callback === 'function') callback({ ok: false, error: check.error });
          return;
        }

        const inputPin = (data.pin || '').toString().trim().replace(/\s+/g, '');
        const receiver = this.receiversByPin.get(inputPin);

        if (!receiver) {
          this.recordFailedAttempt(clientIp);
          if (typeof callback === 'function') {
            callback({ ok: false, error: 'Girilen eşleştirme kodu bulunamadı veya alıcı çevrimdışı.' });
          }
          return;
        }

        // License: expired licenses accept no new streams, and the license can lower the device cap.
        if (this.limits().expired) {
          if (typeof callback === 'function') {
            callback({ ok: false, error: 'Alıcının lisans süresi dolmuş. Yöneticiyle iletişime geçin.' });
          }
          return;
        }

        // Multi-Stream check (up to 4 streams simultaneously, fewer when the license says so)
        const maxStreams = this.effectiveMax(receiver);
        if (receiver.activeSenders && receiver.activeSenders.size >= maxStreams && !receiver.activeSenders.has(socket.id)) {
          if (typeof callback === 'function') {
            callback({ ok: false, error: `Bu alıcı ekranı maksimum yayın kapasitesine ulaştı (${maxStreams}/${maxStreams} cihaz aktif).` });
          }
          return;
        }

        const ua = socket.handshake.headers['user-agent'] || 'unknown';
        console.log(`[HomakCast] Pairing request from IP: ${clientIp}, UA: ${cleanText(ua, 120)}`);

        const senderInfo = {
          socketId: socket.id,
          ip: clientIp,
          deviceName: cleanText(data.deviceName, 80, 'Web Tarayıcı'),
          model: cleanText(data.model, 80, 'Bilinmeyen Model'),
          os: cleanText(data.os, 60, 'Bilinmeyen İşletim Sistemi'),
          browser: cleanText(data.browser, 60, 'Bilinmeyen Cihaz')
        };

        // Check if approval required
        const needsApproval = this.approvalPrefBySocket.has(receiver.socketId)
          ? this.approvalPrefBySocket.get(receiver.socketId)
          : this.settings.requireApproval;
        if (needsApproval) {
          console.log(`[HomakCast] Requesting connection approval for ${senderInfo.deviceName} on receiver ${receiver.socketId}`);

          const timeoutId = setTimeout(() => {
            this.pendingApprovals.delete(socket.id);
            socket.emit('pairing-rejected', { reason: 'Bağlantı onayı zaman aşımına uğradı.' });
          }, 30000);

          this.pendingApprovals.set(socket.id, {
            timeoutId,
            senderInfo,
            receiverSocketId: receiver.socketId,
            pin: inputPin
          });

          this.io.to(receiver.socketId).emit('approval-request', {
            senderId: socket.id,
            senderInfo
          });

          if (typeof callback === 'function') {
            callback({ ok: true, status: 'WAITING_APPROVAL', message: 'Alıcıdan yayın onayı bekleniyor...' });
          }
        } else {
          this.completePairing(socket, receiver, senderInfo, inputPin, callback);
        }
      });

      // 3. Receiver response to approval request
      onSafe('approval-decision', (payload) => {
        const { senderId, approved } = isPlainObject(payload) ? payload : {};
        if (typeof senderId !== 'string') return;
        const pending = this.pendingApprovals.get(senderId);
        if (!pending || pending.receiverSocketId !== socket.id) return;

        clearTimeout(pending.timeoutId);
        this.pendingApprovals.delete(senderId);

        const senderSocket = this.io.sockets.sockets.get(senderId);
        if (!senderSocket) return;

        const receiver = this.receiversByPin.get(pending.pin);
        if (!receiver) return;

        if (approved) {
          this.completePairing(senderSocket, receiver, pending.senderInfo, pending.pin);
        } else {
          console.log(`[HomakCast] Pairing rejected by user for ${senderId}`);
          senderSocket.emit('pairing-rejected', { reason: 'Yayın isteği kullanıcı tarafından reddedildi.' });
        }
      });

      // 4. WebRTC Signaling forwarding (with senderId for multi-screen)
      onSafe('webrtc-offer', (data) => {
        const receiverId = this.activePairs.get(socket.id);
        if (receiverId && isPlainObject(data) && typeof data.sdp === 'string') {
          this.io.to(receiverId).emit('webrtc-offer', {
            sdp: data.sdp,
            senderId: socket.id
          });
        }
      });

      onSafe('webrtc-answer', (data) => {
        if (!isPlainObject(data)) return;
        const targetSenderId = data.senderId;
        const receiver = this.getReceiverForSocket(socket.id);
        if (typeof data.sdp === 'string' && typeof targetSenderId === 'string' &&
            receiver && receiver.activeSenders.has(targetSenderId)) {
          this.io.to(targetSenderId).emit('webrtc-answer', {
            sdp: data.sdp
          });
        }
      });

      onSafe('webrtc-candidate', (data) => {
        if (!isPlainObject(data)) return;
        // Forward from sender to receiver
        if (this.activePairs.has(socket.id)) {
          const receiverId = this.activePairs.get(socket.id);
          this.io.to(receiverId).emit('webrtc-candidate', {
            candidate: data.candidate,
            senderId: socket.id
          });
        } else if (typeof data.senderId === 'string') {
          // Forward from receiver to one of ITS OWN senders only
          const receiver = this.getReceiverForSocket(socket.id);
          if (!receiver || !receiver.activeSenders.has(data.senderId)) return;
          this.io.to(data.senderId).emit('webrtc-candidate', {
            candidate: data.candidate
          });
        }
      });

      // 5. Annotation & Laser Pointer forwarding
      onSafe('stream-annotation', (data) => {
        const receiverId = this.activePairs.get(socket.id);
        if (!receiverId || !isPlainObject(data)) return;
        const clean = sanitizeAnnotation(data);
        if (clean) {
          this.io.to(receiverId).emit('stream-annotation', { ...clean, senderId: socket.id });
        }
      });

      // 6. Stream Termination
      onSafe('stop-stream', () => {
        this.terminateStreamForSocket(socket.id, 'Kullanıcı yayını durdurdu.');
      });

      // 7. Manual PIN Refresh
      onSafe('refresh-pin', () => {
        const rotated = this.rotatePin(socket.id, { keepSenders: true });
        if (rotated) {
          socket.emit('pin-update', {
            pin: rotated.pin,
            qrUrl: this.getConnectUrlForSocket(socket, rotated.pin),
            createdAt: rotated.record.createdAt
          });
        }
      });

      // 8. Settings Update from Receiver
      onSafe('update-settings', (newSettings, callback) => {
        const incoming = isPlainObject(newSettings) ? newSettings : {};
        const isRegisteredReceiver = this.pinsByReceiverSocket.has(socket.id);

        // A registered receiver may only change its own approval preference.
        if (isRegisteredReceiver && typeof incoming.requireApproval === 'boolean') {
          this.approvalPrefBySocket.set(socket.id, incoming.requireApproval);
        }

        // Server-wide settings: only the machine running the server (loopback, not proxied).
        if (this.isLoopbackRequest(socket)) {
          this.settings = saveSettings(sanitizeSettingsUpdate(incoming)) || this.settings;
        }

        if (typeof callback === 'function') callback({ ok: true });
      });

      // Disconnect handling
      socket.on('disconnect', () => {
        this.approvalPrefBySocket.delete(socket.id);
        // If it was a receiver:
        const pin = this.pinsByReceiverSocket.get(socket.id);
        if (pin) {
          const receiver = this.receiversByPin.get(pin);
          if (receiver && receiver.activeSenders) {
            for (const senderId of receiver.activeSenders.keys()) {
              this.io.to(senderId).emit('stream-terminated', { reason: 'Alıcı cihazın bağlantısı koptu.' });
              this.activePairs.delete(senderId);
            }
          }
          this.receiversByPin.delete(pin);
          this.pinsByReceiverSocket.delete(socket.id);
          for (const [senderId, pending] of this.pendingApprovals) {
            if (pending.receiverSocketId !== socket.id) continue;
            clearTimeout(pending.timeoutId);
            this.pendingApprovals.delete(senderId);
            this.io.to(senderId).emit('pairing-rejected', { reason: 'Alıcı cihazın bağlantısı koptu.' });
          }
          console.log(`[HomakCast] Receiver disconnected: ${socket.id} (PIN ${pin} released)`);
        }

        // If it was a sender:
        if (this.activePairs.has(socket.id)) {
          this.terminateStreamForSocket(socket.id, 'Yayın kaynağı ayrıldı.');
        }

        if (this.pendingApprovals.has(socket.id)) {
          clearTimeout(this.pendingApprovals.get(socket.id).timeoutId);
          this.pendingApprovals.delete(socket.id);
        }
      });
    });
  }

  completePairing(senderSocket, receiver, senderInfo, pin, callback) {
    if (!receiver.activeSenders) {
      receiver.activeSenders = new Map();
    }

    receiver.activeSenders.set(senderSocket.id, senderInfo);
    receiver.inUse = receiver.activeSenders.size >= this.effectiveMax(receiver);
    this.activePairs.set(senderSocket.id, receiver.socketId);

    console.log(`[HomakCast] Pairing successful! Sender ${senderSocket.id} (${senderInfo.deviceName}) paired with Receiver ${receiver.socketId} (Active: ${receiver.activeSenders.size}/${this.effectiveMax(receiver)})`);

    const iceServers = [
      ...this.settings.stunServers,
      ...this.settings.turnServers,
      ...buildTurnServers()
    ];

    senderSocket.emit('pairing-approved', {
      iceServers,
      defaultFps: this.settings.defaultFps,
      adaptiveBitrate: this.settings.adaptiveBitrate,
      maxBitrateKbps: this.settings.maxBitrateKbps,
      activeStreamCount: receiver.activeSenders.size
    });

    this.io.to(receiver.socketId).emit('sender-connected', {
      senderId: senderSocket.id,
      senderInfo,
      iceServers,
      activeStreamCount: receiver.activeSenders.size
    });

    if (typeof callback === 'function') {
      callback({ ok: true, status: 'CONNECTED', activeStreamCount: receiver.activeSenders.size });
    }
  }

  terminateStreamForSocket(socketId, reason = 'Yayın sona erdi.') {
    // If it is a sender disconnecting:
    if (this.activePairs.has(socketId)) {
      const senderId = socketId;
      const receiverId = this.activePairs.get(socketId);
      this.activePairs.delete(senderId);

      const pin = this.pinsByReceiverSocket.get(receiverId);
      const receiver = pin ? this.receiversByPin.get(pin) : null;
      if (receiver && receiver.activeSenders) {
        receiver.activeSenders.delete(senderId);
        receiver.inUse = receiver.activeSenders.size >= this.effectiveMax(receiver);
      }

      this.io.to(senderId).emit('stream-terminated', { reason });
      if (receiverId) {
        const remaining = receiver ? receiver.activeSenders.size : 0;
        this.io.to(receiverId).emit('sender-disconnected', { senderId, reason, remainingStreams: remaining });
        if (remaining === 0) {
          this.io.to(receiverId).emit('all-streams-ended', { reason });
        }
      }
      return;
    }

    // If it is a receiver stopping all streams:
    const pin = this.pinsByReceiverSocket.get(socketId);
    if (pin) {
      const receiverId = socketId;
      const receiver = this.receiversByPin.get(pin);
      if (receiver && receiver.activeSenders) {
        for (const senderId of receiver.activeSenders.keys()) {
          this.io.to(senderId).emit('stream-terminated', { reason });
          this.activePairs.delete(senderId);
        }
        receiver.activeSenders.clear();
        receiver.inUse = false;
      }

      this.io.to(receiverId).emit('all-streams-ended', { reason });

      // Generate a fresh PIN (keeps the receiver's device name)
      const rotated = this.rotatePin(receiverId);
      if (rotated) {
        this.io.to(receiverId).emit('pin-update', {
          pin: rotated.pin,
          qrUrl: this.buildConnectUrl(null, rotated.pin)
        });
        console.log(`[HomakCast] New PIN generated after stream end for receiver ${receiverId}: ${rotated.pin}`);
      }
    }
  }

  async startHttps(host) {
    if (!this.httpsPort) return;
    try {
      const { key, cert } = await loadOrCreateCert();
      const httpsServer = https.createServer({ key, cert }, this.app);
      this.io.attach(httpsServer);
      await new Promise((resolve, reject) => {
        httpsServer.once('error', reject);
        httpsServer.listen(this.httpsPort, host, resolve);
      });
      this.httpsServer = httpsServer;
      console.log(`  HTTPS (self-signed, LAN): port ${this.httpsPort}`);
    } catch (err) {
      // HTTPS is an optional extra: keep the plain HTTP server usable.
      console.error('[HomakCast] HTTPS listener failed, continuing with HTTP only:', err.message);
      this.httpsServer = null;
    }
  }

  start() {
    return new Promise((resolve, reject) => {
      // BIND_HOST=127.0.0.1 on the public server so only the reverse proxy/tunnel can reach it.
      const host = process.env.BIND_HOST || '0.0.0.0';
      this.server.once('error', reject);
      this.server.listen(this.port, host, async () => {
        console.log(`
======================================================`);
        console.log(`  HOMAK CAST SIGNALING & WEB SENDER SERVER STARTED`);
        console.log(`  Domain: https://${this.publicHost}`);
        console.log(`  Local Port: ${this.port}`);
        await this.startHttps(host);
        console.log(`======================================================
`);
        resolve(this.port);
      });
    });
  }

  stop() {
    const closeServer = (srv) => new Promise((resolve) => {
      if (!srv || !srv.listening) return resolve();
      srv.close(() => resolve());
    });
    return new Promise((resolve) => {
      this.io.close(async () => {
        await closeServer(this.server);
        await closeServer(this.httpsServer);
        resolve();
      });
    });
  }
}

if (require.main === module) {
  const server = new SignalingServer();
  server.start().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = SignalingServer;
