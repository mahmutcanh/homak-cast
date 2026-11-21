const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const QRCode = require('qrcode');
const { loadSettings, saveSettings, getNetworkAddresses } = require('./config');
const { buildTurnServers } = require('./turn');

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
    // pin -> { socketId, deviceName, createdAt, inUse: boolean, activeSenders: Map<senderSocketId, senderInfo>, maxSenders: number }
    this.receiversByPin = new Map();
    // socketId -> pin
    this.pinsByReceiverSocket = new Map();
    // senderSocketId -> receiverSocketId
    this.activePairs = new Map();

    this.rateLimits = new Map(); // ip -> { attempts, lastAttempt, blockedUntil }
    this.pendingApprovals = new Map(); // senderSocketId -> { timeoutId, senderInfo, receiverSocketId, pin }

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
    if (customBaseUrl) {
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
    // Disabled aggressive lockout so presenters/attendees are never blocked
    return { allowed: true };
  }

  recordFailedAttempt(ip, limitData) {
    // No-op
  }

  resetRateLimit(ip) {
    this.rateLimits.delete(ip);
  }

  resetRateLimit(ip) {
    this.rateLimits.delete(ip);
  }

  initExpress() {
    this.app.use(express.json());
    this.app.use((req, res, next) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
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
        const pin = req.query.code;
        const targetUrl = req.query.url || this.getConnectUrl(req, pin);
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

      if (!receiver || (receiver.activeSenders && receiver.activeSenders.size >= (receiver.maxSenders || 4))) {
        this.recordFailedAttempt(clientIp, check.limitData);
        return res.status(400).json({ ok: false, error: 'Eşleştirme kodu hatalı veya alıcı maksimum yayına (4/4) ulaştı.' });
      }

      this.resetRateLimit(clientIp);
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
          activeSenders: new Map(), // senderSocketId -> senderInfo (supports up to 4 concurrent senders!)
          maxSenders: 4
        };

        this.receiversByPin.set(pin, receiverData);
        this.pinsByReceiverSocket.set(socket.id, pin);

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

        // Multi-Stream check (up to 4 streams simultaneously)
        if (receiver.activeSenders && receiver.activeSenders.size >= (receiver.maxSenders || 4) && !receiver.activeSenders.has(socket.id)) {
          if (typeof callback === 'function') {
            callback({ ok: false, error: 'Bu alıcı ekranı maksimum yayın kapasitesine ulaştı (4/4 cihaz aktif).' });
          }
          return;
        }

        this.resetRateLimit(clientIp);

        const ua = socket.handshake.headers['user-agent'] || 'unknown';
        console.log(`[HomakCast] Pairing request from IP: ${clientIp}, UA: ${ua}, Data:`, data);

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

      // 4. WebRTC Signaling forwarding (with senderId for multi-screen)
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
        const targetSenderId = data.senderId;
        if (targetSenderId) {
          this.io.to(targetSenderId).emit('webrtc-answer', {
            sdp: data.sdp
          });
        }
      });

      socket.on('webrtc-candidate', (data) => {
        // Forward from sender to receiver
        if (this.activePairs.has(socket.id)) {
          const receiverId = this.activePairs.get(socket.id);
          this.io.to(receiverId).emit('webrtc-candidate', {
            candidate: data.candidate,
            senderId: socket.id
          });
        } else if (data.senderId) {
          // Forward from receiver to specific sender
          this.io.to(data.senderId).emit('webrtc-candidate', {
            candidate: data.candidate
          });
        }
      });

      // 5. Annotation & Laser Pointer forwarding
      socket.on('stream-annotation', (data) => {
        const receiverId = this.activePairs.get(socket.id);
        if (receiverId) {
          this.io.to(receiverId).emit('stream-annotation', {
            ...data,
            senderId: socket.id
          });
        }
      });

      // 6. Stream Termination
      socket.on('stop-stream', () => {
        this.terminateStreamForSocket(socket.id, 'Kullanıcı yayını durdurdu.');
      });

      // 7. Manual PIN Refresh
      socket.on('refresh-pin', () => {
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
