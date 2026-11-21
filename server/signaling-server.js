const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const QRCode = require('qrcode');
const { loadSettings, saveSettings, getNetworkAddresses } = require('./config');
const crypto = require('crypto');
const { buildTurnServers } = require('./turn');

const RATE_MAX_FAILS = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_BLOCK_MS = 5 * 60 * 1000;
const DEFAULT_ALLOWED_HOSTS = ['cast.homaklab.com', 'awp.homaklab.com', 'localhost', '127.0.0.1'];
const PRIVATE_HOST_RE = /^(10\.|192\.168\.|127\.|172\.(1[6-9]|2\d|3[01])\.)/;

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

  getClientIp(headers, fallback) {
    const cf = headers && headers['cf-connecting-ip'];
    if (cf) return String(cf).trim();
    const xff = headers && headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
    return fallback || 'unknown';
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
    let pin;
    let attempts = 0;
    do {
      pin = crypto.randomInt(100000, 1000000).toString();
      attempts++;
    } while (this.receiversByPin.has(pin) && attempts < 100);
    return pin;
  }

  getPrimaryLanAddress() {
    const addresses = getNetworkAddresses();
    const lan = addresses.find(a => a.isLocal && a.address.startsWith('192.168.')) ||
                addresses.find(a => a.isLocal && !a.address.startsWith('172.') && !a.address.startsWith('10.77.')) ||
                addresses.find(a => a.isLocal) || addresses[0];
    return lan ? lan.address : '127.0.0.1';
  }

  getConnectUrl(req, pin) {
    let host = req && req.headers ? (req.headers['x-forwarded-host'] || req.headers.host) : '';
    if (!host || host.startsWith('127.0.0.1') || host.startsWith('localhost')) {
      host = this.publicHost || 'cast.homaklab.com';
    }

    let protocol = 'https';
    if (req && req.headers && req.headers['x-forwarded-proto']) {
      protocol = req.headers['x-forwarded-proto'];
    } else if (host.includes('192.168.') || host.includes('10.') || host.includes('172.') || host.includes(':5240')) {
      protocol = 'http';
    }

    const pinParam = pin ? `?code=${pin}` : '';
    return `${protocol}://${host}/${pinParam}`;
  }

  getConnectUrlForSocket(socket, pin, customBaseUrl) {
    if (customBaseUrl && this.isAllowedBaseUrl(customBaseUrl)) {
      const clean = customBaseUrl.replace(/\/+$/, '');
      return `${clean}/?code=${pin}`;
    }

    let host = socket.handshake.headers['x-forwarded-host'] || socket.handshake.headers.host || '';
    if (!host || host.startsWith('127.0.0.1') || host.startsWith('localhost')) {
      host = this.publicHost || 'cast.homaklab.com';
    }

    let proto = 'https';
    if (socket.handshake.headers['x-forwarded-proto']) {
      proto = socket.handshake.headers['x-forwarded-proto'];
    } else if (host.includes('192.168.') || host.includes('10.') || host.includes('172.') || host.includes(':5240')) {
      proto = 'http';
    }

    const pinParam = pin ? `?code=${pin}` : '';
    return `${proto}://${host}/${pinParam}`;
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
  }

  // Intentionally NOT called on a successful pairing: otherwise an attacker could reset
  // their own counter by pairing with a receiver they control. Kept for admin/tests.
  resetRateLimit(ip) {
    this.rateLimits.delete(ip);
  }

  pruneRateLimits() {
    const now = Date.now();
    for (const [ip, data] of this.rateLimits) {
      if (data.blockedUntil < now && now - data.firstAttempt > RATE_WINDOW_MS) {
        this.rateLimits.delete(ip);
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
        return res.status(400).json({ ok: false, error: 'Eşleştirme kodu hatalı veya alıcı maksimum yayına (4/4) ulaştı.' });
      }
      if (receiver.activeSenders && receiver.activeSenders.size >= (receiver.maxSenders || 4)) {
        return res.status(400).json({ ok: false, error: 'Eşleştirme kodu hatalı veya alıcı maksimum yayına (4/4) ulaştı.' });
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
        const receiverData = {
          socketId: socket.id,
          deviceName: cleanText(data.deviceName, 80, this.settings.deviceName || 'Homak Cast Receiver'),
          createdAt: Date.now(),
          inUse: false,
          activeSenders: new Map(), // senderSocketId -> senderInfo (supports up to 4 concurrent senders!)
          maxSenders: 4
        };

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

        // Multi-Stream check (up to 4 streams simultaneously)
        if (receiver.activeSenders && receiver.activeSenders.size >= (receiver.maxSenders || 4) && !receiver.activeSenders.has(socket.id)) {
          if (typeof callback === 'function') {
            callback({ ok: false, error: 'Bu alıcı ekranı maksimum yayın kapasitesine ulaştı (4/4 cihaz aktif).' });
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
        const targetSenderId = isPlainObject(data) ? data.senderId : null;
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
        if (receiverId && isPlainObject(data)) {
          this.io.to(receiverId).emit('stream-annotation', {
            ...data,
            senderId: socket.id
          });
        }
      });

      // 6. Stream Termination
      onSafe('stop-stream', () => {
        this.terminateStreamForSocket(socket.id, 'Kullanıcı yayını durdurdu.');
      });

      // 7. Manual PIN Refresh
      onSafe('refresh-pin', () => {
        const currentPin = this.pinsByReceiverSocket.get(socket.id);
        if (currentPin) {
          const oldReceiver = this.receiversByPin.get(currentPin);
          this.receiversByPin.delete(currentPin);
          const newPin = this.generateUniquePin();
          const receiverData = {
            socketId: socket.id,
            deviceName: this.settings.deviceName || 'Homak Cast Receiver',
            createdAt: Date.now(),
            inUse: false,
            activeSenders: oldReceiver ? oldReceiver.activeSenders : new Map(),
            maxSenders: 4
          };
          this.receiversByPin.set(newPin, receiverData);
          this.pinsByReceiverSocket.set(socket.id, newPin);

          const connectUrl = this.getConnectUrlForSocket(socket, newPin);
          socket.emit('pin-update', { pin: newPin, qrUrl: connectUrl });
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
          const allowedKeys = ['deviceName', 'requireApproval', 'defaultFps', 'adaptiveBitrate', 'maxBitrateKbps', 'stunServers'];
          const filtered = {};
          for (const key of allowedKeys) {
            if (key in incoming) filtered[key] = incoming[key];
          }
          this.settings = saveSettings(filtered) || this.settings;
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
    receiver.inUse = (receiver.activeSenders.size >= (receiver.maxSenders || 4));
    this.activePairs.set(senderSocket.id, receiver.socketId);

    console.log(`[HomakCast] Pairing successful! Sender ${senderSocket.id} (${senderInfo.deviceName}) paired with Receiver ${receiver.socketId} (Active: ${receiver.activeSenders.size}/4)`);

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
        receiver.inUse = false;
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

      // Generate a fresh PIN
      this.receiversByPin.delete(pin);
      const newPin = this.generateUniquePin();
      const receiverData = {
        socketId: receiverId,
        deviceName: this.settings.deviceName || 'Homak Cast Receiver',
        createdAt: Date.now(),
        inUse: false,
        activeSenders: new Map(),
        maxSenders: 4
      };
      this.receiversByPin.set(newPin, receiverData);
      this.pinsByReceiverSocket.set(receiverId, newPin);

      const connectUrl = `https://${this.publicHost}/?code=${newPin}`;
      this.io.to(receiverId).emit('pin-update', { pin: newPin, qrUrl: connectUrl });
      console.log(`[HomakCast] New PIN generated after stream end for receiver ${receiverId}: ${newPin}`);
    }
  }

  start() {
    return new Promise((resolve, reject) => {
      // BIND_HOST=127.0.0.1 on the public server so only the reverse proxy/tunnel can reach it.
      this.server.listen(this.port, process.env.BIND_HOST || '0.0.0.0', () => {
        const addresses = getNetworkAddresses();
        console.log(`\n======================================================`);
        console.log(`  HOMAK CAST SIGNALING & WEB SENDER SERVER STARTED`);
        console.log(`  Domain: https://${this.publicHost}`);
        console.log(`  Local Port: ${this.port}`);
        console.log(`======================================================\n`);
        resolve(this.port);
      });
      this.server.on('error', reject);
    });
  }

  stop() {
    return new Promise((resolve) => {
      this.io.close(() => {
        this.server.close(() => {
          resolve();
        });
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
