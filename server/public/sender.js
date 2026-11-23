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

  const streamSourceSelect = document.getElementById('streamSourceSelect');
  const mobileScreenNotice = document.getElementById('mobileScreenNotice');
  const mobileGuideModal = document.getElementById('mobileGuideModal');
  const closeGuideModalBtn = document.getElementById('closeGuideModalBtn');
  const dismissGuideModalBtn = document.getElementById('dismissGuideModalBtn');
  const startWithCameraBtn = document.getElementById('startWithCameraBtn');

  // Switch Source Elements
  const switchSourceBtn = document.getElementById('switchSourceBtn');
  const flipCameraBtn = document.getElementById('flipCameraBtn');
  const documentFileInput = document.getElementById('documentFileInput');
  const switchSourceModal = document.getElementById('switchSourceModal');
  const closeSwitchSourceModalBtn = document.getElementById('closeSwitchSourceModalBtn');
  const dismissSwitchSourceModalBtn = document.getElementById('dismissSwitchSourceModalBtn');
  const optCameraBack = document.getElementById('optCameraBack');
  const optCameraFront = document.getElementById('optCameraFront');
  const optScreen = document.getElementById('optScreen');
  const optDocument = document.getElementById('optDocument');
  const badgeCameraBack = document.getElementById('badgeCameraBack');
  const badgeCameraFront = document.getElementById('badgeCameraFront');
  const badgeScreen = document.getElementById('badgeScreen');
  const badgeDocument = document.getElementById('badgeDocument');

  // State
  let peerConnection = null;
  let localStream = null;
  let audioTrack = null;
  let videoTrack = null;
  let isAudioMuted = false;
  let iceServersConfig = [{ urls: 'stun:stun.l.google.com:19302' }];
  let deferredPwaPrompt = null;
  let currentSourceMode = 'screen';
  let documentCanvasInterval = null;

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

  // Collapsible Downloads Toggle
  const toggleDownloadsBtn = document.getElementById('toggleDownloadsBtn');
  const collapsibleDownloads = document.getElementById('collapsibleDownloads');
  if (toggleDownloadsBtn && collapsibleDownloads) {
    toggleDownloadsBtn.addEventListener('click', () => {
      const isHidden = collapsibleDownloads.style.display === 'none';
      collapsibleDownloads.style.display = isHidden ? 'block' : 'none';
      toggleDownloadsBtn.innerHTML = isHidden 
        ? `<span>💾</span> İndirme Seçeneklerini Gizle ▴` 
        : `<span>💾</span> Windows Alıcıyı İndir veya Diğer Cihazlar ▾`;
    });
  }

  // Dynamic host display in guide
  const guideHostSpan = document.getElementById('guideHostSpan');
  if (guideHostSpan) {
    guideHostSpan.textContent = window.location.host;
  }

  // Automatic input formatting & Ready status on 6 digits (No auto-trigger, user clicks button explicitly)
  if (pinInput) {
    pinInput.addEventListener('input', () => {
      let raw = pinInput.value.replace(/\D/g, '').slice(0, 6);
      if (raw.length > 3) {
        pinInput.value = raw.slice(0, 3) + ' ' + raw.slice(3);
      } else {
        pinInput.value = raw;
      }

      if (raw.length === 6) {
        connectBtn.classList.add('btn-ready');
      } else {
        connectBtn.classList.remove('btn-ready');
      }
    });
  }

  // Read URL query param for prefilled PIN (from QR scan)
  const urlParams = new URLSearchParams(window.location.search);
  const codeFromUrl = urlParams.get('code');
  if (codeFromUrl && pinInput) {
    const raw = codeFromUrl.replace(/\D/g, '').slice(0, 6);
    if (raw.length === 6) {
      pinInput.value = raw.slice(0, 3) + ' ' + raw.slice(3);
      connectBtn.classList.add('btn-ready');
    } else {
      pinInput.value = codeFromUrl.trim();
    }
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
    detectedDeviceBadge.textContent = `${clientInfo.icon} ${clientInfo.displayName}`;
  }

  const downloadPortableBtn = document.getElementById('downloadPortableBtn');

  if (downloadCardTitle && downloadCardDesc && downloadCardLink) {
    downloadCardIcon.textContent = clientInfo.icon;
    downloadCardTitle.textContent = `${clientInfo.model} Algılandı`;
    downloadCardDesc.textContent = clientInfo.downloadDesc;

    if (clientInfo.downloadType === 'apk') {
      downloadCardLink.href = '/download/android';
      downloadCardLink.innerHTML = `<span>📱</span> Android (.apk)`;
      downloadCardLink.setAttribute('download', 'Cast.apk');
      if (downloadPortableBtn) downloadPortableBtn.style.display = 'none';
    } else if (clientInfo.downloadType === 'exe') {
      downloadCardLink.href = '/download/setup';
      downloadCardLink.innerHTML = `<span>💾</span> Alıcı Kurulum (.exe)`;
      downloadCardLink.setAttribute('download', 'Cast-Setup.exe');
      if (downloadPortableBtn) {
        downloadPortableBtn.style.display = 'inline-flex';
        downloadPortableBtn.href = '/download';
        downloadPortableBtn.innerHTML = `<span>⚡</span> Portable (.exe)`;
      }
    } else {
      downloadCardLink.href = clientInfo.downloadUrl;
      downloadCardLink.innerHTML = `<span>⬇️</span> ${clientInfo.downloadLabel}`;
      if (downloadPortableBtn) downloadPortableBtn.style.display = 'none';
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

  // Helper: Capability Detection
  function hasDisplayMediaSupport() {
    return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') ||
           (typeof navigator.getDisplayMedia === 'function');
  }

  function isMobileClient() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  function openGuideModal() {
    if (mobileGuideModal) {
      mobileGuideModal.style.display = 'flex';
    }
  }

  function closeGuideModal() {
    if (mobileGuideModal) {
      mobileGuideModal.style.display = 'none';
    }
  }

  if (closeGuideModalBtn) closeGuideModalBtn.addEventListener('click', closeGuideModal);
  if (dismissGuideModalBtn) dismissGuideModalBtn.addEventListener('click', closeGuideModal);

  if (startWithCameraBtn) {
    startWithCameraBtn.addEventListener('click', () => {
      closeGuideModal();
      if (streamSourceSelect) streamSourceSelect.value = 'camera-back';
      connectBtn.click();
    });
  }

  // Pre-check capability on page load: show notice if mobile
  if (isMobileClient()) {
    if (mobileScreenNotice) mobileScreenNotice.style.display = 'block';
  }

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

  let pendingSenderCandidates = [];
  let disconnectTimer = null;

  // WebRTC Answer from Receiver
  socket.on('webrtc-answer', async ({ sdp }) => {
    if (peerConnection) {
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
        console.log('[WebRTC] Remote description (answer) set successfully.');

        // Drain buffered candidates
        if (pendingSenderCandidates.length > 0) {
          for (const cand of pendingSenderCandidates) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
          pendingSenderCandidates = [];
        }

        // Apply encoding bitrate/fps safely after answer
        const senders = peerConnection.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender && videoSender.getParameters) {
          try {
            const params = videoSender.getParameters();
            if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
            params.encodings[0].maxBitrate = 8000 * 1000;
            params.encodings[0].maxFramerate = 60;
            await videoSender.setParameters(params);
          } catch (e) {
            console.warn('[WebRTC] setParameters warning:', e);
          }
        }
      } catch (err) {
        console.error('Failed to set remote answer:', err);
      }
    }
  });

  // ICE Candidate from Receiver
  socket.on('webrtc-candidate', async (candidate) => {
    if (candidate) {
      const candObj = candidate.candidate || candidate;
      if (peerConnection && peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candObj));
        } catch (err) {
          console.error('Error adding ICE candidate:', err);
        }
      } else {
        pendingSenderCandidates.push(candObj);
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

  // Source Mode Toggle (Ekran vs Kamera)
  const btnSourceScreen = document.getElementById('btnSourceScreen');
  const btnSourceCamera = document.getElementById('btnSourceCamera');

  if (btnSourceScreen && btnSourceCamera) {
    btnSourceScreen.addEventListener('click', () => {
      btnSourceScreen.classList.add('active');
      btnSourceCamera.classList.remove('active');
      if (streamSourceSelect) streamSourceSelect.value = 'screen';
      currentSourceMode = 'screen';
    });

    btnSourceCamera.addEventListener('click', () => {
      btnSourceCamera.classList.add('active');
      btnSourceScreen.classList.remove('active');
      if (streamSourceSelect) streamSourceSelect.value = 'camera-back';
      currentSourceMode = 'camera-back';
    });
  }

  // Form submit (Enter key) must never reload the page; route to connect.
  const pinFormEl = document.getElementById('pinForm');
  if (pinFormEl) {
    pinFormEl.addEventListener('submit', (e) => {
      e.preventDefault();
      connectBtn.click();
    });
  }

  // Connect Button Click
  connectBtn.addEventListener('click', () => {
    const pin = pinInput.value.trim().replace(/\s+/g, '');
    if (!pin || pin.length !== 6) {
      showError('Lütfen 6 haneli geçerli eşleştirme kodunu girin.');
      return;
    }

    let selectedSource = streamSourceSelect ? streamSourceSelect.value : 'screen';
    // Fall back to camera only if browser strictly lacks screen sharing API
    if (!hasDisplayMediaSupport() && selectedSource === 'screen') {
      selectedSource = 'camera-back';
      if (streamSourceSelect) streamSourceSelect.value = 'camera-back';
      if (btnSourceCamera && btnSourceScreen) {
        btnSourceCamera.classList.add('active');
        btnSourceScreen.classList.remove('active');
      }
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
      browser: clientInfo.browser,
      sourceType: selectedSource
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

  // Start Screen or Camera Sharing
  async function startScreenShare(serverConfig = {}) {
    const targetFps = parseInt(fpsSelect.value, 10) || 60;
    const includeAudio = audioToggle.checked;
    let selectedSource = streamSourceSelect ? streamSourceSelect.value : 'screen';
    if (!hasDisplayMediaSupport() && selectedSource === 'screen') {
      selectedSource = 'camera-back';
      if (streamSourceSelect) streamSourceSelect.value = 'camera-back';
    }

    try {
      if (selectedSource === 'camera-back' || selectedSource === 'camera-front') {
        // Camera / Document Presenter Mode (fully supported on all mobile & desktop browsers)
        const facing = selectedSource === 'camera-back' ? { ideal: 'environment' } : 'user';
        localStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing,
            width: { ideal: 1920, max: 3840 },
            height: { ideal: 1080, max: 2160 },
            frameRate: { ideal: targetFps }
          },
          audio: includeAudio
        });
      } else {
        // Desktop Screen Sharing Mode
        if (!hasDisplayMediaSupport()) {
          if (isMobileClient()) {
            openGuideModal();
            handleStreamEnd();
            return;
          } else {
            throw new Error('Tarayıcınız ekran yakalama API\'sini (getDisplayMedia) desteklemiyor. Lütfen güncel Chrome veya Edge kullanın.');
          }
        }

        const displayMediaOptions = {
          video: {
            frameRate: { ideal: targetFps, max: 60 }
          },
          audio: includeAudio ? true : false
        };

        if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') {
          localStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
        } else if (typeof navigator.getDisplayMedia === 'function') {
          localStream = await navigator.getDisplayMedia(displayMediaOptions);
        }
      }

      videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack && 'contentHint' in videoTrack) {
        videoTrack.contentHint = 'motion';
      }
      audioTrack = localStream.getAudioTracks()[0] || null;

      localPreviewVideo.srcObject = localStream;
      localPreviewVideo.play().catch(e => {});
      localPreviewVideo.muted = true;
      localPreviewVideo.play().catch(e => console.warn('Preview play warning:', e));

      // When user clicks the native "Stop Sharing" button
      videoTrack.onended = () => {
        handleStreamEnd('Yayın durduruldu.');
        socket.emit('stop-stream');
      };

      // Create WebRTC PeerConnection
      peerConnection = new RTCPeerConnection({
        iceServers: iceServersConfig
      });

      // Add tracks to PeerConnection
      localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc-candidate', { candidate: event.candidate });
        }
      };

      peerConnection.onconnectionstatechange = () => {
        console.log('[WebRTC] Connection state:', peerConnection.connectionState);
        const state = peerConnection.connectionState;
        clearTimeout(disconnectTimer);
        if (state === 'failed') {
          handleStreamEnd('WebRTC bağlantısı kurulamadı (ağ/firewall engeli olabilir).');
        } else if (state === 'disconnected') {
          // 'disconnected' is often transient; give ICE a few seconds to recover.
          disconnectTimer = setTimeout(() => {
            if (peerConnection && peerConnection.connectionState === 'disconnected') {
              handleStreamEnd('WebRTC bağlantısı kesildi.');
            }
          }, 8000);
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

  // Switch Source Logic (Seamless replaceTrack without disconnection)
  function openSwitchSourceModal() {
    if (!switchSourceModal) return;
    updateActiveSourceBadges(currentSourceMode);
    switchSourceModal.style.display = 'flex';
  }

  function closeSwitchSourceModal() {
    if (switchSourceModal) {
      switchSourceModal.style.display = 'none';
    }
  }

  if (switchSourceBtn) switchSourceBtn.addEventListener('click', openSwitchSourceModal);
  if (closeSwitchSourceModalBtn) closeSwitchSourceModalBtn.addEventListener('click', closeSwitchSourceModal);
  if (dismissSwitchSourceModalBtn) dismissSwitchSourceModalBtn.addEventListener('click', closeSwitchSourceModal);

  function updateActiveSourceBadges(mode) {
    const list = [
      { btn: optCameraBack, badge: badgeCameraBack, key: 'camera-back' },
      { btn: optCameraFront, badge: badgeCameraFront, key: 'camera-front' },
      { btn: optScreen, badge: badgeScreen, key: 'screen' },
      { btn: optDocument, badge: badgeDocument, key: 'document' }
    ];
    list.forEach(item => {
      if (!item.btn) return;
      if (item.key === mode) {
        item.btn.classList.add('active-source');
      } else {
        item.btn.classList.remove('active-source');
      }
    });
  }

  async function replaceLiveVideoTrack(newVideoTrack, newMode) {
    if (!peerConnection) return;

    if (documentCanvasInterval) {
      clearInterval(documentCanvasInterval);
      documentCanvasInterval = null;
    }

    try {
      const senders = peerConnection.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video') ||
                          senders.find(s => s.track === null);

      if (videoSender) {
        await videoSender.replaceTrack(newVideoTrack);
        console.log(`[WebRTC] Video track replaced with ${newMode} seamlessly without disconnect!`);
      }

      // Stop old video track if distinct
      if (videoTrack && videoTrack !== newVideoTrack) {
        videoTrack.stop();
      }

      videoTrack = newVideoTrack;
      currentSourceMode = newMode;

      // Update local preview
      if (localStream) {
        const oldTracks = localStream.getVideoTracks();
        oldTracks.forEach(t => localStream.removeTrack(t));
        localStream.addTrack(newVideoTrack);
      } else {
        localStream = new MediaStream([newVideoTrack]);
      }
      localPreviewVideo.srcObject = localStream;
      localPreviewVideo.play().catch(e => {});

      videoTrack.onended = () => {
        console.log(`[Source] Track ${newMode} ended`);
      };

      const settings = videoTrack.getSettings();
      statRes.textContent = `${settings.width || 1920}x${settings.height || 1080}`;
      updateActiveSourceBadges(newMode);
      closeSwitchSourceModal();
    } catch (err) {
      console.error('Failed to replace video track:', err);
      notify('Kaynak değiştirilemedi: ' + err.message);
    }
  }

  async function switchLiveSource(targetMode) {
    if (targetMode === 'document') {
      if (documentFileInput) documentFileInput.click();
      return;
    }

    try {
      const targetFps = parseInt(fpsSelect.value, 10) || 60;

      if (targetMode === 'camera-back' || targetMode === 'camera-front') {
        const facing = targetMode === 'camera-back' ? { ideal: 'environment' } : 'user';
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing,
            width: { ideal: 1920, max: 3840 },
            height: { ideal: 1080, max: 2160 },
            frameRate: { ideal: targetFps }
          },
          audio: false
        });
        const track = stream.getVideoTracks()[0];
        await replaceLiveVideoTrack(track, targetMode);
      } else if (targetMode === 'screen') {
        if (!hasDisplayMediaSupport()) {
          notify('Mobil tarayıcınız web üzerinden tüm telefon ekranını yakalamayı güvenlik nedeniyle desteklemiyor. Kamera veya Belge modunu kullanabilirsiniz.');
          return;
        }
        let stream = null;
        if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: 'always', frameRate: { ideal: targetFps, max: 60 } },
            audio: false
          });
        } else if (typeof navigator.getDisplayMedia === 'function') {
          stream = await navigator.getDisplayMedia({
            video: { cursor: 'always', frameRate: { ideal: targetFps, max: 60 } },
            audio: false
          });
        }
        if (stream) {
          const track = stream.getVideoTracks()[0];
          await replaceLiveVideoTrack(track, 'screen');
        }
      }
    } catch (err) {
      console.error('Source switch error:', err);
      notify('Kaynak değiştirilemedi: ' + err.message);
    }
  }

  if (optCameraBack) optCameraBack.addEventListener('click', () => switchLiveSource('camera-back'));
  if (optCameraFront) optCameraFront.addEventListener('click', () => switchLiveSource('camera-front'));
  if (optScreen) optScreen.addEventListener('click', () => switchLiveSource('screen'));
  if (optDocument) optDocument.addEventListener('click', () => switchLiveSource('document'));

  if (flipCameraBtn) {
    flipCameraBtn.addEventListener('click', async () => {
      if (currentSourceMode === 'camera-back') {
        await switchLiveSource('camera-front');
      } else {
        await switchLiveSource('camera-back');
      }
    });
  }

  // Document / Image live casting handler
  if (documentFileInput) {
    documentFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();
        img.src = objectUrl;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });

        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext('2d');

        const drawFrame = () => {
          ctx.fillStyle = '#0a0e17';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          const x = (canvas.width - w) / 2;
          const y = (canvas.height - h) / 2;
          ctx.drawImage(img, x, y, w, h);

          // Subtitle banner at bottom
          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.fillRect(0, canvas.height - 44, canvas.width, 44);
          ctx.fillStyle = '#00f0ff';
          ctx.font = 'bold 20px sans-serif';
          ctx.fillText(`📄 Belge / Görsel: ${file.name}`, 30, canvas.height - 15);
        };

        drawFrame();
        const canvasStream = canvas.captureStream(25);
        documentCanvasInterval = setInterval(drawFrame, 200);

        const canvasTrack = canvasStream.getVideoTracks()[0];
        canvasTrack.onended = () => {
          if (documentCanvasInterval) clearInterval(documentCanvasInterval);
        };

        await replaceLiveVideoTrack(canvasTrack, 'document');
        closeSwitchSourceModal();
      } catch (err) {
        console.error('Document file load error:', err);
        notify('Dosya gösterilemedi: ' + err.message);
      } finally {
        documentFileInput.value = '';
      }
    });
  }

  // Audio Toggle
  toggleAudioBtn.addEventListener('click', () => {
    if (!audioTrack) {
      notify('Bu yayında ses akışı bulunmuyor.');
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

  // Annotation & Laser Pointer Controls
  const toggleLaserBtn = document.getElementById('toggleLaserBtn');
  const toggleDrawBtn = document.getElementById('toggleDrawBtn');
  const clearAnnotationBtn = document.getElementById('clearAnnotationBtn');
  const pointerTouchLayer = document.getElementById('pointerTouchLayer');

  let activeTool = null; // 'laser' or 'draw' or null
  let isDrawing = false;
  let lastDrawCoord = null;

  if (toggleLaserBtn && pointerTouchLayer) {
    toggleLaserBtn.addEventListener('click', () => {
      if (activeTool === 'laser') {
        activeTool = null;
        toggleLaserBtn.classList.remove('btn-tool-active');
        pointerTouchLayer.style.display = 'none';
      } else {
        activeTool = 'laser';
        toggleLaserBtn.classList.add('btn-tool-active');
        if (toggleDrawBtn) toggleDrawBtn.classList.remove('btn-tool-active');
        pointerTouchLayer.style.display = 'block';
      }
    });
  }

  if (toggleDrawBtn && pointerTouchLayer) {
    toggleDrawBtn.addEventListener('click', () => {
      if (activeTool === 'draw') {
        activeTool = null;
        toggleDrawBtn.classList.remove('btn-tool-active');
        pointerTouchLayer.style.display = 'none';
      } else {
        activeTool = 'draw';
        toggleDrawBtn.classList.add('btn-tool-active');
        if (toggleLaserBtn) toggleLaserBtn.classList.remove('btn-tool-active');
        pointerTouchLayer.style.display = 'block';
      }
    });
  }

  if (clearAnnotationBtn) {
    clearAnnotationBtn.addEventListener('click', () => {
      socket.emit('stream-annotation', { type: 'clear' });
    });
  }

  function getNormCoords(e, rect) {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return { x, y };
  }

  if (pointerTouchLayer) {
    const onPointerMove = (e) => {
      if (!activeTool) return;
      const rect = pointerTouchLayer.getBoundingClientRect();
      const coords = getNormCoords(e, rect);

      if (activeTool === 'laser') {
        socket.emit('stream-annotation', { type: 'laser', x: coords.x, y: coords.y });
      } else if (activeTool === 'draw' && isDrawing && lastDrawCoord) {
        socket.emit('stream-annotation', {
          type: 'draw',
          x0: lastDrawCoord.x,
          y0: lastDrawCoord.y,
          x1: coords.x,
          y1: coords.y,
          color: '#ff1744',
          size: 4
        });
        lastDrawCoord = coords;
      }
    };

    const onPointerStart = (e) => {
      if (!activeTool) return;
      isDrawing = true;
      const rect = pointerTouchLayer.getBoundingClientRect();
      const coords = getNormCoords(e, rect);
      lastDrawCoord = coords;
      if (activeTool === 'laser') {
        socket.emit('stream-annotation', { type: 'laser', x: coords.x, y: coords.y });
      }
    };

    const onPointerEnd = () => {
      isDrawing = false;
      lastDrawCoord = null;
    };

    pointerTouchLayer.addEventListener('mousedown', onPointerStart);
    pointerTouchLayer.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerEnd);

    pointerTouchLayer.addEventListener('touchstart', onPointerStart, { passive: true });
    pointerTouchLayer.addEventListener('touchmove', onPointerMove, { passive: true });
    window.addEventListener('touchend', onPointerEnd);
  }

  function hideError() {
    pinError.style.display = 'none';
  }
})();
