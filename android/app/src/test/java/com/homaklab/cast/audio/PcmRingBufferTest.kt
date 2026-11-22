package com.homaklab.cast.audio

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class PcmRingBufferTest {

    private fun bytes(vararg v: Int) = ByteArray(v.size) { v[it].toByte() }

    @Test
    fun reads_back_what_was_written_in_order() {
        val ring = PcmRingBuffer(8)
        ring.write(bytes(1, 2, 3, 4), 0, 4)
        val out = ByteArray(4)
        assertEquals(4, ring.read(out, 0, 4))
        assertArrayEquals(bytes(1, 2, 3, 4), out)
        assertEquals(0, ring.available())
    }

    @Test
    fun wraps_around_the_end_of_the_buffer() {
        val ring = PcmRingBuffer(6)
        ring.write(bytes(1, 2, 3, 4), 0, 4)
        ring.read(ByteArray(3), 0, 3)               // leaves [4]
        ring.write(bytes(5, 6, 7, 8), 0, 4)         // wraps
        val out = ByteArray(5)
        assertEquals(5, ring.read(out, 0, 5))
        assertArrayEquals(bytes(4, 5, 6, 7, 8), out)
    }

    @Test
    fun overflow_drops_the_oldest_bytes() {
        val ring = PcmRingBuffer(4)
        ring.write(bytes(1, 2, 3), 0, 3)
        ring.write(bytes(4, 5, 6), 0, 3)
        val out = ByteArray(4)
        assertEquals(4, ring.read(out, 0, 4))
        assertArrayEquals(bytes(3, 4, 5, 6), out)
    }

    @Test
    fun a_write_larger_than_capacity_keeps_only_the_newest_bytes() {
        val ring = PcmRingBuffer(3)
        ring.write(bytes(1, 2, 3, 4, 5), 0, 5)
        val out = ByteArray(3)
        assertEquals(3, ring.read(out, 0, 3))
        assertArrayEquals(bytes(3, 4, 5), out)
    }

    @Test
    fun reading_more_than_available_returns_only_what_exists() {
        val ring = PcmRingBuffer(8)
        ring.write(bytes(9, 8), 0, 2)
        val out = ByteArray(5)
        assertEquals(2, ring.read(out, 0, 5))
    }

    @Test
    fun trim_keeps_the_newest_bytes_to_cap_latency() {
        val ring = PcmRingBuffer(8)
        ring.write(bytes(1, 2, 3, 4, 5, 6), 0, 6)
        ring.trimTo(2)
        val out = ByteArray(2)
        assertEquals(2, ring.read(out, 0, 2))
        assertArrayEquals(bytes(5, 6), out)
    }

    @Test
    fun stereo_to_mono_averages_left_and_right() {
        // L=1000, R=3000 -> 2000 ; L=-100, R=-300 -> -200 (little-endian 16-bit)
        val stereo = shorts(1000, 3000, -100, -300)
        val mono = ByteArray(4)
        assertEquals(4, PcmFrames.stereoToMono(stereo, stereo.size, mono))
        assertArrayEquals(shorts(2000, -200), mono)
    }

    @Test
    fun fill_pads_underruns_with_silence_for_stereo() {
        val ring = PcmRingBuffer(64)
        ring.write(bytes(1, 2, 3, 4), 0, 4)
        val out = ByteArray(8) { 9 }
        PcmFrames.fill(ring, out, 8, 2, ByteArray(16))
        assertArrayEquals(bytes(1, 2, 3, 4, 0, 0, 0, 0), out)
    }

    @Test
    fun fill_downmixes_for_mono_streams() {
        val ring = PcmRingBuffer(64)
        val stereo = shorts(1000, 3000, 500, 500)
        ring.write(stereo, 0, stereo.size)
        val out = ByteArray(4) { 7 }
        PcmFrames.fill(ring, out, 4, 1, ByteArray(8))
        assertArrayEquals(shorts(2000, 500), out)
    }

    @Test
    fun fill_stays_silent_for_unsupported_channel_counts() {
        val ring = PcmRingBuffer(16)
        ring.write(bytes(1, 2, 3, 4), 0, 4)
        val out = ByteArray(4) { 5 }
        PcmFrames.fill(ring, out, 4, 6, ByteArray(8))
        assertArrayEquals(ByteArray(4), out)
    }

    private fun shorts(vararg v: Int): ByteArray {
        val out = ByteArray(v.size * 2)
        v.forEachIndexed { i, s ->
            out[i * 2] = (s and 0xFF).toByte()
            out[i * 2 + 1] = ((s shr 8) and 0xFF).toByte()
        }
        return out
    }
}
