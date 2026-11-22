package com.homaklab.cast.cast

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptureSizeTest {

    @Test
    fun small_screens_are_not_upscaled() {
        assertEquals(CaptureSize(720, 1280), CaptureSize.fit(720, 1280))
    }

    @Test
    fun tall_phone_is_capped_to_1920_long_side_keeping_aspect() {
        val size = CaptureSize.fit(1080, 2400)
        assertEquals(1920, size.height)
        assertEquals(864, size.width)
    }

    @Test
    fun landscape_is_capped_on_the_width() {
        val size = CaptureSize.fit(2400, 1080)
        assertEquals(1920, size.width)
        assertEquals(864, size.height)
    }

    @Test
    fun dimensions_are_always_even() {
        listOf(1081 to 1921, 1079 to 2339, 721 to 1281, 3 to 5).forEach { (w, h) ->
            val size = CaptureSize.fit(w, h)
            assertTrue("$w x $h -> ${size.width}x${size.height}", size.width % 2 == 0 && size.height % 2 == 0)
            assertTrue(size.width >= 2 && size.height >= 2)
        }
    }

    @Test(expected = IllegalArgumentException::class)
    fun zero_size_is_rejected() {
        CaptureSize.fit(0, 1080)
    }
}
