package com.homaklab.cast

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.net.Inet4Address
import com.homaklab.cast.audio.SystemAudioCapture
import com.homaklab.cast.cast.CastService
import com.homaklab.cast.cast.CastState
import com.homaklab.cast.cast.CastStatus
import com.homaklab.cast.databinding.ActivityMainBinding
import com.homaklab.cast.signaling.LanDiscovery
import com.homaklab.cast.signaling.PairingLinks
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val prefs by lazy { getSharedPreferences("cast", Context.MODE_PRIVATE) }

    private var pendingServer: String = ""
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

        if (prefs.getInt(KEY_FPS, 30) >= 60) binding.fps60.isChecked = true else binding.fps30.isChecked = true
        if (SystemAudioCapture.isSupported) {
            binding.audioSwitch.isChecked = prefs.getBoolean(KEY_AUDIO, true)
        } else {
            binding.audioSwitch.isChecked = false
            binding.audioSwitch.isEnabled = false
            binding.audioHint.text = getString(R.string.audio_unsupported)
        }

        // Default flow = type the code, press start. Server/QR/audio/fps live under "advanced".
        setAdvancedVisible(false)
        binding.settingsButton.setOnClickListener { startActivity(Intent(this, SettingsActivity::class.java)) }
        binding.advancedToggle.setOnClickListener {
            setAdvancedVisible(binding.advancedGroup.visibility != View.VISIBLE)
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

    override fun onResume() {
        super.onResume()
        applyBranding() // the name may have just been changed in settings
    }

    /** Default company keeps the bundled logo; any other company shows its name as the heading instead. */
    private fun applyBranding() {
        val name = Branding.normalize(prefs.getString(KEY_COMPANY, null))
        val isDefault = Branding.isDefault(name)
        binding.brandLogo.visibility = if (isDefault) View.VISIBLE else View.GONE
        binding.brandName.visibility = if (isDefault) View.GONE else View.VISIBLE
        binding.brandName.text = name
        title = "$name Cast"
    }

    override fun onStart() {
        super.onStart()
        CastState.observe(::render)
    }

    override fun onStop() {
        CastState.observe(null)
        super.onStop()
    }

    private fun setAdvancedVisible(visible: Boolean) {
        binding.advancedGroup.visibility = if (visible) View.VISIBLE else View.GONE
        binding.advancedToggle.text = getString(if (visible) R.string.advanced_hide else R.string.advanced_show)
    }

    private fun applyScannedText(text: String) {
        // A scanned/opened link may carry a LAN server address; show it so the user sees where it will connect.
        if (PairingLinks.parse(text)?.serverUrl != null) setAdvancedVisible(true)
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
        // Advanced override (QR / typed address). Empty = automatic: local network first, then the settings domain.
        val typed = binding.serverInput.text?.toString().orEmpty().trim()
        val explicitServer = if (typed.isEmpty()) null else PairingLinks.normalizeServerUrl(typed)
        if (typed.isNotEmpty() && explicitServer == null) {
            binding.serverLayout.error = getString(R.string.err_server)
            return
        }
        binding.serverLayout.error = null

        pendingPin = pin
        pendingAudio = binding.audioSwitch.isChecked && SystemAudioCapture.isSupported
        prefs.edit()
            .putInt(KEY_FPS, selectedFps())
            .putBoolean(KEY_AUDIO, pendingAudio)
            .apply()

        if (explicitServer != null) {
            pendingServer = explicitServer
            requestPermissionsAndStart()
        } else {
            resolveAutomatically(pin)
        }
    }

    /** Domain saved in settings (normalized base URL) or null when none is configured. */
    private fun configuredDomain(): String? =
        PairingLinks.normalizeServerUrl(prefs.getString(KEY_DOMAIN, "").orEmpty())

    /**
     * No domain configured -> local network only. Domain configured -> local network first, the domain (cloud) when
     * no local receiver owns the code, so both paths work from the same code.
     */
    private fun resolveAutomatically(pin: String) {
        val domain = configuredDomain()
        val local = localIpv4()
        if (local == null) {
            if (domain == null) {
                toast(getString(R.string.err_no_receiver))
            } else {
                pendingServer = domain
                requestPermissionsAndStart()
            }
            return
        }
        binding.startButton.isEnabled = false
        binding.statusText.text = getString(R.string.status_searching)
        Thread {
            val hosts = LanDiscovery.hostsInSubnet(local.first, local.second)
            val found = LanDiscovery.find(hosts, LanDiscovery.DEFAULT_PORT, pin)
            runOnUiThread {
                if (isDestroyed || isFinishing) return@runOnUiThread
                binding.startButton.isEnabled = true
                binding.statusText.text = getString(R.string.status_idle)
                val server = found ?: domain
                if (server == null) {
                    toast(getString(R.string.err_no_receiver))
                } else {
                    pendingServer = server
                    requestPermissionsAndStart()
                }
            }
        }.apply { isDaemon = true }.start()
    }

    /** The phone's Wi-Fi/Ethernet IPv4 address and prefix length, or null (mobile data only, no network). */
    private fun localIpv4(): Pair<String, Int>? {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = cm.activeNetwork ?: return null
        val caps = cm.getNetworkCapabilities(network) ?: return null
        if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) && !caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return null
        val address = cm.getLinkProperties(network)?.linkAddresses
            ?.firstOrNull { it.address is Inet4Address && !it.address.isLoopbackAddress } ?: return null
        val ip = address.address.hostAddress ?: return null
        return ip to address.prefixLength
    }

    private fun requestPermissionsAndStart() {
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
        const val KEY_DOMAIN = "domain"
        const val KEY_COMPANY = "company"
        const val KEY_FPS = "fps"
        const val KEY_AUDIO = "audio"
    }
}
