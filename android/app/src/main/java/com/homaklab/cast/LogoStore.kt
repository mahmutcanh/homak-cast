package com.homaklab.cast

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import java.io.File

/** The logo picked in settings, kept as a small PNG in the app's private storage. */
object LogoStore {
    private const val FILE_NAME = "logo.png"
    private const val MAX_SIDE = 512

    /** Power-of-two decode factor so the decoded bitmap stays near [maxSide] on its longest side. */
    fun sampleSize(width: Int, height: Int, maxSide: Int = MAX_SIDE): Int {
        var sample = 1
        while (width / (sample * 2) >= maxSide || height / (sample * 2) >= maxSide) sample *= 2
        return sample
    }

    private fun target(context: Context) = File(context.filesDir, FILE_NAME)

    fun load(context: Context): Bitmap? =
        target(context).takeIf { it.exists() }?.let { BitmapFactory.decodeFile(it.path) }

    /** Decodes [uri], scales it down to at most [MAX_SIDE] px and stores it. Returns false when it is not a readable image. */
    fun save(context: Context, uri: Uri): Boolean = try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            false
        } else {
            val options = BitmapFactory.Options().apply { inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight) }
            val decoded = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
            if (decoded == null) {
                false
            } else {
                val longest = maxOf(decoded.width, decoded.height)
                val bitmap = if (longest > MAX_SIDE) {
                    val scale = MAX_SIDE.toFloat() / longest
                    Bitmap.createScaledBitmap(
                        decoded,
                        maxOf(1, (decoded.width * scale).toInt()),
                        maxOf(1, (decoded.height * scale).toInt()),
                        true
                    )
                } else {
                    decoded
                }
                val temp = File(context.filesDir, "$FILE_NAME.tmp")
                temp.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                temp.renameTo(target(context)) || (target(context).delete() && temp.renameTo(target(context)))
            }
        }
    } catch (e: Exception) {
        false
    }

    fun clear(context: Context) {
        target(context).delete()
    }
}
