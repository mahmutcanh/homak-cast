(() => {
  // Navigation & Mode Tabs
  const tabReceiverMode = document.getElementById('tabReceiverMode');
  const tabSenderMode = document.getElementById('tabSenderMode');
  const standbyView = document.getElementById('standbyView');
  const streamingView = document.getElementById('streamingView');
  const desktopSenderView = document.getElementById('desktopSenderView');

  // Receiver Elements
  const remoteVideo = document.getElementById('remoteVideo');
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
  const settingPort = document.getElementById('settingPort');
  const settingRequireApproval = document.getElementById('settingRequireApproval');
  const settingAutoStart = document.getElementById('settingAutoStart');
  const settingFps = document.getElementById('settingFps');
  const settingStunServers = document.getElementById('settingStunServers');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');

  // State
  let socket = null;
  let receiverPeerConnection = null;
  let senderPeerConnection = null;
  let outgoingStream = null;
  let remoteStream = null;
  let currentSettings = {};
  let currentPin = '';
  let activeSenderId = null;
  let approvalTimer = null;
  let selectedAudioDeviceId = 'default';
  let appMode = 'receiver'; // 'receiver' or 'sender'

  // Initialize
  async function init() {
    currentSettings = await window.electronAPI.getSettings();
    const serverUrl = currentSettings.signalingServerUrl || 'https://cast.homaklab.com';
    const localFallbackUrl = `http://localhost:${currentSettings.port || 5240}`;

    console.log(`[Receiver] Connecting to signaling server: ${serverUrl}`);
    socket = io(serverUrl, { timeout: 5000, reconnectionAttempts: 3 });

    let connected = false;
    socket.on('connect', () => {
      connected = true;
      console.log(`[Receiver] Connected to signaling server: ${serverUrl}`);
      registerWithServer();
    });

    socket.on('connect_error', (err) => {
      console.warn(`[Receiver] Failed to connect to ${serverUrl}:`, err.message);
      if (!connected && serverUrl !== localFallbackUrl) {
        console.log(`[Receiver] Falling back to local embedded server: ${localFallbackUrl}`);
        socket.disconnect();
        socket = io(localFallbackUrl);
        setupSocketEvents();
      }
    });

    setupSocketEvents();
    setupDisplays();
    setupAudioDevices();
    setupDesktopSenderSources();
    setupUIEvents();
  }

  function registerWithServer() {
    if (!socket) return;
    socket.emit('register-receiver', {
      deviceName: currentSettings.deviceName || 'Homak Cast Receiver'
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
      activeSenderId = senderId;
      showApprovalModal(senderInfo);
    });

    // Sender Connected (Receiver role)
    socket.on('sender-connected', ({ senderInfo, iceServers }) => {
      let label = senderInfo.model || senderInfo.deviceName || 'Bilinmeyen Cihaz';
      if (senderInfo.os && !label.includes(senderInfo.os)) {
        label += ` (${senderInfo.os})`;
      }
      activeSenderName.textContent = label;
      console.log(`[Receiver] Connected sender: ${label} [${senderInfo.ip || ''}]`);
      setupReceiverPeerConnection(iceServers);
    });

    // WebRTC Offer from Sender
    socket.on('webrtc-offer', async ({ sdp, senderId }) => {
      if (!receiverPeerConnection) return;
      try {
        await receiverPeerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
        const answer = await receiverPeerConnection.createAnswer();
        await receiverPeerConnection.setLocalDescription(answer);

        socket.emit('webrtc-answer', { sdp: answer.sdp });
        console.log('[WebRTC] Answer sent to sender.');
      } catch (err) {
        console.error('Error handling WebRTC offer:', err);
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

    // WebRTC Candidate
    socket.on('webrtc-candidate', async (candidate) => {
      const pc = appMode === 'sender' ? senderPeerConnection : receiverPeerConnection;
      if (pc && candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error('Error adding ICE candidate:', err);
        }
      }
    });

    // Stream Termination
    socket.on('stream-terminated', ({ reason }) => {
      console.log('[HomakCast] Stream terminated:', reason);
      if (appMode === 'sender') {
        stopDesktopOutgoingCast('Yayın alıcı tarafından sonlandırıldı.');
      } else {
        returnToStandbyView();
      }
    });
  }

  function updatePinDisplay(pin, qrUrl) {
    if (!pin) return;
    currentPin = pin;
    const formattedPin = pin.slice(0, 3) + ' ' + pin.slice(3);
    pinCode.textContent = formattedPin;

    if (qrUrl) {
      connectUrlText.textContent = qrUrl;
      const baseUrl = currentSettings.signalingServerUrl || 'https://cast.homaklab.com';
      fetch(`${baseUrl}/api/qr?code=${pin}`)
        .then(r => r.json())
        .then(data => {
          if (data.ok && data.qr) {
            qrImage.src = data.qr;
          }
        })
        .catch(err => {
          console.error('Failed to load QR code image from server:', err);
        });
    }
  }

  // --- RECEIVER WebRTC ---
  function setupReceiverPeerConnection(iceServers) {
    if (receiverPeerConnection) {
      receiverPeerConnection.close();
      receiverPeerConnection = null;
    }

    remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;

    receiverPeerConnection = new RTCPeerConnection({
      iceServers: iceServers || [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    receiverPeerConnection.ontrack = (event) => {
      console.log('[Receiver WebRTC] Remote track received:', event.track.kind);
      remoteStream.addTrack(event.track);

      switchToStreamingView();
      applyAudioOutput(selectedAudioDeviceId);

      if (event.track.kind === 'video') {
        event.track.onloadedmetadata = () => {
          const s = event.track.getSettings();
          liveResolution.textContent = `${s.width || 1920}x${s.height || 1080}`;
          liveFps.textContent = `${s.frameRate || 60} FPS`;
        };
      }
    };

    receiverPeerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-candidate', { candidate: event.candidate });
      }
    };

    receiverPeerConnection.onconnectionstatechange = () => {
      if (receiverPeerConnection.connectionState === 'disconnected' || receiverPeerConnection.connectionState === 'failed') {
        returnToStandbyView();
      }
    };
  }

  function switchToStreamingView() {
    standbyView.style.display = 'none';
    desktopSenderView.style.display = 'none';
    streamingView.style.display = 'flex';
  }

  function returnToStandbyView() {
    if (receiverPeerConnection) {
      receiverPeerConnection.close();
      receiverPeerConnection = null;
    }
    remoteStream = null;
    remoteVideo.srcObject = null;

    streamingView.style.display = 'none';
    if (appMode === 'receiver') {
      standbyView.style.display = 'flex';
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
    const pin = desktopPinInput.value.trim().replace(/\s+/g, '');
    if (!pin || pin.length !== 6) {
      showDesktopError('Lütfen yansıtılacak ekrandaki 6 haneli kodu girin.');
      return;
    }

    hideDesktopError();
    desktopCastInfo.textContent = 'Hedef ekrana bağlanılıyor...';
    desktopCastInfo.style.display = 'block';

    const sourceId = desktopSourceSelect.value;
    const targetFps = parseInt(desktopFpsSelect.value, 10) || 60;
    const includeAudio = desktopAudioToggle.checked;

    socket.emit('request-pairing', {
      pin,
      deviceName: 'Windows Masaüstü Uygulaması',
      model: 'Windows 10/11 PC',
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

  async function startOutgoingStream(config = {}) {
    try {
      const sourceId = desktopSourceSelect.value;
      const targetFps = parseInt(desktopFpsSelect.value, 10) || 60;
      const includeAudio = desktopAudioToggle.checked;

      // Capture desktop screen via Electron mediaConstraints
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
        applyAudioOutput(selectedAudioDeviceId);
        window.electronAPI.saveSettings({ audioOutputId: selectedAudioDeviceId });
      });
    } catch (err) {
      console.warn('Audio device enumeration not fully supported:', err);
    }
  }

  function applyAudioOutput(deviceId) {
    if (typeof remoteVideo.setSinkId === 'function') {
      remoteVideo.setSinkId(deviceId)
        .then(() => console.log(`[Audio] Audio output routed to device: ${deviceId}`))
        .catch(err => console.error('Failed to setSinkId:', err));
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
    if (activeSenderId && socket) {
      socket.emit('approval-decision', { senderId: activeSenderId, approved });
    }
    activeSenderId = null;
  }

  // --- Settings Modal Logic ---
  function openSettings() {
    settingSignalingUrl.value = currentSettings.signalingServerUrl || 'https://cast.homaklab.com';
    settingDeviceName.value = currentSettings.deviceName || 'Homak Cast Receiver';
    settingPort.value = currentSettings.port || 5240;
    settingRequireApproval.checked = !!currentSettings.requireApproval;
    settingAutoStart.checked = !!currentSettings.autoStartOnBoot;
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

    const updated = {
      signalingServerUrl: settingSignalingUrl.value.trim() || 'https://cast.homaklab.com',
      deviceName: settingDeviceName.value.trim() || 'Homak Cast Receiver',
      port: parseInt(settingPort.value, 10) || 5240,
      requireApproval: settingRequireApproval.checked,
      autoStartOnBoot: settingAutoStart.checked,
      defaultFps: parseInt(settingFps.value, 10) || 60,
      stunServers: stunLines
    };

    currentSettings = await window.electronAPI.saveSettings(updated);
    if (socket) {
      socket.emit('update-settings', currentSettings);
    }
    closeSettings();
  }

  // --- UI Events & Mode Switcher ---
  function setupUIEvents() {
    // Mode tabs
    tabReceiverMode.addEventListener('click', () => {
      appMode = 'receiver';
      tabReceiverMode.classList.add('active');
      tabSenderMode.classList.remove('active');
      desktopSenderView.style.display = 'none';
      if (!remoteStream) {
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
      remoteVideo.muted = !remoteVideo.muted;
      floatingMuteBtn.textContent = remoteVideo.muted ? '🔇' : '🔊';
    });

    // Approval buttons
    acceptPairingBtn.addEventListener('click', () => handleApprovalDecision(true));
    rejectPairingBtn.addEventListener('click', () => handleApprovalDecision(false));

    // Settings modal events
    openSettingsBtn.addEventListener('click', openSettings);
    closeSettingsModalBtn.addEventListener('click', closeSettings);
    saveSettingsBtn.addEventListener('click', saveSettings);

    // Listeners from Electron Main Process / System Tray
    window.electronAPI.onOpenSettingsModal(() => openSettings());
    window.electronAPI.onTriggerStopStream(() => {
      if (socket) socket.emit('stop-stream');
      returnToStandbyView();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'F11') {
        window.electronAPI.toggleFullscreen();
      } else if (e.key === 'Escape') {
        if (settingsModal.style.display !== 'none') {
          closeSettings();
        } else if (approvalModal.style.display !== 'none') {
          handleApprovalDecision(false);
        }
      }
    });
  }

  window.addEventListener('DOMContentLoaded', init);
})();
