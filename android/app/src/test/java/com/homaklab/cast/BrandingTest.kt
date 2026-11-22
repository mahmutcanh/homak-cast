package com.homaklab.cast

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BrandingTest {

    @Test
    fun trims_and_collapses_whitespace() {
        assertEquals("Acme Corp", Branding.normalize("  Acme    Corp  "))
    }

    @Test
    fun control_characters_become_spaces() {
        assertEquals("a b c", Branding.normalize("a\nb\tc"))
    }

    @Test
    fun empty_or_null_falls_back_to_default() {
        assertEquals(Branding.DEFAULT_COMPANY, Branding.normalize(""))
        assertEquals(Branding.DEFAULT_COMPANY, Branding.normalize("   "))
        assertEquals(Branding.DEFAULT_COMPANY, Branding.normalize(null))
    }

    @Test
    fun is_capped_at_60_characters() {
        assertEquals(60, Branding.normalize("A".repeat(100)).length)
    }

    @Test
    fun device_label_joins_company_and_device() {
        assertEquals("Acme · Pixel 8", Branding.deviceLabel("Acme", "Pixel 8"))
    }

    @Test
    fun device_label_shortens_the_company_first_and_stays_within_80_chars() {
        val label = Branding.deviceLabel("C".repeat(60), "D".repeat(40))
        assertEquals(80, label.length)
        assertTrue(label.endsWith(" · " + "D".repeat(40)))
    }

    @Test
    fun device_label_drops_the_company_when_the_device_name_leaves_no_room() {
        assertEquals("D".repeat(80), Branding.deviceLabel("Acme", "D".repeat(120)))
    }

    @Test
    fun default_detection_ignores_case() {
        assertTrue(Branding.isDefault("the land of legends"))
        assertFalse(Branding.isDefault("Acme"))
    }
}
