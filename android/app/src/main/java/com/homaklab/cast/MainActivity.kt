package com.homaklab.cast

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.homaklab.cast.audio.SystemAudioCapture
import com.homaklab.cast.cast.CastService
import com.homaklab.cast.cast.CastState
import com.homaklab.cast.cast.CastStatus
import com.homaklab.cast.databinding.ActivityMainBinding
import com.homaklab.cast.signaling.PairingLinks
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val prefs by lazy { getSharedPreferences("cast", Context.MODE_PRIVATE) }

    private var pendingServer: String = PairingLinks.DEFAULT_SERVER
    private var pendingPin: String = ""
    private var pendingAudio: Boolean = false

    private val scanLauncher = registerForActivityResult(ScanContract()) { result ->
        result.contents?.let(::applyScannedText)
    }

    private val projectionLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        if (result.resultCode == RESULT_OK && data != null) {
            startCastService(data)
        } else {
            toast(getString(R.string.err_projection_denied))
        }
    }

    private val notificationLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        // The cast works without the notification permission; we just continue.
        proceedAfterNotification()
    }

    private val audioPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) {
            pendingAudio = false
            toast(getString(R.string.err_audio_denied))
        }
        requestProjection()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.serverInput.setText(prefs.getString(KEY_SERVER, PairingLinks.DEFAULT_SERVER))
        if (prefs.getInt(KEY_FPS, 30) >= 60) binding.fps60.isChecked = true else binding.fps30.isChecked = true
        if (SystemAudioCapture.isSupported) {
            binding.audioSwitch.isChecked = prefs.getBoolean(KEY_AUDIO, true)
        } else {
            binding.audioSwitch.isChecked = false
            binding.audioSwitch.isEnabled = false
            binding.audioHint.text = getString(R.string.audio_unsupported)
        }

        binding.scanButton.setOnClickListener {
            scanLauncher.launch(
                ScanOptions()
                    .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                    .setPrompt(getString(R.string.scan_prompt))
                    .setBeepEnabled(false)
                    .setOrientationLocked(false)
            )
        }
        binding.startButton.setOnClickListener { onStartClicked() }
        binding.stopButton.setOnClickListener {
            startService(Intent(this, CastService::class.java).setAction(CastService.ACTION_STOP))
        }

        intent?.data?.toString()?.let(::applyScannedText) // homak links opened from a browser/QR app
    }

    override fun onStart() {
        super.onStart()
        CastState.observe(::render)
    }

    override fun onStop() {
        CastState.observe(null)
        super.onStop()
    }

    private fun applyScannedText(text: String) {
        val link = PairingLinks.parse(text)
        if (link == null) {
            toast(getString(R.string.err_bad_qr))
            return
        }
        link.serverUrl?.let { binding.serverInput.setText(it) }
        link.pin?.let { binding.pinInput.setText(it) }
        if (link.pin != null) toast(getString(R.string.scan_ok))
    }

    private fun onStartClicked() {
        val pin = binding.pinInput.text?.toString()?.replace("\\s".toRegex(), "").orEmpty()
        if (!PairingLinks.isValidPin(pin)) {
            binding.pinLayout.error = getString(R.string.err_pin)
            return
        }
        binding.pinLayout.error = null
        val server = PairingLinks.normalizeServerUrl(binding.serverInput.text?.toString().orEmpty())
        if (server == null) {
            binding.serverLayout.error = getString(R.string.err_server)
            return
        }
        binding.serverLayout.error = null

        pendingPin = pin
        pendingServer = server
        pendingAudio = binding.audioSwitch.isChecked && SystemAudioCapture.isSupported
        prefs.edit()
            .putString(KEY_SERVER, server)
            .putInt(KEY_FPS, selectedFps())
            .putBoolean(KEY_AUDIO, pendingAudio)
            .apply()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            proceedAfterNotification()
        }
    }

    /** System audio needs RECORD_AUDIO (AudioPlaybackCapture is gated by it); ask only when the user wants audio. */
    private fun proceedAfterNotification() {
        if (pendingAudio && !SystemAudioCapture.hasPermission(this)) {
            audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        } else {
            requestProjection()
        }
    }

    private fun requestProjection() {
        val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projectionLauncher.launch(manager.createScreenCaptureIntent())
    }

    private fun startCastService(projectionData: Intent) {
        val intent = Intent(this, CastService::class.java)
            .setAction(CastService.ACTION_START)
            .putExtra(CastService.EXTRA_PROJECTION_DATA, projectionData)
            .putExtra(CastService.EXTRA_SERVER, pendingServer)
            .putExtra(CastService.EXTRA_PIN, pendingPin)
            .putExtra(CastService.EXTRA_FPS, selectedFps())
            .putExtra(CastService.EXTRA_AUDIO, pendingAudio)
        ContextCompat.startForegroundService(this, intent)
        CastState.publish(CastStatus.Connecting)
    }

    private fun selectedFps(): Int = if (binding.fps60.isChecked) 60 else 30

    private fun render(status: CastStatus) {
        val active = CastState.isActive
        binding.startButton.visibility = if (active) View.GONE else View.VISIBLE
        binding.stopButton.visibility = if (active) View.VISIBLE else View.GONE
        binding.inputsGroup.visibility = if (active) View.GONE else View.VISIBLE
        binding.statusText.text = when (status) {
            CastStatus.Idle -> getString(R.string.status_idle)
            CastStatus.Connecting -> getString(R.string.status_connecting)
            CastStatus.WaitingApproval -> getString(R.string.status_waiting_approval)
            is CastStatus.Streaming -> getString(
                R.string.status_streaming, status.resolution, status.fps,
                getString(if (status.audio) R.string.audio_on else R.string.audio_off)
            )
            is CastStatus.Ended -> status.reason
            is CastStatus.Failed -> getString(R.string.status_failed, status.message)
        }
    }

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()

    private companion object {
        const val KEY_SERVER = "server"
        const val KEY_FPS = "fps"
        const val KEY_AUDIO = "audio"
    }
}
