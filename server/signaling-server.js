const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const QRCode = require('qrcode');
const { loadSettings, saveSettings, getNetworkAddresses } = require('./config');

class SignalingServer {
  constructor(options = {}) {
    this.port = options.port || loadSettings().port || 5240;
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    this.settings = loadSettings();
    this.receiverSocketId = null;
    this.activeSenderSocketId = null;
    this.activePin = null;
    this.pinCreatedAt = null;
    this.pinInvalidated = false;
    this.rateLimits = new Map(); // ip -> { attempts, lastAttempt, blockedUntil }
    this.pendingApprovals = new Map(); // senderSocketId -> { timeoutId, senderInfo }

    this.initExpress();
    this.initSocket();
    this.generateNewPin();
  }

  generateNewPin() {
    this.activePin = Math.floor(100000 + Math.random() * 900000).toString();
    this.pinCreatedAt = Date.now();
    this.pinInvalidated = false;
    console.log(`[HomakCast] New pairing PIN generated: ${this.activePin}`);

    if (this.receiverSocketId) {
      this.io.to(this.receiverSocketId).emit('pin-update', {
        pin: this.activePin,
        qrUrl: this.getConnectUrl(this.activePin),
        createdAt: this.pinCreatedAt
      });
    }
    return this.activePin;
  }

  getBestHostAddress() {
    const addrs = getNetworkAddresses();
    if (addrs.length > 0) {
      return addrs[0].address;
    }
    return '127.0.0.1';
  }

  getConnectUrl(pin) {
    const host = this.getBestHostAddress();
    const pinParam = pin ? `?code=${pin}` : '';
    return `http://${host}:${this.port}/${pinParam}`;
  }

  checkRateLimit(ip) {
    const now = Date.now();
    const limitData = this.rateLimits.get(ip) || { attempts: 0, lastAttempt: now, blockedUntil: 0 };

    if (limitData.blockedUntil > now) {
      const waitSeconds = Math.ceil((limitData.blockedUntil - now) / 1000);
      return { allowed: false, error: `Çok fazla hatalı deneme yapıldı. Lütfen ${waitSeconds} saniye bekleyin.` };
    }

    if (now - limitData.lastAttempt > 60000) {
      limitData.attempts = 0;
    }

    return { allowed: true, limitData };
  }

  recordFailedAttempt(ip, limitData) {
    const now = Date.now();
    limitData.attempts += 1;
    limitData.lastAttempt = now;

    if (limitData.attempts >= 5) {
      limitData.blockedUntil = now + 60000; // block for 1 minute
      console.warn(`[HomakCast] Rate limit triggered for IP ${ip}`);
    }

    this.rateLimits.set(ip, limitData);
  }

  resetRateLimit(ip) {
    this.rateLimits.delete(ip);
  }

  initExpress() {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));

    // Status endpoint
    this.app.get('/api/status', (req, res) => {
      const addresses = getNetworkAddresses();
      res.json({
        ok: true,
        deviceName: this.settings.deviceName,
        port: this.port,
        addresses,
        receiverOnline: !!this.receiverSocketId,
        isStreaming: !!this.activeSenderSocketId,
        connectUrl: this.getConnectUrl(this.pinInvalidated ? null : this.activePin)
      });
    });

    // QR Code data URL generator
    this.app.get('/api/qr', async (req, res) => {
      try {
        const pin = req.query.code || (this.pinInvalidated ? null : this.activePin);
        const url = this.getConnectUrl(pin);
        const qrImage = await QRCode.toDataURL(url, {
          width: 320,
          margin: 1,
          color: {
            dark: '#00f0ff',
            light: '#0a0e17'
          }
        });
        res.json({ ok: true, qr: qrImage, url, pin });
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });

    // Verify PIN code via REST (useful for quick pre-validation)
    this.app.post('/api/verify-code', (req, res) => {
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
      const check = this.checkRateLimit(clientIp);
      if (!check.allowed) {
        return res.status(429).json({ ok: false, error: check.error });
      }

      const { code } = req.body;
      if (!code || typeof code !== 'string') {
        return res.status(400).json({ ok: false, error: 'Geçersiz kod biçimi.' });
      }

      const normalizedInput = code.replace(/\s+/g, '');
      if (this.pinInvalidated || normalizedInput !== this.activePin) {
        this.recordFailedAttempt(clientIp, check.limitData);
        return res.status(400).json({ ok: false, error: 'Eşleştirme kodu hatalı veya süresi dolmuş.' });
      }

      this.resetRateLimit(clientIp);
      return res.json({ ok: true, message: 'Kod doğrulandı.' });
    });

    // Fallback route to web sender
    this.app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
  }

  initSocket() {
    this.io.on('connection', (socket) => {
      const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

      // 1. Identify as Receiver
      socket.on('register-receiver', (data, callback) => {
        console.log(`[HomakCast] Receiver connected: ${socket.id}`);
        this.receiverSocketId = socket.id;

        // If there is an active sender, let receiver know
        if (typeof callback === 'function') {
          callback({
            ok: true,
            pin: this.activePin,
            qrUrl: this.getConnectUrl(this.activePin),
            settings: this.settings,
            networkAddresses: getNetworkAddresses()
          });
        }

        // Broadcast status
        this.io.emit('receiver-status-changed', { online: true });
      });

      // 2. Sender request pairing with 6-digit PIN
      socket.on('request-pairing', async (data, callback) => {
        const check = this.checkRateLimit(clientIp);
        if (!check.allowed) {
          if (typeof callback === 'function') callback({ ok: false, error: check.error });
          return;
        }

        const inputPin = (data.pin || '').toString().trim().replace(/\s+/g, '');

        if (!this.receiverSocketId) {
          if (typeof callback === 'function') {
            callback({ ok: false, error: 'Homak Cast Receiver şu anda açık veya hazır değil.' });
          }
          return;
        }

        if (this.activeSenderSocketId && this.activeSenderSocketId !== socket.id) {
          if (typeof callback === 'function') {
            callback({ ok: false, error: 'Başka bir cihaz şu anda ekrana yayın yapıyor.' });
          }
          return;
        }

        if (this.pinInvalidated || inputPin !== this.activePin) {
          this.recordFailedAttempt(clientIp, check.limitData);
          if (typeof callback === 'function') {
            callback({ ok: false, error: 'Girilen eşleştirme kodu hatalı veya kullanımda.' });
          }
          return;
        }

        this.resetRateLimit(clientIp);

        const senderInfo = {
          socketId: socket.id,
          ip: clientIp,
          deviceName: data.deviceName || 'Web Tarayıcı',
          browser: data.browser || 'Bilinmeyen Cihaz'
        };

        // Check if receiver requires approval
        if (this.settings.requireApproval) {
          console.log(`[HomakCast] Requesting connection approval for ${senderInfo.deviceName} (${clientIp})`);
          
          const timeoutId = setTimeout(() => {
            this.pendingApprovals.delete(socket.id);
            socket.emit('pairing-rejected', { reason: 'Bağlantı onayı zaman aşımına uğradı.' });
          }, 30000);

          this.pendingApprovals.set(socket.id, { timeoutId, senderInfo });

          this.io.to(this.receiverSocketId).emit('approval-request', {
            senderId: socket.id,
            senderInfo
          });

          if (typeof callback === 'function') {
            callback({ ok: true, status: 'WAITING_APPROVAL', message: 'Alıcıdan yayın onayı bekleniyor...' });
          }
        } else {
          // Direct connect
          this.completePairing(socket, senderInfo, callback);
        }
      });

      // 3. Receiver response to approval request
      socket.on('approval-decision', ({ senderId, approved }) => {
        const pending = this.pendingApprovals.get(senderId);
        if (!pending) return;

        clearTimeout(pending.timeoutId);
        this.pendingApprovals.delete(senderId);

        const senderSocket = this.io.sockets.sockets.get(senderId);
        if (!senderSocket) return;

        if (approved) {
          this.completePairing(senderSocket, pending.senderInfo);
        } else {
          console.log(`[HomakCast] Pairing rejected by user for ${senderId}`);
          senderSocket.emit('pairing-rejected', { reason: 'Yayın isteği kullanıcı tarafından reddedildi.' });
        }
      });

      // 4. WebRTC Signaling forwarding
      socket.on('webrtc-offer', (data) => {
        if (socket.id === this.activeSenderSocketId && this.receiverSocketId) {
          this.io.to(this.receiverSocketId).emit('webrtc-offer', {
            sdp: data.sdp,
            senderId: socket.id
          });
        }
      });

      socket.on('webrtc-answer', (data) => {
        if (socket.id === this.receiverSocketId && this.activeSenderSocketId) {
          this.io.to(this.activeSenderSocketId).emit('webrtc-answer', {
            sdp: data.sdp
          });
        }
      });

      socket.on('webrtc-candidate', (data) => {
        if (socket.id === this.activeSenderSocketId && this.receiverSocketId) {
          this.io.to(this.receiverSocketId).emit('webrtc-candidate', data.candidate);
        } else if (socket.id === this.receiverSocketId && this.activeSenderSocketId) {
          this.io.to(this.activeSenderSocketId).emit('webrtc-candidate', data.candidate);
        }
      });

      // 5. Stream Termination
      socket.on('stop-stream', () => {
        this.terminateStream('Kullanıcı yayını durdurdu.');
      });

      // 6. Manual PIN Refresh
      socket.on('refresh-pin', () => {
        if (socket.id === this.receiverSocketId) {
          this.generateNewPin();
        }
      });

      // 7. Settings Update from Receiver
      socket.on('update-settings', (newSettings, callback) => {
        if (socket.id === this.receiverSocketId) {
          this.settings = saveSettings(newSettings) || this.settings;
          console.log('[HomakCast] Settings updated:', this.settings);
          if (typeof callback === 'function') callback({ ok: true, settings: this.settings });
        }
      });

      // Disconnect handling
      socket.on('disconnect', () => {
        if (socket.id === this.receiverSocketId) {
          console.log('[HomakCast] Receiver disconnected.');
          this.receiverSocketId = null;
          if (this.activeSenderSocketId) {
            this.io.to(this.activeSenderSocketId).emit('receiver-disconnected');
            this.activeSenderSocketId = null;
          }
          this.io.emit('receiver-status-changed', { online: false });
        } else if (socket.id === this.activeSenderSocketId) {
          console.log('[HomakCast] Active Sender disconnected.');
          this.terminateStream('Yayın kaynağı ayrıldı.');
        }

        if (this.pendingApprovals.has(socket.id)) {
          clearTimeout(this.pendingApprovals.get(socket.id).timeoutId);
          this.pendingApprovals.delete(socket.id);
        }
      });
    });
  }

  completePairing(senderSocket, senderInfo, callback) {
    this.activeSenderSocketId = senderSocket.id;
    // Invalidate the code so it cannot be reused
    this.pinInvalidated = true;
    console.log(`[HomakCast] Pairing successful! Code ${this.activePin} is now invalidated.`);

    const iceServers = [
      ...this.settings.stunServers,
      ...this.settings.turnServers
    ];

    senderSocket.emit('pairing-approved', {
      iceServers,
      defaultFps: this.settings.defaultFps,
      adaptiveBitrate: this.settings.adaptiveBitrate,
      maxBitrateKbps: this.settings.maxBitrateKbps
    });

    if (this.receiverSocketId) {
      this.io.to(this.receiverSocketId).emit('sender-connected', {
        senderInfo,
        iceServers
      });
    }

    if (typeof callback === 'function') {
      callback({ ok: true, status: 'CONNECTED' });
    }
  }

  terminateStream(reason = 'Yayın sona erdi.') {
    if (this.activeSenderSocketId) {
      this.io.to(this.activeSenderSocketId).emit('stream-terminated', { reason });
      this.activeSenderSocketId = null;
    }

    if (this.receiverSocketId) {
      this.io.to(this.receiverSocketId).emit('stream-terminated', { reason });
      // Requirement 6 & 7: Return to code screen & generate a new pairing code immediately!
      this.generateNewPin();
    }
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, '0.0.0.0', () => {
        const addresses = getNetworkAddresses();
        console.log(`\n======================================================`);
        console.log(`  HOMAK CAST SIGNALING & WEB SENDER SERVER STARTED`);
        console.log(`  Port: ${this.port}`);
        console.log(`  Accessible addresses:`);
        addresses.forEach(a => {
          console.log(`   - http://${a.address}:${this.port} (${a.interface})`);
        });
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

// Standalone execution support
if (require.main === module) {
  const server = new SignalingServer();
  server.start().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = SignalingServer;
