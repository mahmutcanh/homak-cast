(() => {
  // Non-blocking notice (replaces window.alert, which freezes the renderer).
  function notify(message) {
    const el = document.createElement('div');
    el.setAttribute('role', 'alert');
    el.textContent = String(message);
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:90vw;' +
      'padding:12px 18px;border-radius:10px;background:#111827;color:#fff;font:14px/1.4 sans-serif;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.4);z-index:99999;white-space:pre-line;';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  // Navigation & Mode Tabs
  const tabReceiverMode = document.getElementById('tabReceiverMode');
  const tabSenderMode = document.getElementById('tabSenderMode');
  const standbyView = document.getElementById('standbyView');
  const streamingView = document.getElementById('streamingView');
  const desktopSenderView = document.getElementById('desktopSenderView');
  const videoGrid = document.getElementById('videoGrid');

  // Receiver Elements
  const pinCode = document.getElementById('pinCode');
  const qrImage = document.getElementById('qrImage');
  const connectUrlText = document.getElementById('connectUrlText');
  const refreshPinBtn = document.getElementById('refreshPinBtn');
  const displaySelect = document.getElementById('displaySelect');
  const audioOutputSelect = document.getElementById('audioOutputSelect');
  const toggleFullscreenBtn = document.getElementById('toggleFullscreenBtn');
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const minimizeBtn = document.getElementById('minimizeBtn');
  const closeToTrayBtn = document.getElementById('closeToTrayBtn');
  const activeSenderName = document.getElementById('activeSenderName');
  const liveFps = document.getElementById('liveFps');
  const liveResolution = document.getElementById('liveResolution');
  const floatingMuteBtn = document.getElementById('floatingMuteBtn');
  const floatingFullscreenBtn = document.getElementById('floatingFullscreenBtn');
  const disconnectCastBtn = document.getElementById('disconnectCastBtn');
  const floatingPinBadge = document.getElementById('floatingPinBadge');
  const watermarkPinText = document.getElementById('watermarkPinText');
  const watermarkCountText = document.getElementById('watermarkCountText');
  const watermarkDomainText = document.getElementById('watermarkDomainText');
  const stepDomainText = document.getElementById('stepDomainText');
  const bottomCloudDomainText = document.getElementById('bottomCloudDomainText');
  const btnModeCloud = document.getElementById('btnModeCloud');
  const btnModeLan = document.getElementById('btnModeLan');
  const floatingRecordBtn = document.getElementById('floatingRecordBtn');
  const recordBtnIcon = document.getElementById('recordBtnIcon');
  const recordBtnText = document.getElementById('recordBtnText');
  const recordingIndicatorBadge = document.getElementById('recordingIndicatorBadge');
  const recordingTimer = document.getElementById('recordingTimer');
  const floatingClearDrawBtn = document.getElementById('floatingClearDrawBtn');
  const annotationCanvas = document.getElementById('annotationCanvas');
  const lanIpText = document.getElementById('lanIpText');

  // Desktop Sender Elements
  const desktopCastForm = document.getElementById('desktopCastForm');
  const desktopPinInput = document.getElementById('desktopPinInput');
  const desktopSourceSelect = document.getElementById('desktopSourceSelect');
  const desktopFpsSelect = document.getElementById('desktopFpsSelect');
  const desktopAudioToggle = document.getElementById('desktopAudioToggle');
  const desktopCastError = document.getElementById('desktopCastError');
  const desktopCastInfo = document.getElementById('desktopCastInfo');
  const startDesktopCastBtn = document.getElementById('startDesktopCastBtn');
  const desktopActiveStreamBox = document.getElementById('desktopActiveStreamBox');
  const desktopPreviewVideo = document.getElementById('desktopPreviewVideo');
  const stopDesktopCastBtn = document.getElementById('stopDesktopCastBtn');

  // Approval Modal
  const approvalModal = document.getElementById('approvalModal');
  const approvalDeviceName = document.getElementById('approvalDeviceName');
  const approvalDeviceIp = document.getElementById('approvalDeviceIp');
  const approvalCountdown = document.getElementById('approvalCountdown');
  const acceptPairingBtn = document.getElementById('acceptPairingBtn');
  const rejectPairingBtn = document.getElementById('rejectPairingBtn');

  // Settings Modal
  const settingsModal = document.getElementById('settingsModal');
  const closeSettingsModalBtn = document.getElementById('closeSettingsModalBtn');
  const settingSignalingUrl = document.getElementById('settingSignalingUrl');
  const settingDeviceName = document.getElementById('settingDeviceName');
  const settingCompanyName = document.getElementById('settingCompanyName');
  const brandBadge = document.getElementById('brandBadge');
  const brandLogo = document.getElementById('brandLogo');
  const brandNameText = document.getElementById('brandNameText');
  const settingLogoPreview = document.getElementById('settingLogoPreview');
  const pickLogoBtn = document.getElementById('pickLogoBtn');
  const clearLogoBtn = document.getElementById('clearLogoBtn');
  const logoHint = document.getElementById('logoHint');
  const openAdminBtn = document.getElementById('openAdminBtn');
  const adminModal = document.getElementById('adminModal');
  const closeAdminModalBtn = document.getElementById('closeAdminModalBtn');
  const adminAuthView = document.getElementById('adminAuthView');
  const adminAuthHint = document.getElementById('adminAuthHint');
  const adminPasswordInput = document.getElementById('adminPasswordInput');
  const adminPasswordRepeatGroup = document.getElementById('adminPasswordRepeatGroup');
  const adminPasswordRepeat = document.getElementById('adminPasswordRepeat');
  const adminAuthMessage = document.getElementById('adminAuthMessage');
  const adminAuthBtn = document.getElementById('adminAuthBtn');
  const adminPanelView = document.getElementById('adminPanelView');
  const adminLicenseStatus = document.getElementById('adminLicenseStatus');
  const licenseHolder = document.getElementById('licenseHolder');
  const licenseExpires = document.getElementById('licenseExpires');
  const licenseMaxDevices = document.getElementById('licenseMaxDevices');
  const licenseLockBranding = document.getElementById('licenseLockBranding');
  const adminNewPassword = document.getElementById('adminNewPassword');
  const adminMessage = document.getElementById('adminMessage');
  const adminSaveBtn = document.getElementById('adminSaveBtn');
  const adminLogoutBtn = document.getElementById('adminLogoutBtn');
  const settingPort = document.getElementById('settingPort');
  const settingRequireApproval = document.getElementById('settingRequireApproval');
  const settingAutoStart = document.getElementById('settingAutoStart');
  const settingShowHeaderInFullscreen = document.getElementById('settingShowHeaderInFullscreen');
  const settingFps = document.getElementById('settingFps');
  const settingStunServers = document.getElementById('settingStunServers');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const openRecordingsBtn = document.getElementById('openRecordingsBtn');
  const topNav = document.getElementById('topNav');

  // State
  let socket = null;
  // Multi-peer map: senderId -> { pc, stream, tile, senderInfo, videoEl }
  const activePeers = new Map();
  let senderPeerConnection = null;
  let outgoingStream = null;
  let currentSettings = {};
  let currentPin = '';
  let activePendingApprovalSenderId = null;
  let approvalTimer = null;
  let selectedAudioDeviceId = 'default';
  let appMode = 'receiver'; // 'receiver' or 'sender'
  let isFullscreenState = false;
  let isStreamingState = false;
  let activeAddressMode = 'lan'; // 'lan' = this PC is the server (default), 'cloud' = cast.homaklab.com
  let cloudBaseUrl = 'https://cast.homaklab.com';
  let lanBaseUrl = '';
  let activeConnectUrl = '';

  // Recording State
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordingTimerInterval = null;
  let recordingStartTime = 0;

  // Laser Pointer & Annotation State
  let animContext = null;
  let laserPoint = null; // { x, y, lastTime }
  let animFrameId = null;

  // Initialize
  async function init() {
    initCanvas();

    currentSettings = await window.electronAPI.getSettings();
    customLogo = await window.electronAPI.getLogo();
    applyBranding();
    window.electronAPI.adminStatus().then((state) => {
      if (state && state.status && state.status.expired) notify('Lisans süresi dolmuş: yeni yayın kabul edilmiyor. Yönetici ekranından yenileyin.');
    }).catch(() => {});
    activeAddressMode = currentSettings.preferredMode === 'cloud' ? 'cloud' : 'lan';
    connectSignaling(signalingUrlFor(activeAddressMode), true);

    setupDisplays();
    setupAudioDevices();
    setupDesktopSenderSources();
    setupLanAddressInfo();
    setupUIEvents();
  }

  function signalingUrlFor(mode) {
    if (mode === 'lan') return `http://localhost:${currentSettings.port || 5240}`;
    return currentSettings.signalingServerUrl || 'https://cast.homaklab.com';
  }

  // (Re)connect to a signaling server. The PIN is issued by the server we register with, so the
  // QR/PIN shown must always match the server the phone will reach (cloud vs. this PC's LAN server).
  function connectSignaling(url, allowLocalFallback) {
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
    }
    const s = io(url, { timeout: 5000, reconnectionAttempts: 3 });
    socket = s;
    let connected = false;
    console.log(`[Receiver] Connecting to signaling server: ${url}`);

    s.on('connect', () => {
      connected = true;
      console.log(`[Receiver] Connected to signaling server: ${url}`);
      registerWithServer();
    });

    s.on('connect_error', (err) => {
      console.warn(`[Receiver] Failed to connect to ${url}:`, err.message);
      if (!connected && allowLocalFallback && socket === s) {
        const fallbackMode = activeAddressMode === 'lan' ? 'cloud' : 'lan';
        console.log(`[Receiver] Falling back to ${fallbackMode} server`);
        activeAddressMode = fallbackMode;
        connectSignaling(signalingUrlFor(fallbackMode), false);
      }
    });

    setupSocketEvents();
  }

  function switchAddressMode(mode) {
    if (mode === activeAddressMode) return;
    if (activePeers.size > 0) {
      notify('Yayın sürerken bağlantı modu değiştirilemez.');
      return;
    }
    activeAddressMode = mode;
    currentPin = '';
    connectSignaling(signalingUrlFor(mode), false);
    window.electronAPI.saveSettings({ preferredMode: mode })
      .then((saved) => { if (saved) currentSettings = saved; })
      .catch((err) => console.warn('Could not save preferred mode:', err));
  }

  function initCanvas() {
    if (!annotationCanvas) return;
    annotationCanvas.width = window.innerWidth;
    annotationCanvas.height = window.innerHeight;
    animContext = annotationCanvas.getContext('2d');

    window.addEventListener('resize', () => {
      annotationCanvas.width = window.innerWidth;
      annotationCanvas.height = window.innerHeight;
    });

    // Start laser render loop
    function renderLaser() {
      if (laserPoint && animContext) {
        const now = Date.now();
        const age = now - laserPoint.lastTime;
        if (age < 1200) {
          // Draw laser glow
          const px = laserPoint.x * annotationCanvas.width;
          const py = laserPoint.y * annotationCanvas.height;
          const alpha = Math.max(0, 1 - (age / 1200));

          animContext.save();
          animContext.beginPath();
          const radGrad = animContext.createRadialGradient(px, py, 2, px, py, 22);
          radGrad.addColorStop(0, `rgba(255, 23, 68, ${alpha})`);
          radGrad.addColorStop(0.4, `rgba(255, 61, 0, ${alpha * 0.7})`);
          radGrad.addColorStop(1, 'rgba(255, 61, 0, 0)');
          animContext.fillStyle = radGrad;
          animContext.arc(px, py, 22, 0, Math.PI * 2);
          animContext.fill();

          // Bright laser core
          animContext.beginPath();
          animContext.fillStyle = `rgba(255, 255, 255, ${alpha})`;
          animContext.arc(px, py, 4, 0, Math.PI * 2);
          animContext.fill();
          animContext.restore();
        } else {
          laserPoint = null;
        }
      }
      animFrameId = requestAnimationFrame(renderLaser);
    }
    renderLaser();
  }

  function clearCanvas() {
    if (animContext && annotationCanvas) {
      animContext.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
      laserPoint = null;
    }
  }

  function getCleanHost(urlStr) {
    if (!urlStr) return '';
    try {
      const u = new URL(urlStr);
      return u.host;
    } catch (e) {
      return urlStr.replace(/^https?:\/\//i, '').split('/')[0];
    }
  }

  function refreshActiveAddressUI() {
    if (!currentPin) return;
    if (activeAddressMode === 'lan' && !lanBaseUrl) return; // wait for LAN address detection

    const port = currentSettings.port || 5240;
    cloudBaseUrl = 'https://cast.homaklab.com';
    let targetBaseUrl = 'https://cast.homaklab.com';
    if (activeAddressMode === 'lan' && lanBaseUrl) {
      targetBaseUrl = lanBaseUrl;
    }
    targetBaseUrl = targetBaseUrl.replace(/\/+$/, '');
    const cleanHost = getCleanHost(targetBaseUrl);
    // LAN: the QR is an https URL for browsers; "hp" tells the Android app which plain-HTTP port to use.
    const httpPortHint = activeAddressMode === 'lan' ? `&hp=${currentSettings.port || 5240}` : '';
    activeConnectUrl = `${targetBaseUrl}/?code=${currentPin}${httpPortHint}`;

    // Cloud domain is intentionally not shown on screen; the LAN address stays visible.
    if (stepDomainText) stepDomainText.textContent = '';
    if (connectUrlText) connectUrlText.textContent = '';
    if (watermarkDomainText) watermarkDomainText.textContent = '';
    if (bottomCloudDomainText) bottomCloudDomainText.textContent = '';
    if (btnModeCloud && btnModeLan) {
      if (activeAddressMode === 'lan') {
        btnModeLan.classList.add('active');
        btnModeCloud.classList.remove('active');
      } else {
        btnModeCloud.classList.add('active');
        btnModeLan.classList.remove('active');
      }
    }

    // Generate high-contrast QR code for the exact active URL
    const localApi = `http://localhost:${port}`;
    const cloudApi = 'https://cast.homaklab.com';
    const [firstApi, secondApi] = activeAddressMode === 'lan' ? [localApi, cloudApi] : [cloudApi, localApi];
    const fetchQr = (base) => fetch(`${base}/api/qr?code=${currentPin}&url=${encodeURIComponent(activeConnectUrl)}`)
      .then(r => r.json())
      .then(data => {
        if (!data || !data.ok || !data.qr) throw new Error('QR yanıtı geçersiz');
        qrImage.src = data.qr;
      });
    fetchQr(firstApi)
      .catch(() => fetchQr(secondApi))
      .catch(err => console.warn('QR error:', err));
  }

  let lastLanSignature = '';

  async function setupLanAddressInfo() {
    try {
      const addresses = await window.electronAPI.getNetworkAddresses();
      const port = currentSettings.port || 5240;
      // Every real network card (Ethernet + Wi-Fi, ...) gets its own address; VM/VPN adapters are skipped.
      let lanList = addresses.filter(a => a.isLan);
      if (!lanList.length) lanList = addresses.filter(a => a.isLocal);
      if (!lanList.length) lanList = addresses.slice(0, 1);
      if (!lanList.length) return;

      // Prefer the HTTPS listener: phones only allow screen capture in a secure context.
      let httpsPort = null;
      let webPorts = [];
      try {
        const status = await fetch(`http://localhost:${port}/api/status`).then(r => r.json());
        httpsPort = status && status.httpsPort;
        webPorts = (status && status.webPorts) || [];
      } catch (e) {
        console.warn('Could not read local server status:', e);
      }

      const urlFor = (ip) => {
        if (webPorts.includes(443)) return `https://${ip}`;
        if (httpsPort) return `https://${ip}:${httpsPort}`;
        if (webPorts.includes(80)) return `http://${ip}`;
        return `http://${ip}:${port}`;
      };
      const urls = lanList.map(a => urlFor(a.address));
      const signature = urls.join('|');
      if (signature === lastLanSignature) return; // network unchanged: leave QR and text alone
      lastLanSignature = signature;

      lanBaseUrl = urls[0];
      if (lanIpText) {
        lanIpText.style.whiteSpace = 'pre-line';
        lanIpText.textContent = urls.join('\n');
      }
      refreshActiveAddressUI();
    } catch (e) {
      console.warn('Could not get network addresses:', e);
    }
  }

  // Wi-Fi / Ethernet can be plugged or unplugged at any time: re-read the addresses regularly.
  setInterval(setupLanAddressInfo, 5000);

  function registerWithServer() {
    if (!socket) return;
    socket.emit('register-receiver', {
      deviceName: currentSettings.deviceName || 'Homak Cast Receiver',
      requireApproval: !!currentSettings.requireApproval
    }, (res) => {
      if (res && res.ok) {
        updatePinDisplay(res.pin, res.qrUrl);
      }
    });
  }

  // Socket.IO Events
  function setupSocketEvents() {
    socket.on('pin-update', ({ pin, qrUrl }) => {
      updatePinDisplay(pin, qrUrl);
    });

    // Approval Request
    socket.on('approval-request', ({ senderId, senderInfo }) => {
      activePendingApprovalSenderId = senderId;
      showApprovalModal(senderInfo);
    });

    // Sender Connected (Receiver role)
    socket.on('sender-connected', ({ senderId, senderInfo, iceServers }) => {
      console.log(`[Receiver] Sender connected: ${senderId}`, senderInfo);
      setupPeerConnectionForSender(senderId, senderInfo, iceServers);
    });

    // WebRTC Offer from Sender
    socket.on('webrtc-offer', async ({ sdp, senderId }) => {
      const peer = activePeers.get(senderId);
      if (!peer || !peer.pc) return;
      try {
        await peer.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));

        // Drain any early buffered candidates
        if (peer.pendingCandidates && peer.pendingCandidates.length > 0) {
          for (const cand of peer.pendingCandidates) {
            await peer.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
          peer.pendingCandidates = [];
        }

        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);

        socket.emit('webrtc-answer', { sdp: answer.sdp, senderId });
        console.log(`[WebRTC] Answer sent to sender ${senderId}.`);
      } catch (err) {
        console.error('Error handling WebRTC offer:', err);
      }
    });

    // WebRTC Candidate
    socket.on('webrtc-candidate', async (data) => {
      if (appMode === 'sender') {
        if (senderPeerConnection && data.candidate) {
          try {
            await senderPeerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (err) {
            console.error('Error adding ICE candidate (sender):', err);
          }
        }
      } else {
        const senderId = data.senderId;
        const peer = activePeers.get(senderId);
        if (peer && peer.pc && data.candidate) {
          try {
            if (peer.pc.remoteDescription && peer.pc.remoteDescription.type) {
              await peer.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } else {
              if (!peer.pendingCandidates) peer.pendingCandidates = [];
              peer.pendingCandidates.push(data.candidate);
            }
          } catch (err) {
            console.error('Error adding ICE candidate (receiver):', err);
          }
        }
      }
    });

    // WebRTC Answer (Sender role)
    socket.on('webrtc-answer', async ({ sdp }) => {
      if (senderPeerConnection) {
        try {
          await senderPeerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
          console.log('[Desktop Sender] Remote answer set successfully.');
        } catch (err) {
          console.error('[Desktop Sender] Failed to set answer:', err);
        }
      }
    });

    // Stream Annotation / Laser Pointer Event
    socket.on('stream-annotation', (data) => {
      if (!animContext) return;
      if (data.type === 'laser') {
        laserPoint = { x: data.x, y: data.y, lastTime: Date.now() };
      } else if (data.type === 'draw') {
        animContext.save();
        animContext.strokeStyle = data.color || '#ff1744';
        animContext.lineWidth = data.size || 4;
        animContext.lineCap = 'round';
        animContext.beginPath();
        animContext.moveTo(data.x0 * annotationCanvas.width, data.y0 * annotationCanvas.height);
        animContext.lineTo(data.x1 * annotationCanvas.width, data.y1 * annotationCanvas.height);
        animContext.stroke();
        animContext.restore();
      } else if (data.type === 'clear') {
        clearCanvas();
      }
    });

    // Individual sender disconnected (Split-screen)
    socket.on('sender-disconnected', ({ senderId, remainingStreams }) => {
      console.log(`[Receiver] Sender ${senderId} disconnected. Remaining: ${remainingStreams}`);
      removeSenderTile(senderId);
    });

    // All streams ended
    socket.on('all-streams-ended', ({ reason }) => {
      console.log('[Receiver] All streams ended:', reason);
      if (appMode === 'sender') {
        stopDesktopOutgoingCast('Yayın alıcı tarafından sonlandırıldı.');
      } else {
        returnToStandbyView();
      }
    });

    // Desktop sender events
    socket.on('pairing-approved', async (config) => {
      if (appMode !== 'sender') return;
      desktopCastInfo.style.display = 'none';
      await startOutgoingStream(config);
    });

    socket.on('pairing-rejected', ({ reason }) => {
      if (appMode !== 'sender') return;
      showDesktopError(reason || 'Karşı cihaz yayını kabul etmedi.');
      stopDesktopOutgoingCast();
    });
  }

  function updatePinDisplay(pin, qrUrl) {
    if (!pin) return;
    currentPin = pin;
    const formattedPin = pin.slice(0, 3) + ' ' + pin.slice(3);
    pinCode.textContent = formattedPin;
    if (watermarkPinText) watermarkPinText.textContent = `PIN: ${formattedPin}`;
    refreshActiveAddressUI();
  }

  // --- MULTI-SCREEN RECEIVER WebRTC ---
  function setupPeerConnectionForSender(senderId, senderInfo, iceServers) {
    // If peer already exists, close it
    if (activePeers.has(senderId)) {
      const old = activePeers.get(senderId);
      if (old.pc) old.pc.close();
      if (old.tile && old.tile.parentNode) old.tile.parentNode.removeChild(old.tile);
      activePeers.delete(senderId);
    }

    const pc = new RTCPeerConnection({
      iceServers: iceServers || [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    const stream = new MediaStream();

    // Create Tile in Video Grid
    const tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.id = `tile-${senderId}`;

    const videoEl = document.createElement('video');
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    videoEl.muted = false;
    tile.appendChild(videoEl);

    // Label tag
    const tag = document.createElement('div');
    tag.className = 'tile-tag';
    let label = senderInfo.model || senderInfo.deviceName || 'Cihaz';
    if (senderInfo.os && !label.includes(senderInfo.os)) label += ` (${senderInfo.os})`;
    const dot = document.createElement('span');
    dot.className = 'dot-green';
    tag.appendChild(dot);
    tag.appendChild(document.createTextNode(` ${label}`));
    tile.appendChild(tag);

    // Remove primary placeholder if present
    const primaryTile = document.getElementById('tile-primary');
    if (primaryTile && primaryTile.parentNode) {
      primaryTile.parentNode.removeChild(primaryTile);
    }

    videoGrid.appendChild(tile);

    activePeers.set(senderId, { pc, stream, tile, senderInfo, videoEl, pendingCandidates: [] });
    updateVideoGridLayout();

    // Track handling
    pc.ontrack = (event) => {
      console.log(`[Receiver] Track from ${senderId}:`, event.track.kind);
      
      const incomingStream = (event.streams && event.streams[0]) ? event.streams[0] : stream;
      if (!event.streams || !event.streams[0]) {
        stream.addTrack(event.track);
      }
      videoEl.srcObject = incomingStream;

      const playVideo = () => {
        const p = videoEl.play();
        if (p !== undefined) {
          p.catch(err => {
            console.warn('[Receiver] Autoplay blocked, retrying muted:', err);
            videoEl.muted = true;
            videoEl.play().catch(e => console.error('[Receiver] Play failed:', e));
          });
        }
      };

      playVideo();
      videoEl.onloadedmetadata = () => playVideo();

      switchToStreamingView();
      applyAudioOutputToVideo(videoEl, selectedAudioDeviceId);

      if (event.track.kind === 'video') {
        event.track.onloadedmetadata = () => {
          playVideo();
          const s = event.track.getSettings();
          if (liveResolution) liveResolution.textContent = `${s.width || 1920}x${s.height || 1080}`;
          if (liveFps) liveFps.textContent = `${s.frameRate || 60} FPS`;
        };
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-candidate', { candidate: event.candidate, senderId });
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'failed') {
        removeSenderTile(senderId);
      } else if (state === 'disconnected') {
        // Transient disconnects often recover; wait before dropping the tile.
        setTimeout(() => {
          const peer = activePeers.get(senderId);
          if (peer && peer.pc === pc && pc.connectionState === 'disconnected') {
            removeSenderTile(senderId);
          }
        }, 8000);
      }
    };
  }

  function removeSenderTile(senderId) {
    const peer = activePeers.get(senderId);
    if (peer) {
      if (peer.pc) peer.pc.close();
      if (peer.tile && peer.tile.parentNode) peer.tile.parentNode.removeChild(peer.tile);
      activePeers.delete(senderId);
    }

    updateVideoGridLayout();

    if (activePeers.size === 0) {
      returnToStandbyView();
    }
  }

  function updateVideoGridLayout() {
    const count = activePeers.size;
    videoGrid.className = 'video-grid';
    if (count <= 1) {
      videoGrid.classList.add('grid-1');
    } else if (count === 2) {
      videoGrid.classList.add('grid-2');
    } else if (count === 3) {
      videoGrid.classList.add('grid-3');
    } else {
      videoGrid.classList.add('grid-4');
    }

    if (watermarkCountText) {
      watermarkCountText.textContent = `(${count}/4)`;
      watermarkCountText.style.display = count > 1 ? 'inline' : 'none';
    }

    if (activeSenderName) {
      if (count === 1) {
        const p = Array.from(activePeers.values())[0];
        activeSenderName.textContent = p.senderInfo.model || p.senderInfo.deviceName || 'Cihaz';
      } else if (count > 1) {
        activeSenderName.textContent = `Çoklu Ekran (${count} Cihaz)`;
      }
    }
  }

  function updateHeaderVisibility() {
    const showHeader = currentSettings.showHeaderInFullscreen === true;
    if ((isFullscreenState || isStreamingState) && !showHeader) {
      if (topNav) topNav.style.display = 'none';
    } else {
      if (topNav) topNav.style.display = 'flex';
    }
  }

  async function switchToStreamingView() {
    isStreamingState = true;
    standbyView.style.display = 'none';
    desktopSenderView.style.display = 'none';
    streamingView.style.display = 'flex';

    try {
      const isFull = await window.electronAPI.isFullscreen();
      isFullscreenState = isFull;
      if (!isFull) {
        await window.electronAPI.toggleFullscreen();
        isFullscreenState = true;
      }
    } catch (err) {
      console.warn('Auto fullscreen error:', err);
    }

    updateHeaderVisibility();
  }

  async function returnToStandbyView() {
    isStreamingState = false;

    // Stop recording if active
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      stopRecording();
    }

    // Close all peers
    for (const [id, peer] of activePeers.entries()) {
      if (peer.pc) peer.pc.close();
      if (peer.tile && peer.tile.parentNode) peer.tile.parentNode.removeChild(peer.tile);
    }
    activePeers.clear();
    clearCanvas();

    // Reset video grid with empty primary tile
    videoGrid.innerHTML = `
      <div class="video-tile" id="tile-primary">
        <video id="remoteVideo" autoplay playsinline></video>
      </div>
    `;
    videoGrid.className = 'video-grid grid-1';

    streamingView.style.display = 'none';
    if (appMode === 'receiver') {
      standbyView.style.display = 'flex';
    }

    updateHeaderVisibility();
  }

  // --- ONE-CLICK SESSION RECORDING ---
  function startRecording() {
    const firstPeer = Array.from(activePeers.values())[0];
    if (!firstPeer || !firstPeer.stream) {
      notify('Kayıt başlatılacak aktif yayın akışı bulunamadı.');
      return;
    }

    recordedChunks = [];
    let options = { mimeType: 'video/webm;codecs=vp9,opus' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: 'video/webm' };
    }

    try {
      mediaRecorder = new MediaRecorder(firstPeer.stream, options);
    } catch (e) {
      mediaRecorder = new MediaRecorder(firstPeer.stream);
    }

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = async () => {
      clearInterval(recordingTimerInterval);
      if (recordingIndicatorBadge) recordingIndicatorBadge.style.display = 'none';
      if (recordBtnIcon) recordBtnIcon.textContent = '⏺';
      if (recordBtnText) recordBtnText.textContent = 'Kaydet';
      if (floatingRecordBtn) floatingRecordBtn.classList.remove('btn-recording');

      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const arrayBuffer = await blob.arrayBuffer();
      const now = new Date();
      const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
      const filename = `HomakCast_${timestamp}.webm`;

      const res = await window.electronAPI.saveRecording({ buffer: arrayBuffer, filename });
      if (res && res.ok) {
        notify(`Yayın kaydı başarıyla kaydedildi:\n${res.filePath}`);
      } else {
        notify(`Kayıt kaydedilirken bir hata oluştu: ${res ? res.error : 'Bilinmeyen hata'}`);
      }
    };

    mediaRecorder.start(1000);
    recordingStartTime = Date.now();
    if (recordingIndicatorBadge) recordingIndicatorBadge.style.display = 'flex';
    if (recordBtnIcon) recordBtnIcon.textContent = '⏹';
    if (recordBtnText) recordBtnText.textContent = 'Durdur';
    if (floatingRecordBtn) floatingRecordBtn.classList.add('btn-recording');

    recordingTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
      const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const s = String(elapsed % 60).padStart(2, '0');
      if (recordingTimer) recordingTimer.textContent = `${m}:${s}`;
    }, 1000);
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  }

  // --- DESKTOP SENDER MODE (Cast this PC to another screen) ---
  async function setupDesktopSenderSources() {
    try {
      const sources = await window.electronAPI.getScreenSources();
      desktopSourceSelect.innerHTML = '';
      sources.forEach(src => {
        const option = document.createElement('option');
        option.value = src.id;
        option.textContent = src.name;
        desktopSourceSelect.appendChild(option);
      });
    } catch (err) {
      console.warn('Failed to get desktop screen sources:', err);
    }
  }

  startDesktopCastBtn.addEventListener('click', async () => {
    if (activeAddressMode === 'lan') {
      notify("Başka bir PC'ye yayın için Alıcı sekmesinde \"Bulut\" moduna geçin. Yerel modda yalnızca bu PC'ye bağlanılır.");
      return;
    }
    const pin = desktopPinInput.value.trim().replace(/\s+/g, '');
    if (!pin || pin.length !== 6) {
      showDesktopError('Lütfen yansıtılacak ekrandaki 6 haneli kodu girin.');
      return;
    }

    hideDesktopError();
    desktopCastInfo.textContent = 'Hedef ekrana bağlanılıyor...';
    desktopCastInfo.style.display = 'block';

    socket.emit('request-pairing', {
      pin,
      deviceName: 'Windows Masaüstü Uygulaması',
      model: 'Windows PC',
      os: 'Windows',
      browser: 'Homak Cast App'
    }, async (res) => {
      if (!res.ok) {
        showDesktopError(res.error);
        desktopCastInfo.style.display = 'none';
        return;
      }

      if (res.status === 'WAITING_APPROVAL') {
        desktopCastInfo.textContent = 'Karşı ekrandan yayın onayı bekleniyor...';
      }
    });
  });

  async function startOutgoingStream(config = {}) {
    try {
      const sourceId = desktopSourceSelect.value;
      const targetFps = parseInt(desktopFpsSelect.value, 10) || 60;
      const includeAudio = desktopAudioToggle.checked;

      const constraints = {
        audio: includeAudio ? {
          mandatory: {
            chromeMediaSource: 'desktop'
          }
        } : false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            minWidth: 1280,
            maxWidth: 3840,
            minHeight: 720,
            maxHeight: 2160,
            maxFrameRate: targetFps
          }
        }
      };

      outgoingStream = await navigator.mediaDevices.getUserMedia(constraints);
      desktopPreviewVideo.srcObject = outgoingStream;

      const vTrack = outgoingStream.getVideoTracks()[0];
      vTrack.onended = () => {
        stopDesktopOutgoingCast('Ekran paylaşımı durduruldu.');
        socket.emit('stop-stream');
      };

      senderPeerConnection = new RTCPeerConnection({
        iceServers: config.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }]
      });

      outgoingStream.getTracks().forEach(track => {
        senderPeerConnection.addTrack(track, outgoingStream);
      });

      senderPeerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc-candidate', { candidate: event.candidate });
        }
      };

      const offer = await senderPeerConnection.createOffer();
      await senderPeerConnection.setLocalDescription(offer);
      socket.emit('webrtc-offer', { sdp: offer.sdp });

      desktopCastForm.style.display = 'none';
      desktopActiveStreamBox.style.display = 'block';

    } catch (err) {
      console.error('Desktop cast error:', err);
      showDesktopError('Ekran yakalama hatası: ' + err.message);
      stopDesktopOutgoingCast();
    }
  }

  stopDesktopCastBtn.addEventListener('click', () => {
    socket.emit('stop-stream');
    stopDesktopOutgoingCast('Yayın durduruldu.');
  });

  function stopDesktopOutgoingCast(msg) {
    if (outgoingStream) {
      outgoingStream.getTracks().forEach(t => t.stop());
      outgoingStream = null;
    }
    if (desktopPreviewVideo) {
      desktopPreviewVideo.srcObject = null;
    }
    if (senderPeerConnection) {
      senderPeerConnection.close();
      senderPeerConnection = null;
    }

    desktopActiveStreamBox.style.display = 'none';
    desktopCastForm.style.display = 'block';

    if (msg) showDesktopError(msg);
  }

  function showDesktopError(msg) {
    desktopCastError.textContent = msg;
    desktopCastError.style.display = 'block';
  }

  function hideDesktopError() {
    desktopCastError.style.display = 'none';
  }

  // --- Display & Audio Devices ---
  async function setupDisplays() {
    const displays = await window.electronAPI.getDisplays();
    populateDisplaySelect(displays);

    window.electronAPI.onDisplaysUpdated((updatedDisplays) => {
      populateDisplaySelect(updatedDisplays);
    });

    displaySelect.addEventListener('change', async (e) => {
      const displayId = parseInt(e.target.value, 10);
      await window.electronAPI.setDisplay(displayId, false);
    });
  }

  function populateDisplaySelect(displays) {
    displaySelect.innerHTML = '';
    displays.forEach((disp) => {
      const option = document.createElement('option');
      option.value = disp.id;
      option.textContent = disp.label;
      if (disp.isCurrent) option.selected = true;
      displaySelect.appendChild(option);
    });
  }

  async function setupAudioDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = devices.filter(d => d.kind === 'audiooutput');

      audioOutputSelect.innerHTML = '';
      if (audioOutputs.length === 0) {
        const option = document.createElement('option');
        option.value = 'default';
        option.textContent = 'Varsayılan Hoparlör';
        audioOutputSelect.appendChild(option);
      } else {
        audioOutputs.forEach(device => {
          const option = document.createElement('option');
          option.value = device.deviceId;
          option.textContent = device.label || `Ses Çıkışı (${device.deviceId.slice(0, 5)})`;
          if (device.deviceId === currentSettings.audioOutputId) {
            option.selected = true;
            selectedAudioDeviceId = device.deviceId;
          }
          audioOutputSelect.appendChild(option);
        });
      }

      audioOutputSelect.addEventListener('change', (e) => {
        selectedAudioDeviceId = e.target.value;
        for (const peer of activePeers.values()) {
          applyAudioOutputToVideo(peer.videoEl, selectedAudioDeviceId);
        }
        window.electronAPI.saveSettings({ audioOutputId: selectedAudioDeviceId });
      });
    } catch (err) {
      console.warn('Audio device enumeration not fully supported:', err);
    }
  }

  function applyAudioOutputToVideo(vEl, deviceId) {
    if (vEl && typeof vEl.setSinkId === 'function') {
      vEl.setSinkId(deviceId).catch(err => console.error('Failed to setSinkId:', err));
    }
  }

  // --- Approval Modal Logic ---
  function showApprovalModal(senderInfo) {
    approvalDeviceName.textContent = senderInfo.model || senderInfo.deviceName || 'Bilinmeyen Cihaz';
    approvalDeviceIp.textContent = senderInfo.ip || 'Yerel Ağ';
    approvalModal.style.display = 'flex';

    let timeLeft = 30;
    approvalCountdown.style.width = '100%';

    clearInterval(approvalTimer);
    approvalTimer = setInterval(() => {
      timeLeft -= 1;
      const pct = (timeLeft / 30) * 100;
      approvalCountdown.style.width = `${pct}%`;

      if (timeLeft <= 0) {
        clearInterval(approvalTimer);
        handleApprovalDecision(false);
      }
    }, 1000);
  }

  function hideApprovalModal() {
    clearInterval(approvalTimer);
    approvalModal.style.display = 'none';
  }

  function handleApprovalDecision(approved) {
    hideApprovalModal();
    if (activePendingApprovalSenderId && socket) {
      socket.emit('approval-decision', { senderId: activePendingApprovalSenderId, approved });
    }
    activePendingApprovalSenderId = null;
  }

  // --- Company branding (window title, header badge, standby title) ---
  const DEFAULT_COMPANY = 'Cast';
  const DEFAULT_LOGO_SRC = 'assets/lol-logo.png';
  const LOGO_HINT = 'PNG veya JPG, en fazla 5 MB. Seçilmezse varsayılan logo kullanılır.';
  let customLogo = null; // data URL of the logo chosen in settings, or null for the bundled one

  function companyNameOf(settings) {
    const name = String((settings && settings.companyName) || '').trim();
    return name || DEFAULT_COMPANY;
  }

  function applyBranding() {
    const name = companyNameOf(currentSettings);
    const isDefault = name.toLowerCase() === DEFAULT_COMPANY.toLowerCase();
    document.title = name + ' — Cast Receiver';
    if (brandBadge) brandBadge.textContent = name.toUpperCase();
    // A chosen logo always wins. The bundled logo belongs to the default company, so other companies without
    // a logo get their name as the heading; with a logo, a non-default name is shown under it.
    if (brandLogo) {
      brandLogo.src = customLogo || DEFAULT_LOGO_SRC;
      brandLogo.style.display = customLogo ? '' : 'none';
    }
    if (brandNameText) {
      brandNameText.textContent = name;
      brandNameText.style.display = isDefault ? 'none' : '';
    }
    if (settingLogoPreview) settingLogoPreview.src = customLogo || DEFAULT_LOGO_SRC;
    if (clearLogoBtn) clearLogoBtn.disabled = !customLogo;
  }

  // --- Admin (local password, license, limits) ---
  function setBrandingControlsLocked(locked) {
    settingCompanyName.disabled = locked;
    pickLogoBtn.disabled = locked;
    clearLogoBtn.disabled = locked || !customLogo;
    if (locked) logoHint.textContent = 'Şirket adı ve logo yönetici tarafından kilitlenmiş.';
    else logoHint.textContent = LOGO_HINT;
  }

  async function refreshBrandingLock() {
    try {
      const state = await window.electronAPI.adminStatus();
      setBrandingControlsLocked(!!(state && state.license.lockBranding && !state.unlocked));
    } catch (err) {
      console.warn('Could not read admin state:', err);
    }
  }

  function licenseStatusText(state) {
    const s = state.status;
    if (s.expired) return 'Lisans durumu: SÜRESİ DOLMUŞ (yeni yayın kabul edilmiyor)';
    if (s.daysLeft === null) return `Lisans durumu: geçerli (süresiz), en fazla ${s.maxDevices} cihaz`;
    return `Lisans durumu: geçerli, ${s.daysLeft} gün kaldı, en fazla ${s.maxDevices} cihaz`;
  }

  function showAdminPanel(state) {
    adminAuthView.style.display = 'none';
    adminPanelView.style.display = '';
    adminLicenseStatus.textContent = licenseStatusText(state);
    licenseHolder.value = state.license.holder;
    licenseExpires.value = state.license.expiresAt;
    licenseMaxDevices.value = String(state.license.maxDevices);
    licenseLockBranding.checked = !!state.license.lockBranding;
    adminNewPassword.value = '';
    adminMessage.textContent = '';
  }

  function showAdminAuth(state) {
    adminPanelView.style.display = 'none';
    adminAuthView.style.display = '';
    adminPasswordInput.value = '';
    adminPasswordRepeat.value = '';
    adminAuthMessage.textContent = '';
    const setup = !state.hasPassword;
    adminPasswordRepeatGroup.style.display = setup ? '' : 'none';
    adminAuthBtn.textContent = setup ? 'Şifreyi Belirle' : 'Giriş';
    adminAuthHint.textContent = setup
      ? 'İlk kurulum: bu alıcı için bir yönetici şifresi belirleyin (en az 6 karakter). Lisans ve limitler bu şifreyle korunur.'
      : 'Lisans ve limitleri değiştirmek için yönetici şifresini girin.';
  }

  async function openAdmin() {
    const state = await window.electronAPI.adminStatus();
    adminModal.style.display = 'flex';
    if (state.unlocked) showAdminPanel(state); else showAdminAuth(state);
  }

  function closeAdmin() {
    adminModal.style.display = 'none';
    adminPasswordInput.value = '';
    adminPasswordRepeat.value = '';
    adminNewPassword.value = '';
    refreshBrandingLock();
  }

  async function submitAdminAuth() {
    const state = await window.electronAPI.adminStatus();
    const password = adminPasswordInput.value;
    let result;
    if (!state.hasPassword) {
      if (password !== adminPasswordRepeat.value) {
        adminAuthMessage.textContent = 'Şifreler eşleşmiyor.';
        return;
      }
      result = await window.electronAPI.adminSetPassword(password);
    } else {
      result = await window.electronAPI.adminLogin(password);
    }
    if (result && result.ok) {
      showAdminPanel(result.state);
    } else {
      adminAuthMessage.textContent = (result && result.error) || 'Giriş yapılamadı.';
    }
  }

  async function saveAdminLicense() {
    const result = await window.electronAPI.adminSaveLicense({
      holder: licenseHolder.value,
      expiresAt: licenseExpires.value,
      maxDevices: Number(licenseMaxDevices.value),
      lockBranding: licenseLockBranding.checked
    }, adminNewPassword.value);
    if (result && result.ok) {
      showAdminPanel(result.state);
      adminMessage.textContent = 'Kaydedildi.';
    } else {
      adminMessage.textContent = (result && result.error) || 'Kaydedilemedi.';
    }
  }

  async function adminLogout() {
    await window.electronAPI.adminLogout();
    closeAdmin();
  }

  async function pickLogo() {
    const result = await window.electronAPI.pickLogo();
    if (result && result.dataUrl) {
      customLogo = result.dataUrl;
      logoHint.textContent = LOGO_HINT;
      applyBranding();
    } else if (result && result.error) {
      logoHint.textContent = result.error;
    }
  }

  async function clearLogo() {
    await window.electronAPI.clearLogo();
    customLogo = null;
    logoHint.textContent = LOGO_HINT;
    applyBranding();
    refreshBrandingLock();
  }

  // --- Settings Modal Logic ---
  function openSettings() {
    settingCompanyName.value = companyNameOf(currentSettings);
    refreshBrandingLock();
    // The built-in default relay is not shown; only a user-entered custom address appears here.
    const savedRelay = currentSettings.signalingServerUrl || '';
    settingSignalingUrl.value = /^https?:\/\/cast\.homaklab\.com\/?$/i.test(savedRelay) ? '' : savedRelay;
    settingDeviceName.value = currentSettings.deviceName || 'Cast Receiver';
    settingPort.value = currentSettings.port || 5240;
    settingRequireApproval.checked = !!currentSettings.requireApproval;
    settingAutoStart.checked = !!currentSettings.autoStartOnBoot;
    settingShowHeaderInFullscreen.checked = !!currentSettings.showHeaderInFullscreen;
    settingFps.value = currentSettings.defaultFps || 60;

    const stuns = (currentSettings.stunServers || []).map(s => s.urls).join('\n');
    settingStunServers.value = stuns;

    settingsModal.style.display = 'flex';
  }

  function closeSettings() {
    settingsModal.style.display = 'none';
  }

  async function saveSettings() {
    const stunLines = settingStunServers.value
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .map(url => ({ urls: url }));

    // A device name still equal to the old default ("<company> Receiver") follows the new company name.
    const oldCompany = companyNameOf(currentSettings);
    const newCompany = settingCompanyName.value.trim().slice(0, 60) || DEFAULT_COMPANY;
    const typedDevice = settingDeviceName.value.trim();
    const newDeviceName = !typedDevice || typedDevice === oldCompany + ' Receiver'
      ? newCompany + ' Receiver'
      : typedDevice;

    const updated = {
      signalingServerUrl: settingSignalingUrl.value.trim(),
      companyName: newCompany,
      deviceName: newDeviceName,
      port: parseInt(settingPort.value, 10) || 5240,
      requireApproval: settingRequireApproval.checked,
      autoStartOnBoot: settingAutoStart.checked,
      showHeaderInFullscreen: settingShowHeaderInFullscreen.checked,
      defaultFps: parseInt(settingFps.value, 10) || 60,
      stunServers: stunLines
    };

    currentSettings = await window.electronAPI.saveSettings(updated);
    if (currentSettings.signalingServerUrl) {
      cloudBaseUrl = currentSettings.signalingServerUrl;
      refreshActiveAddressUI();
    }
    if (socket) {
      socket.emit('update-settings', currentSettings);
    }
    updateHeaderVisibility();
    applyBranding();
    closeSettings();
  }

  // --- UI Events & Mode Switcher ---
  function setupUIEvents() {
    // CSP forbids inline handlers: block native form submission here instead.
    if (desktopCastForm) desktopCastForm.addEventListener('submit', (e) => e.preventDefault());

    // Mode toggle between Cloud and LAN
    if (btnModeCloud) {
      btnModeCloud.addEventListener('click', () => switchAddressMode('cloud'));
    }

    if (btnModeLan) {
      btnModeLan.addEventListener('click', () => switchAddressMode('lan'));
    }
    // Mode tabs
    tabReceiverMode.addEventListener('click', () => {
      appMode = 'receiver';
      tabReceiverMode.classList.add('active');
      tabSenderMode.classList.remove('active');
      desktopSenderView.style.display = 'none';
      if (activePeers.size === 0) {
        standbyView.style.display = 'flex';
      } else {
        streamingView.style.display = 'flex';
      }
    });

    tabSenderMode.addEventListener('click', () => {
      appMode = 'sender';
      tabSenderMode.classList.add('active');
      tabReceiverMode.classList.remove('active');
      standbyView.style.display = 'none';
      streamingView.style.display = 'none';
      desktopSenderView.style.display = 'flex';
      setupDesktopSenderSources();
    });

    // Manual PIN Refresh
    refreshPinBtn.addEventListener('click', () => {
      if (socket) socket.emit('refresh-pin');
    });

    // Window controls
    toggleFullscreenBtn.addEventListener('click', () => {
      window.electronAPI.toggleFullscreen();
    });

    floatingFullscreenBtn.addEventListener('click', () => {
      window.electronAPI.toggleFullscreen();
    });

    minimizeBtn.addEventListener('click', () => {
      window.electronAPI.minimize();
    });

    closeToTrayBtn.addEventListener('click', () => {
      window.electronAPI.hideToTray();
    });

    // Disconnect cast
    disconnectCastBtn.addEventListener('click', () => {
      if (socket) socket.emit('stop-stream');
      returnToStandbyView();
    });

    // Floating audio mute
    floatingMuteBtn.addEventListener('click', () => {
      let anyMuted = false;
      for (const peer of activePeers.values()) {
        if (peer.videoEl) {
          peer.videoEl.muted = !peer.videoEl.muted;
          anyMuted = peer.videoEl.muted;
        }
      }
      floatingMuteBtn.textContent = anyMuted ? '🔇' : '🔊';
    });

    // One-Click Session Recording
    if (floatingRecordBtn) {
      floatingRecordBtn.addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          stopRecording();
        } else {
          startRecording();
        }
      });
    }

    // Clear Annotations
    if (floatingClearDrawBtn) {
      floatingClearDrawBtn.addEventListener('click', () => {
        clearCanvas();
      });
    }

    // Open recordings folder button in settings
    if (openRecordingsBtn) {
      openRecordingsBtn.addEventListener('click', async () => {
        await window.electronAPI.openRecordingsFolder();
      });
    }

    // Approval buttons
    acceptPairingBtn.addEventListener('click', () => handleApprovalDecision(true));
    rejectPairingBtn.addEventListener('click', () => handleApprovalDecision(false));

    // Settings modal events
    openSettingsBtn.addEventListener('click', openSettings);
    closeSettingsModalBtn.addEventListener('click', closeSettings);
    if (openAdminBtn) openAdminBtn.addEventListener('click', openAdmin);
    if (closeAdminModalBtn) closeAdminModalBtn.addEventListener('click', closeAdmin);
    if (adminAuthBtn) adminAuthBtn.addEventListener('click', submitAdminAuth);
    if (adminSaveBtn) adminSaveBtn.addEventListener('click', saveAdminLicense);
    if (adminLogoutBtn) adminLogoutBtn.addEventListener('click', adminLogout);
    [adminPasswordInput, adminPasswordRepeat].forEach((input) => {
      if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAdminAuth(); });
    });
    saveSettingsBtn.addEventListener('click', saveSettings);
    if (pickLogoBtn) pickLogoBtn.addEventListener('click', pickLogo);
    if (clearLogoBtn) clearLogoBtn.addEventListener('click', clearLogo);

    // Listeners from Electron Main Process / System Tray
    window.electronAPI.onOpenSettingsModal(() => openSettings());
    window.electronAPI.onTriggerStopStream(() => {
      if (socket) socket.emit('stop-stream');
      returnToStandbyView();
    });

    if (window.electronAPI.onFullscreenChanged) {
      window.electronAPI.onFullscreenChanged((isFull) => {
        isFullscreenState = isFull;
        updateHeaderVisibility();
      });
    }

    window.addEventListener('keydown', async (e) => {
      if (e.key === 'F11') {
        window.electronAPI.toggleFullscreen();
      } else if (e.key === 'Escape') {
        if (settingsModal.style.display !== 'none') {
          closeSettings();
        } else if (approvalModal.style.display !== 'none') {
          handleApprovalDecision(false);
        } else {
          // ESC exits fullscreen
          const isFull = await window.electronAPI.isFullscreen();
          if (isFull) {
            await window.electronAPI.toggleFullscreen();
            isFullscreenState = false;
            updateHeaderVisibility();
          }
        }
      }
    });
  }

  window.addEventListener('DOMContentLoaded', init);
})();
