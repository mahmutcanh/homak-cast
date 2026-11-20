const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const QRCode = require('qrcode');
const { loadSettings, saveSettings, getNetworkAddresses } = require('./config');

class SignalingServer {
  constructor(options = {}) {
    this.port = options.port || process.env.PORT || loadSettings().port || 5240;
    this.publicHost = options.publicHost || process.env.PUBLIC_HOST || 'cast.homaklab.com';
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    this.settings = loadSettings();

    // Multi-receiver state
    // pin -> { socketId, deviceName, createdAt, inUse: boolean, activeSenderId: string|null }
    this.receiversByPin = new Map();
    // socketId -> pin
    this.pinsByReceiverSocket = new Map();
    // senderSocketId -> receiverSocketId
    this.activePairs = new Map();

    this.rateLimits = new Map(); // ip -> { attempts, lastAttempt, blockedUntil }
    this.pendingApprovals = new Map(); // senderSocketId -> { timeoutId, senderInfo, receiverSocketId }

    this.initExpress();
    this.initSocket();
  }

  generateUniquePin() {
    let pin;
    let attempts = 0;
    do {
      pin = Math.floor(100000 + Math.random() * 900000).toString();
      attempts++;
    } while (this.receiversByPin.has(pin) && attempts < 100);
    return pin;
  }

  getConnectUrl(req, pin) {
    let host = this.publicHost;
    let protocol = 'https';

    if (req && req.headers && req.headers.host) {
      host = req.headers.host;
      if (host.includes('localhost') || host.includes('127.0.0.1') || host.includes('192.168.')) {
        protocol = req.protocol || 'http';
      }
    }

    const pinParam = pin ? `?code=${pin}` : '';
    return `${protocol}://${host}/${pinParam}`;
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
      limitData.blockedUntil = now + 60000;
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
        service: 'Homak Cast Signaling & Web Sender',
        domain: 'cast.homaklab.com',
        port: this.port,
        addresses,
        receiverOnline: this.receiversByPin.size > 0,
        totalReceivers: this.receiversByPin.size,
        activeStreams: this.activePairs.size,
        connectUrl: this.getConnectUrl(req)
      });
    });

    // QR Code data URL generator
    this.app.get('/api/qr', async (req, res) => {
      try {
        const pin = req.query.code;
        const url = this.getConnectUrl(req, pin);
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

    // Verify PIN code via REST
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
      const receiver = this.receiversByPin.get(normalizedInput);

      if (!receiver || receiver.inUse) {
        this.recordFailedAttempt(clientIp, check.limitData);
        return res.status(400).json({ ok: false, error: 'Eşleştirme kodu hatalı veya kullanımda.' });
      }

      this.resetRateLimit(clientIp);
      return res.json({ ok: true, message: 'Kod doğrulandı.', deviceName: receiver.deviceName });
    });

    // Direct download endpoint for Windows Receiver EXE
    this.app.get('/download', (req, res) => {
      const exePath = path.join(__dirname, 'public', 'downloads', 'Homak-Cast-Receiver.exe');
      res.download(exePath, 'Homak-Cast-Receiver.exe', (err) => {
        if (err && !res.headersSent) {
          res.status(404).send('İndirme dosyası hazırlanıyor veya bulunamadı.');
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
    this.app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
  }

  initSocket() {
    this.io.on('connection', (socket) => {
      const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

      // 1. Identify as Receiver
      socket.on('register-receiver', (data = {}, callback) => {
        // If receiver already had a PIN, remove it first
        const oldPin = this.pinsByReceiverSocket.get(socket.id);
        if (oldPin) {
          this.receiversByPin.delete(oldPin);
        }

        const pin = this.generateUniquePin();
        const receiverData = {
          socketId: socket.id,
          deviceName: data.deviceName || this.settings.deviceName || 'Homak Cast Receiver',
          createdAt: Date.now(),
          inUse: false,
          activeSenderId: null
        };

        this.receiversByPin.set(pin, receiverData);
        this.pinsByReceiverSocket.set(socket.id, pin);

        console.log(`[HomakCast] Receiver registered: ${socket.id} with PIN: ${pin} (${receiverData.deviceName})`);

        const connectUrl = `https://${this.publicHost}/?code=${pin}`;

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
      socket.on('request-pairing', (data, callback) => {
        const check = this.checkRateLimit(clientIp);
        if (!check.allowed) {
          if (typeof callback === 'function') callback({ ok: false, error: check.error });
          return;
        }

        const inputPin = (data.pin || '').toString().trim().replace(/\s+/g, '');
        const receiver = this.receiversByPin.get(inputPin);

        if (!receiver) {
          this.recordFailedAttempt(clientIp, check.limitData);
          if (typeof callback === 'function') {
            callback({ ok: false, error: 'Girilen eşleştirme kodu bulunamadı veya alıcı çevrimdışı.' });
          }
          return;
        }

        if (receiver.inUse && receiver.activeSenderId !== socket.id) {
          if (typeof callback === 'function') {
            callback({ ok: false, error: 'Bu alıcı ekranı şu anda başka bir yayında.' });
          }
          return;
        }

        this.resetRateLimit(clientIp);

        const senderInfo = {
          socketId: socket.id,
          ip: clientIp,
          deviceName: data.deviceName || 'Web Tarayıcı',
          model: data.model || 'Bilinmeyen Model',
          os: data.os || 'Bilinmeyen İşletim Sistemi',
          browser: data.browser || 'Bilinmeyen Cihaz'
        };

        // Check if approval required
        if (this.settings.requireApproval) {
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
      socket.on('approval-decision', ({ senderId, approved }) => {
        const pending = this.pendingApprovals.get(senderId);
        if (!pending) return;

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

      // 4. WebRTC Signaling forwarding
      socket.on('webrtc-offer', (data) => {
        const receiverId = this.activePairs.get(socket.id);
        if (receiverId) {
          this.io.to(receiverId).emit('webrtc-offer', {
            sdp: data.sdp,
            senderId: socket.id
          });
        }
      });

      socket.on('webrtc-answer', (data) => {
        const pin = this.pinsByReceiverSocket.get(socket.id);
        const receiver = pin ? this.receiversByPin.get(pin) : null;
        if (receiver && receiver.activeSenderId) {
          this.io.to(receiver.activeSenderId).emit('webrtc-answer', {
            sdp: data.sdp
          });
        }
      });

      socket.on('webrtc-candidate', (data) => {
        // Forward from sender to receiver
        if (this.activePairs.has(socket.id)) {
          const receiverId = this.activePairs.get(socket.id);
          this.io.to(receiverId).emit('webrtc-candidate', data.candidate);
        } else {
          // Forward from receiver to active sender
          const pin = this.pinsByReceiverSocket.get(socket.id);
          const receiver = pin ? this.receiversByPin.get(pin) : null;
          if (receiver && receiver.activeSenderId) {
            this.io.to(receiver.activeSenderId).emit('webrtc-candidate', data.candidate);
          }
        }
      });

      // 5. Stream Termination
      socket.on('stop-stream', () => {
        this.terminateStreamForSocket(socket.id, 'Kullanıcı yayını durdurdu.');
      });

      // 6. Manual PIN Refresh
      socket.on('refresh-pin', () => {
        const currentPin = this.pinsByReceiverSocket.get(socket.id);
        if (currentPin) {
          this.receiversByPin.delete(currentPin);
          const newPin = this.generateUniquePin();
          const receiverData = {
            socketId: socket.id,
            deviceName: this.settings.deviceName || 'Homak Cast Receiver',
            createdAt: Date.now(),
            inUse: false,
            activeSenderId: null
          };
          this.receiversByPin.set(newPin, receiverData);
          this.pinsByReceiverSocket.set(socket.id, newPin);

          const connectUrl = `https://${this.publicHost}/?code=${newPin}`;
          socket.emit('pin-update', { pin: newPin, qrUrl: connectUrl });
        }
      });

      // 7. Settings Update from Receiver
      socket.on('update-settings', (newSettings, callback) => {
        this.settings = saveSettings(newSettings) || this.settings;
        if (typeof callback === 'function') callback({ ok: true, settings: this.settings });
      });

      // Disconnect handling
      socket.on('disconnect', () => {
        // If it was a receiver:
        const pin = this.pinsByReceiverSocket.get(socket.id);
        if (pin) {
          const receiver = this.receiversByPin.get(pin);
          if (receiver && receiver.activeSenderId) {
            this.io.to(receiver.activeSenderId).emit('stream-terminated', { reason: 'Alıcı cihazın bağlantısı koptu.' });
            this.activePairs.delete(receiver.activeSenderId);
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
    receiver.inUse = true;
    receiver.activeSenderId = senderSocket.id;
    this.activePairs.set(senderSocket.id, receiver.socketId);

    console.log(`[HomakCast] Pairing successful! Sender ${senderSocket.id} paired with Receiver ${receiver.socketId} (PIN ${pin})`);

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

    this.io.to(receiver.socketId).emit('sender-connected', {
      senderInfo,
      iceServers
    });

    if (typeof callback === 'function') {
      callback({ ok: true, status: 'CONNECTED' });
    }
  }

  terminateStreamForSocket(socketId, reason = 'Yayın sona erdi.') {
    let senderId = null;
    let receiverId = null;
    let pin = null;

    if (this.activePairs.has(socketId)) {
      senderId = socketId;
      receiverId = this.activePairs.get(socketId);
      this.activePairs.delete(senderId);
      pin = this.pinsByReceiverSocket.get(receiverId);
    } else {
      pin = this.pinsByReceiverSocket.get(socketId);
      if (pin) {
        receiverId = socketId;
        const receiver = this.receiversByPin.get(pin);
        if (receiver && receiver.activeSenderId) {
          senderId = receiver.activeSenderId;
          this.activePairs.delete(senderId);
        }
      }
    }

    if (senderId) {
      this.io.to(senderId).emit('stream-terminated', { reason });
    }

    if (receiverId) {
      this.io.to(receiverId).emit('stream-terminated', { reason });

      // Generate a fresh PIN for the receiver
      if (pin) {
        this.receiversByPin.delete(pin);
        const newPin = this.generateUniquePin();
        const receiverData = {
          socketId: receiverId,
          deviceName: this.settings.deviceName || 'Homak Cast Receiver',
          createdAt: Date.now(),
          inUse: false,
          activeSenderId: null
        };
        this.receiversByPin.set(newPin, receiverData);
        this.pinsByReceiverSocket.set(receiverId, newPin);

        const connectUrl = `https://${this.publicHost}/?code=${newPin}`;
        this.io.to(receiverId).emit('pin-update', { pin: newPin, qrUrl: connectUrl });
        console.log(`[HomakCast] New PIN generated after stream end for receiver ${receiverId}: ${newPin}`);
      }
    }
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, '0.0.0.0', () => {
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
