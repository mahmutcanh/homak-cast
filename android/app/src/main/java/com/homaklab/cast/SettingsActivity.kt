package com.homaklab.cast

import android.content.Context
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.homaklab.cast.databinding.ActivitySettingsBinding
import com.homaklab.cast.signaling.PairingLinks

/** Company name (main-screen branding) and optional cloud domain (empty = local network only; set = local first, then domain). */
class SettingsActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySettingsBinding
    private val prefs by lazy { getSharedPreferences("cast", Context.MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.companyInput.setText(Branding.normalize(prefs.getString(KEY_COMPANY, null)))
        binding.domainInput.setText(prefs.getString(KEY_DOMAIN, "").orEmpty())
        binding.saveButton.setOnClickListener { save() }
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
