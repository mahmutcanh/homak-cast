package com.homaklab.cast

import android.content.Context
import android.os.Bundle
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.homaklab.cast.databinding.ActivitySettingsBinding
import com.homaklab.cast.signaling.PairingLinks

/** Company name (main-screen branding) and optional cloud domain (empty = local network only; set = local first, then domain). */
class SettingsActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySettingsBinding
    private val prefs by lazy { getSharedPreferences("cast", Context.MODE_PRIVATE) }

    private val logoPicker = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            if (LogoStore.save(this, uri)) refreshLogo() else Toast.makeText(this, getString(R.string.err_logo), Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.companyInput.setText(Branding.normalize(prefs.getString(KEY_COMPANY, null)))
        binding.domainInput.setText(prefs.getString(KEY_DOMAIN, "").orEmpty())
        binding.saveButton.setOnClickListener { save() }
        binding.logoPickButton.setOnClickListener { logoPicker.launch("image/*") }
        binding.logoClearButton.setOnClickListener {
            LogoStore.clear(this)
            refreshLogo()
        }
        refreshLogo()
    }

    /** The logo applies as soon as it is picked or removed; Save only covers the text fields. */
    private fun refreshLogo() {
        val logo = LogoStore.load(this)
        if (logo != null) binding.logoPreview.setImageBitmap(logo) else binding.logoPreview.setImageResource(R.drawable.lol_logo)
        binding.logoClearButton.isEnabled = logo != null
    }

    private fun save() {
        val typed = binding.domainInput.text?.toString().orEmpty().trim()
        val domain = if (typed.isEmpty()) null else PairingLinks.normalizeServerUrl(typed)
        if (typed.isNotEmpty() && domain == null) {
            binding.domainLayout.error = getString(R.string.err_domain)
            return
        }
        binding.domainLayout.error = null
        prefs.edit().apply {
            putString(KEY_COMPANY, Branding.normalize(binding.companyInput.text?.toString()))
            if (domain == null) remove(KEY_DOMAIN) else putString(KEY_DOMAIN, domain)
        }.apply()
        Toast.makeText(this, getString(R.string.domain_saved), Toast.LENGTH_SHORT).show()
        finish()
    }

    private companion object {
        const val KEY_DOMAIN = "domain"
        const val KEY_COMPANY = "company"
    }
}
