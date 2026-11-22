package com.homaklab.cast.cast

import android.content.Context
import android.hardware.display.DisplayManager
import android.media.projection.MediaProjection
import android.media.MediaRecorder
import android.util.Log
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.view.WindowManager
import com.homaklab.cast.DebugLog
import com.homaklab.cast.audio.SystemAudioCapture
import com.homaklab.cast.signaling.CandidateInit
import com.homaklab.cast.signaling.PairingConfig
import com.homaklab.cast.signaling.SignalingClient
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.RtpParameters
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import org.webrtc.audio.JavaAudioDeviceModule
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * One screen-cast session: signaling (pairing) -> MediaProjection capture -> WebRTC offer/answer -> stream.
 * All session logic runs on a single worker thread; [Events] callbacks are invoked from that thread.
 */
class CastSession(
    context: Context,
    private val projection: MediaProjection,
    private val captureAudio: Boolean,
    private val serverUrl: String,
    private val pin: String,
    private val requestedFps: Int,
    private val deviceName: String,
    private val model: String,
    private val events: Events
) : SignalingClient.Listener {

    interface Events {
        fun onStatus(status: CastStatus)
        fun onFinished(reason: String?)
    }

    private val appContext = context.applicationContext
    private val worker = Executors.newSingleThreadScheduledExecutor()

    /** Runs on the session thread; late callbacks arriving after teardown are dropped instead of crashing. */
    private fun post(task: () -> Unit) {
        try {
            worker.execute {
                try {
                    task()
                } catch (t: Throwable) {
                    // Native/library failures (UnsatisfiedLinkError, NoClassDefFoundError, ...) must not kill the app silently.
                    DebugLog.add("İstisna: ${t.javaClass.simpleName}: ${t.message}\n${Log.getStackTraceString(t)}")
                    finish("Beklenmeyen hata: ${t.javaClass.simpleName}: ${t.message}", notifyServer = true, failed = true)
                }
            }
        } catch (_: RejectedExecutionException) {
            // session already finished
        }
    }
    private val signaling = SignalingClient(serverUrl, this)

    private var eglBase: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var peer: PeerConnection? = null
    private var capturer: ProjectionVideoCapturer? = null
    private var audioModule: JavaAudioDeviceModule? = null
    private var systemAudio: SystemAudioCapture? = null
    private var audioSource: AudioSource? = null
    private var audioTrack: AudioTrack? = null
    private var audioActive = false
    private var textureHelper: SurfaceTextureHelper? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null

    private var pairingConfig: PairingConfig? = null
    private var captureSize: CaptureSize? = null
    private var captureFps = DEFAULT_FPS
    private var remoteDescriptionSet = false
    private val pendingCandidates = mutableListOf<CandidateInit>()
    private var disconnectTimer: ScheduledFuture<*>? = null
    private var displayListener: DisplayManager.DisplayListener? = null
    private var finished = false

    fun start() = post {
        DebugLog.add("Oturum başlıyor: sunucu=$serverUrl, ses=$captureAudio, fps=$requestedFps")
        events.onStatus(CastStatus.Connecting)
        try {
            signaling.connect()
        } catch (e: Exception) {
            finish("Sunucu adresi geçersiz: ${e.message}", notifyServer = false, failed = true)
        }
    }

    fun stop() = post { finish("Yayın durduruldu.", notifyServer = true) }

    // ---- SignalingClient.Listener (Socket.IO thread -> worker) ----

    override fun onConnected() {
        DebugLog.add("Sunucuya bağlanıldı, eşleşme isteniyor")
        post { signaling.requestPairing(pin, deviceName, model, "Android ${Build.VERSION.RELEASE}") }
    }

    override fun onConnectError(message: String) {
        DebugLog.add("Bağlantı hatası: $message")
        post { finish("Sunucuya bağlanılamadı ($serverUrl): $message", notifyServer = false, failed = true) }
    }

    override fun onWaitingApproval() {
        DebugLog.add("Alıcı onayı bekleniyor")
        post { events.onStatus(CastStatus.WaitingApproval) }
    }

    override fun onPairingApproved(config: PairingConfig) {
        DebugLog.add("Eşleşme onaylandı")
        post {
            if (finished) return@post
            pairingConfig = config
            try {
                beginStreaming(config)
            } catch (t: Throwable) {
                DebugLog.add("Yayın başlatma istisnası: ${Log.getStackTraceString(t)}")
                finish("Yayın başlatılamadı: ${t.javaClass.simpleName}: ${t.message}", notifyServer = true, failed = true)
            }
        }
    }

    override fun onPairingRejected(reason: String) {
        DebugLog.add("Eşleşme reddedildi: $reason")
        post { finish(reason, notifyServer = false, failed = true) }
    }

    override fun onAnswer(sdp: String) {
        post {
            val pc = peer ?: return@post
            pc.setRemoteDescription(object : SdpAdapter("setRemote") {
                override fun onSetSuccess() {
                    post {
                        remoteDescriptionSet = true
                        pendingCandidates.forEach(::addRemoteCandidate)
                        pendingCandidates.clear()
                        applyEncodingLimits()
                    }
                }

                override fun onSetFailure(error: String?) {
                    post { finish("Alıcı yanıtı uygulanamadı: $error", notifyServer = true, failed = true) }
                }
            }, SessionDescription(SessionDescription.Type.ANSWER, sdp))
        }
    }

    override fun onRemoteCandidate(candidate: CandidateInit) {
        post {
            if (remoteDescriptionSet) addRemoteCandidate(candidate) else pendingCandidates += candidate
        }
    }

    override fun onStreamTerminated(reason: String) {
        post { finish(reason, notifyServer = false) }
    }

    override fun onDisconnected(reason: String) {
        DebugLog.add("Sunucu bağlantısı koptu: $reason")
        post { finish("Sunucu bağlantısı koptu ($reason).", notifyServer = false, failed = true) }
    }

    // ---- WebRTC ----

    private fun beginStreaming(config: PairingConfig) {
        ensureWebRtcInitialized(appContext)
        val egl = EglBase.create().also { eglBase = it }
        val factoryBuilder = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext))
        audioActive = setupSystemAudio(factoryBuilder)
        val f = factoryBuilder.createPeerConnectionFactory()
        factory = f

        captureFps = (config.defaultFps ?: requestedFps).coerceAtMost(requestedFps).coerceIn(MIN_FPS, MAX_FPS)
        val size = currentCaptureSize().also { captureSize = it }

        val source = f.createVideoSource(true).also { videoSource = it }
        val helper = SurfaceTextureHelper.create("ScreenCaptureThread", egl.eglBaseContext).also { textureHelper = it }
        val cap = ProjectionVideoCapturer(projection) {
            post { finish("Ekran yakalama durduruldu.", notifyServer = true) }
        }
        cap.initialize(helper, appContext, source.capturerObserver)
        cap.startCapture(size.width, size.height, captureFps)
        capturer = cap
        watchRotation()

        val track = f.createVideoTrack("homak-screen", source).also { videoTrack = it }
        val iceServers = config.iceServers.map { s ->
            PeerConnection.IceServer.builder(s.urls)
                .apply {
                    s.username?.let { setUsername(it) }
                    s.credential?.let { setPassword(it) }
                }
                .createIceServer()
        }
        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        val pc = f.createPeerConnection(rtcConfig, PeerObserver())
            ?: throw IllegalStateException("PeerConnection oluşturulamadı")
        peer = pc
        pc.addTrack(track, listOf("homak-cast"))
        if (audioActive) {
            val source = f.createAudioSource(rawAudioConstraints()).also { audioSource = it }
            val aTrack = f.createAudioTrack("homak-audio", source).also { audioTrack = it }
            pc.addTrack(aTrack, listOf("homak-cast"))
        }
        createAndSendOffer(pc)
    }

    private fun createAndSendOffer(pc: PeerConnection) {
        pc.createOffer(object : SdpAdapter("createOffer") {
            override fun onCreateSuccess(created: SessionDescription) {
                val desc = SessionDescription(created.type, stereoOpus(created.description))
                pc.setLocalDescription(object : SdpAdapter("setLocal") {
                    override fun onSetSuccess() {
                        post { if (!finished) signaling.sendOffer(desc.description) }
                    }

                    override fun onSetFailure(error: String?) {
                        post { finish("Teklif ayarlanamadı: $error", notifyServer = true, failed = true) }
                    }
                }, desc)
            }

            override fun onCreateFailure(error: String?) {
                post { finish("Teklif oluşturulamadı: $error", notifyServer = true, failed = true) }
            }
        }, MediaConstraints())
    }

    private fun addRemoteCandidate(c: CandidateInit) {
        peer?.addIceCandidate(IceCandidate(c.sdpMid, c.sdpMLineIndex, c.candidate))
    }

    /** Quality settings equivalent to the web sender: high bitrate cap, keep resolution (text stays sharp). */
    private fun applyEncodingLimits() {
        val sender = peer?.senders?.firstOrNull { it.track()?.kind() == "video" } ?: return
        val params = sender.parameters
        val maxBps = (pairingConfig?.maxBitrateKbps ?: DEFAULT_MAX_KBPS) * 1000
        params.encodings.forEach { enc ->
            enc.maxBitrateBps = maxBps
            enc.maxFramerate = captureFps
        }
        params.degradationPreference = RtpParameters.DegradationPreference.MAINTAIN_RESOLUTION
        sender.parameters = params
    }

    private fun onPeerState(state: PeerConnection.PeerConnectionState) {
        post {
            if (finished) return@post
            disconnectTimer?.cancel(false)
            when (state) {
                PeerConnection.PeerConnectionState.CONNECTED -> {
                    val size = captureSize
                    events.onStatus(CastStatus.Streaming("${size?.width}x${size?.height}", captureFps, audioActive))
                }
                PeerConnection.PeerConnectionState.FAILED ->
                    finish("WebRTC bağlantısı kurulamadı (ağ/güvenlik duvarı engeli olabilir).", notifyServer = true, failed = true)
                PeerConnection.PeerConnectionState.DISCONNECTED ->
                    // Often transient: give ICE a few seconds to recover before ending.
                    disconnectTimer = worker.schedule({
                        if (peer?.connectionState() == PeerConnection.PeerConnectionState.DISCONNECTED) {
                            finish("WebRTC bağlantısı kesildi.", notifyServer = true, failed = true)
                        }
                    }, DISCONNECT_GRACE_SECONDS, TimeUnit.SECONDS)
                else -> Unit
            }
        }
    }

    // ---- system audio ----

    /**
     * Starts AudioPlaybackCapture and routes it through a custom audio device module. Returns false (video-only
     * session) when audio is off, unsupported (< Android 10), the permission is missing or capture cannot start.
     */
    private fun setupSystemAudio(builder: PeerConnectionFactory.Builder): Boolean {
        if (!captureAudio || !SystemAudioCapture.isSupported) return false
        val capture = SystemAudioCapture(projection)
        if (!capture.start(appContext)) return false
        systemAudio = capture
        audioModule = JavaAudioDeviceModule.builder(appContext)
            .setUseHardwareAcousticEchoCanceler(false)
            .setUseHardwareNoiseSuppressor(false)
            .setAudioSource(MediaRecorder.AudioSource.MIC)
            .setInputSampleRate(SystemAudioCapture.SAMPLE_RATE)
            .setUseStereoInput(true)
            .setAudioBufferCallback(capture)
            .createAudioDeviceModule()
        builder.setAudioDeviceModule(audioModule)
        return true
    }

    /** System audio is music/video, not speech: disable voice processing that would mangle it. */
    private fun rawAudioConstraints() = MediaConstraints().apply {
        listOf("googEchoCancellation", "googAutoGainControl", "googNoiseSuppression", "googHighpassFilter")
            .forEach { mandatory.add(MediaConstraints.KeyValuePair(it, "false")) }
    }

    /** Same Opus tweak as the web sender: stereo, plus a music-grade bitrate. */
    private fun stereoOpus(sdp: String): String =
        OPUS_FMTP.replace(sdp) { "${it.value};stereo=1;sprop-stereo=1;maxaveragebitrate=128000" }

    // ---- rotation ----

    private fun currentCaptureSize(): CaptureSize {
        val wm = appContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val b = wm.currentWindowMetrics.bounds
            CaptureSize.fit(b.width(), b.height())
        } else {
            val m = DisplayMetrics()
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getRealMetrics(m)
            CaptureSize.fit(m.widthPixels, m.heightPixels)
        }
    }

    private fun watchRotation() {
        val dm = appContext.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
        val listener = object : DisplayManager.DisplayListener {
            override fun onDisplayAdded(displayId: Int) = Unit
            override fun onDisplayRemoved(displayId: Int) = Unit
            override fun onDisplayChanged(displayId: Int) {
                post {
                    if (finished) return@post
                    val size = currentCaptureSize()
                    if (size != captureSize) {
                        captureSize = size
                        capturer?.changeCaptureFormat(size.width, size.height, captureFps)
                        events.onStatus(CastStatus.Streaming("${size.width}x${size.height}", captureFps, audioActive))
                    }
                }
            }
        }
        displayListener = listener
        dm.registerDisplayListener(listener, Handler(Looper.getMainLooper()))
    }

    // ---- teardown ----

    private fun finish(reason: String?, notifyServer: Boolean, failed: Boolean = false) {
        if (finished) return
        DebugLog.add("Oturum bitiyor (hata=$failed): $reason")
        finished = true
        disconnectTimer?.cancel(false)
        if (notifyServer) runCatching { signaling.stopStream() }
        displayListener?.let {
            (appContext.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager).unregisterDisplayListener(it)
        }
        runCatching { capturer?.stopCapture() }
        runCatching { capturer?.dispose() }
        runCatching { peer?.close() }
        runCatching { peer?.dispose() }
        runCatching { audioTrack?.dispose() }
        runCatching { audioSource?.dispose() }
        runCatching { systemAudio?.stop() }
        runCatching { videoTrack?.dispose() }
        runCatching { videoSource?.dispose() }
        runCatching { textureHelper?.dispose() }
        runCatching { factory?.dispose() }
        runCatching { audioModule?.release() }
        runCatching { projection.stop() }
        runCatching { eglBase?.release() }
        signaling.close()
        events.onStatus(
            if (failed) CastStatus.Failed(reason ?: "Bilinmeyen hata") else CastStatus.Ended(reason ?: "Yayın sona erdi.")
        )
        events.onFinished(reason)
        worker.shutdown()
    }

    private inner class PeerObserver : PeerConnection.Observer {
        override fun onIceCandidate(candidate: IceCandidate) {
            post {
                if (!finished) {
                    signaling.sendCandidate(CandidateInit(candidate.sdp, candidate.sdpMid, candidate.sdpMLineIndex))
                }
            }
        }

        override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) = onPeerState(newState)
        override fun onSignalingChange(state: PeerConnection.SignalingState) = Unit
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) = Unit
        override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) = Unit
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
        override fun onAddStream(stream: org.webrtc.MediaStream) = Unit
        override fun onRemoveStream(stream: org.webrtc.MediaStream) = Unit
        override fun onDataChannel(channel: org.webrtc.DataChannel) = Unit
        override fun onRenegotiationNeeded() = Unit
        override fun onAddTrack(receiver: org.webrtc.RtpReceiver, streams: Array<out org.webrtc.MediaStream>) = Unit
    }

    companion object {
        private const val MIN_FPS = 15
        private const val MAX_FPS = 60
        private const val DEFAULT_FPS = 30
        private const val DEFAULT_MAX_KBPS = 8000
        private const val DISCONNECT_GRACE_SECONDS = 8L
        private val OPUS_FMTP = Regex("a=fmtp:[0-9]+ minptime=10;useinbandfec=1")

        @Volatile
        private var webRtcInitialized = false

        private fun ensureWebRtcInitialized(context: Context) {
            if (webRtcInitialized) return
            synchronized(this) {
                if (webRtcInitialized) return
                PeerConnectionFactory.initialize(
                    PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions()
                )
                webRtcInitialized = true
            }
        }
    }
}

/** SdpObserver with no-op defaults so call sites only override what they need. */
internal open class SdpAdapter(private val tag: String) : org.webrtc.SdpObserver {
    override fun onCreateSuccess(desc: SessionDescription) = Unit
    override fun onSetSuccess() = Unit
    override fun onCreateFailure(error: String?) = Unit
    override fun onSetFailure(error: String?) = Unit
}
