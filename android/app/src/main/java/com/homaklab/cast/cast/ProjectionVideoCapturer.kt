package com.homaklab.cast.cast

import android.content.Context
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.projection.MediaProjection
import android.view.Surface
import org.webrtc.CapturerObserver
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoFrame
import org.webrtc.VideoSink

/**
 * Screen capturer on top of an EXISTING [MediaProjection].
 *
 * libwebrtc's ScreenCapturerAndroid fetches its own projection from the permission result, but Android 14+ lets that
 * token be used only once. System-audio capture needs the very same projection, so both share this one instance.
 */
class ProjectionVideoCapturer(
    private val projection: MediaProjection,
    private val onProjectionStopped: () -> Unit
) : VideoCapturer, VideoSink {

    private var helper: SurfaceTextureHelper? = null
    private var observer: CapturerObserver? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var width = 0
    private var height = 0
    private var started = false

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() = onProjectionStopped()
    }

    override fun initialize(helper: SurfaceTextureHelper, context: Context, observer: CapturerObserver) {
        this.helper = helper
        this.observer = observer
    }

    @Synchronized
    override fun startCapture(width: Int, height: Int, framerate: Int) {
        val h = helper ?: error("initialize() must be called first")
        this.width = width
        this.height = height
        // Android 14+: the callback must be registered before the first virtual display is created.
        projection.registerCallback(projectionCallback, h.handler)
        createVirtualDisplay()
        observer?.onCapturerStarted(true)
        h.startListening(this)
        started = true
    }

    @Synchronized
    override fun stopCapture() {
        if (!started) return
        started = false
        helper?.stopListening()
        virtualDisplay?.release()
        virtualDisplay = null
        runCatching { projection.unregisterCallback(projectionCallback) }
        observer?.onCapturerStopped()
    }

    @Synchronized
    override fun changeCaptureFormat(width: Int, height: Int, framerate: Int) {
        this.width = width
        this.height = height
        val display = virtualDisplay ?: return
        helper?.setTextureSize(width, height)
        display.resize(width, height, VIRTUAL_DISPLAY_DPI)
    }

    override fun dispose() {
        stopCapture()
    }

    override fun isScreencast(): Boolean = true

    override fun onFrame(frame: VideoFrame) {
        observer?.onFrameCaptured(frame)
    }

    private fun createVirtualDisplay() {
        val h = helper ?: return
        h.setTextureSize(width, height)
        virtualDisplay = projection.createVirtualDisplay(
            "HomakCast_ScreenCapture",
            width,
            height,
            VIRTUAL_DISPLAY_DPI,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_PUBLIC,
            Surface(h.surfaceTexture),
            null,
            null
        )
    }

    private companion object {
        const val VIRTUAL_DISPLAY_DPI = 400
    }
}
