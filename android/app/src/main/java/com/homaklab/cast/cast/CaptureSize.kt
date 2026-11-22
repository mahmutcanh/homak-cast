package com.homaklab.cast.cast

/** Capture resolution: keep the screen's aspect ratio, cap the long side, force even dimensions (H.264/VP8 friendly). */
data class CaptureSize(val width: Int, val height: Int) {
    companion object {
        const val MAX_LONG_SIDE = 1920

        fun fit(screenWidth: Int, screenHeight: Int, maxLongSide: Int = MAX_LONG_SIDE): CaptureSize {
            require(screenWidth > 0 && screenHeight > 0) { "screen size must be positive" }
            val longSide = maxOf(screenWidth, screenHeight)
            val scale = if (longSide > maxLongSide) maxLongSide.toDouble() / longSide else 1.0
            return CaptureSize(even((screenWidth * scale).toInt()), even((screenHeight * scale).toInt()))
        }

        private fun even(v: Int): Int = maxOf(2, v - (v % 2))
    }
}
