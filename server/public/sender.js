(() => {
  const socket = io();

  // Elements
  const statusBadge = document.getElementById('connectionStatusBadge');
  const pairingSection = document.getElementById('pairingSection');
  const approvalSection = document.getElementById('approvalSection');
  const streamingSection = document.getElementById('streamingSection');
  const pinInput = document.getElementById('pinInput');
  const fpsSelect = document.getElementById('fpsSelect');
  const audioToggle = document.getElementById('audioToggle');
  const pinError = document.getElementById('pinError');
  const pinInfo = document.getElementById('pinInfo');
  const connectBtn = document.getElementById('connectBtn');
  const cancelApprovalBtn = document.getElementById('cancelApprovalBtn');
  const localPreviewVideo = document.getElementById('localPreviewVideo');
  const toggleAudioBtn = document.getElementById('toggleAudioBtn');
  const audioBtnIcon = document.getElementById('audioBtnIcon');
  const stopCastBtn = document.getElementById('stopCastBtn');
  const statFps = document.getElementById('statFps');
  const statRes = document.getElementById('statRes');
  const statAudio = document.getElementById('statAudio');

  // State
  let peerConnection = null;
  let localStream = null;
  let audioTrack = null;
  let videoTrack = null;
  let isAudioMuted = false;
  let iceServersConfig = [{ urls: 'stun:stun.l.google.com:19302' }];

  // Read URL query param for prefilled PIN
  const urlParams = new URLSearchParams(window.location.search);
  const codeFromUrl = urlParams.get('code');
  if (codeFromUrl) {
    pinInput.value = codeFromUrl.trim();
  }

  // Device Info Helper
  function getDeviceName() {
    const ua = navigator.userAgent;
    let platform = 'PC';
    if (/android/i.test(ua)) platform = 'Android Cihaz';
    else if (/iPad|iPhone|iPod/.test(ua)) platform = 'Apple Cihaz';
    else if (/Macintosh/.test(ua)) platform = 'Mac';
    else if (/Windows/.test(ua)) platform = 'Windows';
    else if (/Linux/.test(ua)) platform = 'Linux';

    let browser = 'Tarayıcı';
    if (ua.includes('Edg/')) browser = 'Edge';
    else if (ua.includes('Chrome/')) browser = 'Chrome';
    else if (ua.includes('Safari/')) browser = 'Safari';
    else if (ua.includes('Firefox/')) browser = 'Firefox';

    return `${platform} (${browser})`;
  }

  // Socket Connection Status
  socket.on('connect', () => {
    statusBadge.textContent = 'Sunucuya Bağlandı';
    statusBadge.className = 'badge badge-connected';
  });

  socket.on('disconnect', () => {
    statusBadge.textContent = 'Bağlantı Kesildi';
    statusBadge.className = 'badge badge-disconnected';
    handleStreamEnd('Sunucu bağlantısı koptu.');
  });

  socket.on('receiver-status-changed', ({ online }) => {
    if (!online && !localStream) {
      showError('Homak Cast Receiver şu anda çevrimdışı.');
    }
  });

  // Pairing approved by Receiver
  socket.on('pairing-approved', async (config) => {
    if (config.iceServers && config.iceServers.length > 0) {
      iceServersConfig = config.iceServers;
    }
    approvalSection.style.display = 'none';
    pinInfo.style.display = 'none';
    await startScreenShare(config);
  });

  // Pairing rejected
  socket.on('pairing-rejected', ({ reason }) => {
    approvalSection.style.display = 'none';
    pairingSection.style.display = 'block';
    showError(reason || 'Yayın isteği reddedildi.');
    stopMediaTracks();
  });

  // WebRTC Answer from Receiver
  socket.on('webrtc-answer', async ({ sdp }) => {
    if (peerConnection) {
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
        console.log('[WebRTC] Remote description (answer) set successfully.');
      } catch (err) {
        console.error('Failed to set remote answer:', err);
      }
    }
  });

  // ICE Candidate from Receiver
  socket.on('webrtc-candidate', async (candidate) => {
    if (peerConnection && candidate) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    }
  });

  // Stream terminated by server/receiver
  socket.on('stream-terminated', ({ reason }) => {
    handleStreamEnd(reason || 'Yayın alıcı tarafından sonlandırıldı.');
  });

  socket.on('receiver-disconnected', () => {
    handleStreamEnd('Alıcı cihazın bağlantısı koptu.');
  });

  // Connect Button Click
  connectBtn.addEventListener('click', () => {
    const pin = pinInput.value.trim().replace(/\s+/g, '');
    if (!pin || pin.length !== 6) {
      showError('Lütfen 6 haneli geçerli eşleştirme kodunu girin.');
      return;
    }

    hideError();
    pinInfo.style.display = 'block';
    pinInfo.textContent = 'Doğrulanıyor...';

    socket.emit('request-pairing', {
      pin,
      deviceName: getDeviceName(),
      browser: navigator.userAgent
    }, (res) => {
      if (!res.ok) {
        showError(res.error);
        pinInfo.style.display = 'none';
        return;
      }

      if (res.status === 'WAITING_APPROVAL') {
        pairingSection.style.display = 'none';
        approvalSection.style.display = 'block';
      }
    });
  });

  cancelApprovalBtn.addEventListener('click', () => {
    approvalSection.style.display = 'none';
    pairingSection.style.display = 'block';
    socket.emit('stop-stream');
  });

  // Start Screen Sharing
  async function startScreenShare(serverConfig = {}) {
    const targetFps = parseInt(fpsSelect.value, 10) || 60;
    const includeAudio = audioToggle.checked;

    try {
      const displayMediaOptions = {
        video: {
          cursor: 'always',
          frameRate: { ideal: targetFps, max: 60 },
          width: { ideal: 1920, max: 3840 },
          height: { ideal: 1080, max: 2160 }
        },
        audio: includeAudio ? {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        } : false
      };

      localStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
      localPreviewVideo.srcObject = localStream;

      videoTrack = localStream.getVideoTracks()[0];
      audioTrack = localStream.getAudioTracks()[0] || null;

      // When user clicks the browser's native "Stop Sharing" button
      videoTrack.onended = () => {
        handleStreamEnd('Ekran paylaşımı tarayıcıdan durduruldu.');
        socket.emit('stop-stream');
      };

      // Create WebRTC PeerConnection
      peerConnection = new RTCPeerConnection({
        iceServers: iceServersConfig
      });

      // Add tracks to PeerConnection
      localStream.getTracks().forEach((track) => {
        const sender = peerConnection.addTrack(track, localStream);
        
        // If adaptive bitrate or 60fps tuning is enabled
        if (track.kind === 'video' && sender && sender.getParameters) {
          const params = sender.getParameters();
          if (!params.encodings) params.encodings = [{}];
          params.encodings[0].maxBitrate = (serverConfig.maxBitrateKbps || 8000) * 1000;
          params.encodings[0].maxFramerate = targetFps;
          sender.setParameters(params).catch(() => {});
        }
      });

      // Send ICE candidates to receiver
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc-candidate', { candidate: event.candidate });
        }
      };

      peerConnection.onconnectionstatechange = () => {
        console.log('[WebRTC] Connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
          handleStreamEnd('WebRTC bağlantısı kesildi.');
        }
      };

      // Create Offer
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false
      });

      // Tune SDP for high-quality 60fps & opus stereo
      let sdp = offer.sdp;
      // Prefer H264 or VP9 if available
      sdp = sdp.replace(/a=fmtp:111 minptime=10;useinbandfec=1/g, 'a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1');
      await peerConnection.setLocalDescription(new RTCSessionDescription({ type: 'offer', sdp }));

      // Send offer to receiver via signaling
      socket.emit('webrtc-offer', { sdp });

      // Update UI to streaming mode
      pairingSection.style.display = 'none';
      approvalSection.style.display = 'none';
      streamingSection.style.display = 'block';

      // Update stats badge
      const settings = videoTrack.getSettings();
      statFps.textContent = `${settings.frameRate || targetFps} FPS`;
      statRes.textContent = `${settings.width || 1920}x${settings.height || 1080}`;
      statAudio.textContent = audioTrack ? '🔊 Ses Aktif' : '🔇 Ses Kapalı';

    } catch (err) {
      console.error('Screen share error:', err);
      showError('Ekran paylaşımı başlatılamadı: ' + err.message);
      handleStreamEnd();
    }
  }

  // Audio Toggle
  toggleAudioBtn.addEventListener('click', () => {
    if (!audioTrack) {
      alert('Bu yayında ses akışı bulunmuyor.');
      return;
    }
    isAudioMuted = !isAudioMuted;
    audioTrack.enabled = !isAudioMuted;
    audioBtnIcon.textContent = isAudioMuted ? '🔇' : '🔊';
    toggleAudioBtn.innerHTML = `<span class="btn-icon">${isAudioMuted ? '🔇' : '🔊'}</span> ${isAudioMuted ? 'Sesi Aç' : 'Sesi Sustur'}`;
    statAudio.textContent = isAudioMuted ? '🔇 Sessiz' : '🔊 Ses Aktif';
  });

  // Stop Stream Button
  stopCastBtn.addEventListener('click', () => {
    socket.emit('stop-stream');
    handleStreamEnd('Yayın durduruldu.');
  });

  function stopMediaTracks() {
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    if (localPreviewVideo) {
      localPreviewVideo.srcObject = null;
    }
  }

  function handleStreamEnd(msg) {
    stopMediaTracks();

    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }

    streamingSection.style.display = 'none';
    approvalSection.style.display = 'none';
    pairingSection.style.display = 'block';

    if (msg) {
      showError(msg);
    }
  }

  function showError(msg) {
    pinError.textContent = msg;
    pinError.style.display = 'block';
  }

  function hideError() {
    pinError.style.display = 'none';
  }
})();
