package com.homaklab.cast.audio

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import org.webrtc.audio.JavaAudioDeviceModule
import java.nio.ByteBuffer

/**
 * Captures what the phone is playing (AudioPlaybackCapture, Android 10+) and feeds it to WebRTC.
 *
 * WebRTC's audio device module reads 10 ms from the microphone every cycle; [onBuffer] runs right after that read
 * and REPLACES the microphone bytes with system audio, so the microphone is never transmitted.
 * Apps can opt out of being captured (and DRM/call audio is never captured), in which case silence is sent.
 */
class SystemAudioCapture(private val projection: MediaProjection) : JavaAudioDeviceModule.AudioBufferCallback {

    private val ring = PcmRingBuffer(RING_BYTES)
    @Volatile private var running = false
    private var record: AudioRecord? = null
    private var reader: Thread? = null
    private var out = ByteArray(0)
    private var scratch = ByteArray(0)

    @SuppressLint("MissingPermission") // checked by hasPermission() before start()
    @RequiresApi(Build.VERSION_CODES.Q)
    fun start(context: Context): Boolean {
        if (!hasPermission(context)) return false
        return try {
            val config = AudioPlaybackCaptureConfiguration.Builder(projection)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .build()
            val format = AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(SAMPLE_RATE)
                .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
                .build()
            val minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_16BIT)
            val rec = AudioRecord.Builder()
                .setAudioFormat(format)
                .setBufferSizeInBytes(maxOf(minBuffer, READ_BYTES * 4))
                .setAudioPlaybackCaptureConfig(config)
                .build()
            if (rec.state != AudioRecord.STATE_INITIALIZED) {
                rec.release()
                return false
            }
            rec.startRecording()
            record = rec
            running = true
            reader = Thread({ readLoop(rec) }, "SystemAudioCapture").apply {
                isDaemon = true
                start()
            }
            true
        } catch (e: Exception) {
            Log.w(TAG, "system audio capture unavailable: ${e.message}")
            false
        }
    }

    fun stop() {
        running = false
        runCatching { record?.stop() }
        reader?.join(500)
        runCatching { record?.release() }
        record = null
        reader = null
        ring.clear()
    }

    private fun readLoop(rec: AudioRecord) {
        val buf = ByteArray(READ_BYTES)
        while (running) {
            val n = rec.read(buf, 0, buf.size)
            if (n > 0) ring.write(buf, 0, n) else if (n < 0) break
        }
    }

    override fun onBuffer(
        buffer: ByteBuffer,
        audioFormat: Int,
        channelCount: Int,
        sampleRate: Int,
        bytesRead: Int,
        captureTimeNs: Long
    ): Long {
        if (bytesRead <= 0) return captureTimeNs
        if (out.size < bytesRead) {
            out = ByteArray(bytesRead)
            scratch = ByteArray(bytesRead * 2)
        }
        val supported = audioFormat == AudioFormat.ENCODING_PCM_16BIT && sampleRate == SAMPLE_RATE
        if (supported) {
            ring.trimTo(MAX_LATENCY_BYTES)
            PcmFrames.fill(ring, out, bytesRead, channelCount, scratch)
        } else {
            java.util.Arrays.fill(out, 0, bytesRead, 0) // never leak microphone data on unexpected formats
        }
        buffer.duplicate().apply { position(0) }.put(out, 0, bytesRead)
        return captureTimeNs
    }

    companion object {
        const val SAMPLE_RATE = 48_000
        private const val TAG = "SystemAudioCapture"
        private const val READ_BYTES = 3_840 // 20 ms of 48 kHz stereo PCM16
        private const val RING_BYTES = 48_000 * 4 / 2 // 500 ms
        private const val MAX_LATENCY_BYTES = 48_000 * 4 * 120 / 1000 // keep at most ~120 ms queued

        fun hasPermission(context: Context): Boolean =
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

        val isSupported: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
    }
}
