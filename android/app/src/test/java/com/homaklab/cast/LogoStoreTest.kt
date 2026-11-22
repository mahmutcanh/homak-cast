package com.homaklab.cast

import org.junit.Assert.assertEquals
import org.junit.Test

class LogoStoreTest {

    @Test
    fun small_images_are_not_subsampled() {
        assertEquals(1, LogoStore.sampleSize(300, 200))
        assertEquals(1, LogoStore.sampleSize(512, 512))
    }

    @Test
    fun large_images_are_subsampled_in_powers_of_two() {
        assertEquals(2, LogoStore.sampleSize(1100, 800))
        assertEquals(4, LogoStore.sampleSize(2048, 1500))
        assertEquals(8, LogoStore.sampleSize(4096, 3000))
    }

    @Test
    fun the_longest_side_decides() {
        assertEquals(4, LogoStore.sampleSize(200, 2200))
    }
}
