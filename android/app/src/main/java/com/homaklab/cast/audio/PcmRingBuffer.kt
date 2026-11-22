package com.homaklab.cast.audio

/**
 * Fixed-capacity byte ring used between the AudioPlaybackCapture reader thread and the WebRTC audio thread.
 * Overflow drops the OLDEST data so latency stays bounded; thread-safe via a single lock.
 */
class PcmRingBuffer(private val capacity: Int) {
    private val data = ByteArray(capacity)
    private var readPos = 0
    private var size = 0

    init {
        require(capacity > 0) { "capacity must be positive" }
    }

    @Synchronized
    fun available(): Int = size

    @Synchronized
    fun clear() {
        readPos = 0
        size = 0
    }

    @Synchronized
    fun write(src: ByteArray, offset: Int, length: Int) {
        require(offset >= 0 && length >= 0 && offset + length <= src.size) { "range out of bounds" }
        var off = offset
        var len = length
        if (len >= capacity) { // only the newest `capacity` bytes can survive
            off += len - capacity
            len = capacity
            readPos = 0
            size = 0
        }
        val overflow = size + len - capacity
        if (overflow > 0) {
            readPos = (readPos + overflow) % capacity
            size -= overflow
        }
        val writePos = (readPos + size) % capacity
        val first = minOf(len, capacity - writePos)
        System.arraycopy(src, off, data, writePos, first)
        System.arraycopy(src, off + first, data, 0, len - first)
        size += len
    }

    /** Copies up to [length] bytes into [dst]; returns how many were available. */
    @Synchronized
    fun read(dst: ByteArray, offset: Int, length: Int): Int {
        require(offset >= 0 && length >= 0 && offset + length <= dst.size) { "range out of bounds" }
        val n = minOf(length, size)
        val first = minOf(n, capacity - readPos)
        System.arraycopy(data, readPos, dst, offset, first)
        System.arraycopy(data, 0, dst, offset + first, n - first)
        readPos = (readPos + n) % capacity
        size -= n
        return n
    }

    /** Drops the oldest bytes so at most [maxBytes] remain (caps playback latency). */
    @Synchronized
    fun trimTo(maxBytes: Int) {
        val excess = size - maxBytes
        if (excess > 0) {
            readPos = (readPos + excess) % capacity
            size -= excess
        }
    }
}

/** Frame filling helpers for 16-bit little-endian PCM. */
object PcmFrames {
    const val BYTES_PER_SAMPLE = 2

    /** Averages interleaved stereo frames into mono. [stereoLen] is in bytes; returns mono bytes written. */
    fun stereoToMono(stereo: ByteArray, stereoLen: Int, mono: ByteArray): Int {
        val frames = stereoLen / (2 * BYTES_PER_SAMPLE)
        for (i in 0 until frames) {
            val l = sample(stereo, i * 4)
            val r = sample(stereo, i * 4 + 2)
            val m = (l + r) / 2
            mono[i * 2] = (m and 0xFF).toByte()
            mono[i * 2 + 1] = ((m shr 8) and 0xFF).toByte()
        }
        return frames * BYTES_PER_SAMPLE
    }

    /**
     * Fills [out] (first [length] bytes) from stereo [ring] data for a stream with [channelCount] channels.
     * Missing data (underrun) is padded with silence. [scratch] must hold 2 * length bytes.
     */
    fun fill(ring: PcmRingBuffer, out: ByteArray, length: Int, channelCount: Int, scratch: ByteArray) {
        java.util.Arrays.fill(out, 0, length, 0)
        when (channelCount) {
            2 -> ring.read(out, 0, length)
            1 -> {
                val stereoBytes = length * 2
                val got = ring.read(scratch, 0, stereoBytes)
                stereoToMono(scratch, got, out)
            }
            else -> Unit // unsupported layout: stay silent rather than send garbage
        }
    }

    private fun sample(b: ByteArray, i: Int): Int = (b[i].toInt() and 0xFF) or (b[i + 1].toInt() shl 8)
}
