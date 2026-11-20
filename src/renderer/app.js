(() => {
  // Elements
  const standbyView = document.getElementById('standbyView');
  const streamingView = document.getElementById('streamingView');
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
  const settingDeviceName = document.getElementById('settingDeviceName');
  const settingPort = document.getElementById('settingPort');
  const settingRequireApproval = document.getElementById('settingRequireApproval');
  const settingAutoStart = document.getElementById('settingAutoStart');
  const settingFps = document.getElementById('settingFps');
  const settingStunServers = document.getElementById('settingStunServers');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');

  // State
  let socket = null;
  let peerConnection = null;
  let remoteStream = null;
  let currentSettings = {};
  let currentPin = '';
  let activeSenderId = null;
  let approvalTimer = null;
  let selectedAudioDeviceId = 'default';

  // Initialize
  async function init() {
    currentSettings = await window.electronAPI.getSettings();
    const serverPort = currentSettings.port || 5240;

    // Connect to embedded signaling server
    socket = io(`http://localhost:${serverPort}`);

    setupSocketEvents();
    setupDisplays();
    setupAudioDevices();
    setupUIEvents();
  }

  // Socket.IO Events
  function setupSocketEvents() {
    socket.on('connect', () => {
      console.log('[Receiver] Connected to signaling server.');
      socket.emit('register-receiver', {}, (res) => {
        if (res && res.ok) {
          updatePinDisplay(res.pin, res.qrUrl);
        }
      });
    });

    socket.on('pin-update', ({ pin, qrUrl }) => {
      updatePinDisplay(pin, qrUrl);
    });

    // Approval Request
    socket.on('approval-request', ({ senderId, senderInfo }) => {
      activeSenderId = senderId;
      showApprovalModal(senderInfo);
    });

    // Sender Connected & WebRTC setup
    socket.on('sender-connected', ({ senderInfo, iceServers }) => {
      activeSenderName.textContent = senderInfo.deviceName || 'Bilinmeyen Cihaz';
      setupPeerConnection(iceServers);
    });

    // WebRTC Offer from Sender
    socket.on('webrtc-offer', async ({ sdp, senderId }) => {
      if (!peerConnection) return;
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.emit('webrtc-answer', { sdp: answer.sdp });
        console.log('[WebRTC] Answer sent to sender.');
      } catch (err) {
        console.error('Error handling WebRTC offer:', err);
      }
    });

    // ICE Candidate from Sender
    socket.on('webrtc-candidate', async (candidate) => {
      if (peerConnection && candidate) {
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error('Error adding ICE candidate:', err);
        }
      }
    });

    // Stream Termination (Requirements 6 & 7: switch to standby & generate new PIN)
    socket.on('stream-terminated', ({ reason }) => {
      console.log('[Receiver] Stream terminated:', reason);
      returnToStandbyView();
    });
  }

  function updatePinDisplay(pin, qrUrl) {
    if (!pin) return;
    currentPin = pin;
    // Format pin as 3 digits space 3 digits (e.g. "834 912")
    const formattedPin = pin.slice(0, 3) + ' ' + pin.slice(3);
    pinCode.textContent = formattedPin;

    if (qrUrl) {
      connectUrlText.textContent = qrUrl;
      // Fetch high-res QR image data
      fetch(`/api/qr?code=${pin}`)
        .then(r => r.json())
        .then(data => {
          if (data.ok && data.qr) {
            qrImage.src = data.qr;
          }
        })
        .catch(err => {
          console.error('Failed to load QR code image:', err);
        });
    }
  }

  // WebRTC PeerConnection Setup
  function setupPeerConnection(iceServers) {
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }

    remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;

    peerConnection = new RTCPeerConnection({
      iceServers: iceServers || [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    peerConnection.ontrack = (event) => {
      console.log('[WebRTC] Remote track received:', event.track.kind);
      remoteStream.addTrack(event.track);

      // Transition to streaming view as soon as tracks arrive
      switchToStreamingView();

      // Apply selected audio output device (HDMI / Projector)
      applyAudioOutput(selectedAudioDeviceId);

      // Update resolution/fps statistics
      if (event.track.kind === 'video') {
        event.track.onloadedmetadata = () => {
          const settings = event.track.getSettings();
          liveResolution.textContent = `${settings.width || 1920}x${settings.height || 1080}`;
          liveFps.textContent = `${settings.frameRate || 60} FPS`;
        };
      }
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-candidate', { candidate: event.candidate });
      }
    };

    peerConnection.onconnectionstatechange = () => {
      console.log('[WebRTC] Receiver connection state:', peerConnection.connectionState);
      if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
        returnToStandbyView();
      }
    };
  }

  function switchToStreamingView() {
    standbyView.style.display = 'none';
    streamingView.style.display = 'flex';
  }

  function returnToStandbyView() {
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    remoteStream = null;
    remoteVideo.srcObject = null;

    streamingView.style.display = 'none';
    standbyView.style.display = 'flex';
  }

  // Display / Projector Management
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

  // Audio Output Management (HDMI / Projector Audio)
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
      console.warn('Audio device enumeration not fully supported or restricted:', err);
    }
  }

  function applyAudioOutput(deviceId) {
    if (typeof remoteVideo.setSinkId === 'function') {
      remoteVideo.setSinkId(deviceId)
        .then(() => console.log(`[Audio] Audio output routed to device: ${deviceId}`))
        .catch(err => console.error('Failed to setSinkId:', err));
    }
  }

  // Approval Modal Logic
  function showApprovalModal(senderInfo) {
    approvalDeviceName.textContent = senderInfo.deviceName || 'Bilinmeyen Cihaz';
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

  // Settings Modal Logic
  function openSettings() {
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

  // UI Events & Tray Listeners
  function setupUIEvents() {
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

    // Keyboard shortcuts: F11 fullscreen, Esc close settings/exit fullscreen
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
