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
    fun default_detection_ignores_case() {
        assertTrue(Branding.isDefault("the land of legends"))
        assertFalse(Branding.isDefault("Acme"))
    }
}
