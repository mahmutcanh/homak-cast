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
  const detectedDeviceBadge = document.getElementById('detectedDeviceBadge');
  const downloadCardLink = document.getElementById('downloadCardLink');
  const downloadCardTitle = document.getElementById('downloadCardTitle');
  const downloadCardDesc = document.getElementById('downloadCardDesc');
  const downloadCardIcon = document.getElementById('downloadCardIcon');
  const topDownloadBtn = document.getElementById('topDownloadBtn');

  // State
  let peerConnection = null;
  let localStream = null;
  let audioTrack = null;
  let videoTrack = null;
  let isAudioMuted = false;
  let iceServersConfig = [{ urls: 'stun:stun.l.google.com:19302' }];
  let deferredPwaPrompt = null;

  // Register PWA Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  // Capture PWA install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPwaPrompt = e;
    console.log('[PWA] Install prompt captured');
  });

  // Read URL query param for prefilled PIN
  const urlParams = new URLSearchParams(window.location.search);
  const codeFromUrl = urlParams.get('code');
  if (codeFromUrl) {
    pinInput.value = codeFromUrl.trim();
  }

  // --- Comprehensive Device & Model Detection ---
  function detectClientDevice() {
    const ua = navigator.userAgent;
    let os = 'Bilinmeyen OS';
    let model = 'Cihaz';
    let icon = '📱';
    let downloadType = 'exe';
    let downloadUrl = '/download';
    let downloadLabel = 'Windows için Alıcı İndir (.exe)';
    let downloadDesc = 'Projeksiyona veya TV\'ye bağlı Windows bilgisayarda çalıştırmak için alıcıyı indirin.';

    // 1. Android Detection
    if (/android/i.test(ua)) {
      os = 'Android';
      icon = '📱';
      downloadType = 'apk';
      downloadUrl = '/download/android';
      downloadLabel = 'Android için İndir (.apk)';
      downloadDesc = 'Telefonunuza doğrudan APK yükleyin veya ana ekrana ekleyerek uygulama gibi kullanın.';

      // Extract Android Phone Model
      const match = ua.match(/;\s*([^;]+)\s+Build\//i) || ua.match(/\(([^;]+);\s*Android[^;]*;\s*([^)]+)\)/i);
      if (match) {
        let rawModel = (match[1] || match[2] || '').trim();
        if (rawModel.includes(';')) rawModel = rawModel.split(';').pop().trim();

        if (/SM-|Galaxy/i.test(rawModel)) model = 'Samsung Galaxy ' + rawModel.replace(/SM-/i, '');
        else if (/Redmi|POCO|Xiaomi|220|210/i.test(rawModel)) model = 'Xiaomi ' + rawModel;
        else if (/Pixel/i.test(rawModel)) model = 'Google ' + rawModel;
        else if (/CPH|OPPO/i.test(rawModel)) model = 'Oppo ' + rawModel;
        else if (/RMX|Realme/i.test(rawModel)) model = 'Realme ' + rawModel;
        else if (/V2|vivo/i.test(rawModel)) model = 'Vivo ' + rawModel;
        else if (/Huawei|HONOR/i.test(rawModel)) model = 'Huawei ' + rawModel;
        else model = rawModel;
      } else {
        model = 'Android Telefon';
      }
    }
    // 2. iOS (iPhone / iPad)
    else if (/iPhone/i.test(ua)) {
      os = 'iOS';
      icon = '🍎';
      model = 'Apple iPhone';
      downloadType = 'ios';
      downloadUrl = '#';
      downloadLabel = 'iPhone: Ana Ekrana Ekle';
      downloadDesc = 'Safari\'de Paylaş butonuna tıklayıp "Ana Ekrana Ekle" diyerek uygulama gibi kullanabilirsiniz.';
    } else if (/iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
      os = 'iPadOS';
      icon = '🍎';
      model = 'Apple iPad';
      downloadType = 'ios';
      downloadUrl = '#';
      downloadLabel = 'iPad: Ana Ekrana Ekle';
      downloadDesc = 'Safari\'de Paylaş butonuna tıklayıp "Ana Ekrana Ekle" diyerek uygulama gibi kullanabilirsiniz.';
    }
    // 3. Windows
    else if (/Windows/i.test(ua)) {
      os = 'Windows';
      icon = '💻';
      model = /Windows NT 10.0/i.test(ua) ? 'Windows 10/11 Bilgisayar' : 'Windows Bilgisayar';
      downloadType = 'exe';
      downloadUrl = '/download';
      downloadLabel = 'Windows için Alıcıyı İndir (.exe)';
      downloadDesc = 'Projeksiyona veya TV\'ye bağlı Windows bilgisayarda çalıştırmak için taşınabilir alıcıyı indirin.';
    }
    // 4. Mac
    else if (/Macintosh|Mac OS X/i.test(ua)) {
      os = 'macOS';
      icon = '💻';
      model = 'Apple Mac / MacBook';
      downloadType = 'mac';
      downloadUrl = '/';
      downloadLabel = 'Mac Tarayıcıdan Yansıtıcı';
      downloadDesc = 'Mac cihazınızdan doğrudan Safari veya Chrome üzerinden ekranınızı yansıtabilirsiniz.';
    }
    // 5. Linux
    else if (/Linux/i.test(ua)) {
      os = 'Linux';
      icon = '🐧';
      model = 'Linux Bilgisayar';
      downloadType = 'linux';
      downloadUrl = '/';
      downloadLabel = 'Linux Web Yansıtıcı';
      downloadDesc = 'Linux üzerinden Chrome veya Firefox ile ekranınızı doğrudan yansıtabilirsiniz.';
    }

    let browser = 'Tarayıcı';
    if (ua.includes('Edg/')) browser = 'Edge';
    else if (ua.includes('Chrome/')) browser = 'Chrome';
    else if (ua.includes('Safari/')) browser = 'Safari';
    else if (ua.includes('Firefox/')) browser = 'Firefox';

    return {
      os,
      model,
      browser,
      displayName: `${model} (${browser})`,
      icon,
      downloadType,
      downloadUrl,
      downloadLabel,
      downloadDesc
    };
  }

  const clientInfo = detectClientDevice();

  // Apply detected device to UI
  if (detectedDeviceBadge) {
    detectedDeviceBadge.innerHTML = `<span class="device-icon">${clientInfo.icon}</span> ${clientInfo.displayName}`;
  }

  if (downloadCardTitle && downloadCardDesc && downloadCardLink) {
    downloadCardIcon.textContent = clientInfo.icon;
    downloadCardTitle.textContent = `${clientInfo.model} Algılandı`;
    downloadCardDesc.textContent = clientInfo.downloadDesc;
    downloadCardLink.href = clientInfo.downloadUrl;
    downloadCardLink.innerHTML = `<span>⬇️</span> ${clientInfo.downloadLabel}`;

    if (clientInfo.downloadType === 'apk') {
      downloadCardLink.setAttribute('download', 'Homak-Cast.apk');
    } else if (clientInfo.downloadType === 'exe') {
      downloadCardLink.setAttribute('download', 'Homak-Cast-Receiver.exe');
    }
  }

  if (topDownloadBtn) {
    topDownloadBtn.href = clientInfo.downloadUrl;
    topDownloadBtn.innerHTML = `<span>⬇️</span> ${clientInfo.downloadType === 'apk' ? 'APK İndir' : 'Alıcı İndir (.exe)'}`;
  }

  // Handle PWA / App install click on mobile
  if (downloadCardLink && clientInfo.downloadType === 'apk') {
    downloadCardLink.addEventListener('click', (e) => {
      if (deferredPwaPrompt) {
        deferredPwaPrompt.prompt();
        deferredPwaPrompt.userChoice.then((choiceResult) => {
          if (choiceResult.outcome === 'accepted') {
            console.log('[PWA] User accepted install');
          }
          deferredPwaPrompt = null;
        });
      }
    });
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

  // Pairing approved (Direct or after prompt)
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
    pinInfo.textContent = 'Bağlanıyor...';

    // Transmit detected device model and OS to server & receiver
    socket.emit('request-pairing', {
      pin,
      deviceName: clientInfo.displayName,
      model: clientInfo.model,
      os: clientInfo.os,
      browser: clientInfo.browser
    }, (res) => {
      if (!res.ok) {
        showError(res.error);
        pinInfo.style.display = 'none';
        return;
      }

      // If approval is requested (e.g. if enabled in settings)
      if (res.status === 'WAITING_APPROVAL') {
        pairingSection.style.display = 'none';
        approvalSection.style.display = 'block';
      }
      // If direct connect (default), 'pairing-approved' event fires automatically!
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

      // When user clicks the native "Stop Sharing" button
      videoTrack.onended = () => {
        handleStreamEnd('Ekran paylaşımı durduruldu.');
        socket.emit('stop-stream');
      };

      // Create WebRTC PeerConnection
      peerConnection = new RTCPeerConnection({
        iceServers: iceServersConfig
      });

      // Add tracks to PeerConnection
      localStream.getTracks().forEach((track) => {
        const sender = peerConnection.addTrack(track, localStream);

        if (track.kind === 'video' && sender && sender.getParameters) {
          const params = sender.getParameters();
          if (!params.encodings) params.encodings = [{}];
          params.encodings[0].maxBitrate = (serverConfig.maxBitrateKbps || 8000) * 1000;
          params.encodings[0].maxFramerate = targetFps;
          sender.setParameters(params).catch(() => {});
        }
      });

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

      let sdp = offer.sdp;
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
