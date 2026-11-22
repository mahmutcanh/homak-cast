package com.homaklab.cast

import android.content.Context
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.homaklab.cast.databinding.ActivitySettingsBinding
import com.homaklab.cast.signaling.PairingLinks

/** Optional cloud domain. Empty = local network only; set = local first, then this domain. */
class SettingsActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySettingsBinding
    private val prefs by lazy { getSharedPreferences("cast", Context.MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.domainInput.setText(prefs.getString(KEY_DOMAIN, "").orEmpty())
        binding.saveButton.setOnClickListener { save() }
    }

    private fun save() {
        val typed = binding.domainInput.text?.toString().orEmpty().trim()
        if (typed.isEmpty()) {
            prefs.edit().remove(KEY_DOMAIN).apply()
        } else {
            val normalized = PairingLinks.normalizeServerUrl(typed)
            if (normalized == null) {
                binding.domainLayout.error = getString(R.string.err_domain)
                return
            }
            binding.domainLayout.error = null
            prefs.edit().putString(KEY_DOMAIN, normalized).apply()
        }
        Toast.makeText(this, getString(R.string.domain_saved), Toast.LENGTH_SHORT).show()
        finish()
    }

    private companion object {
        const val KEY_DOMAIN = "domain"
    }
}
