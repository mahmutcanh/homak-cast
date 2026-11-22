package com.homaklab.cast

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** In-memory ring buffer of the last steps, attached to error reports so a problem can be diagnosed from one paste. */
object DebugLog {
    private const val MAX_LINES = 200
    private val lines = ArrayDeque<String>()

    @Synchronized
    fun add(message: String) {
        val time = SimpleDateFormat("HH:mm:ss.SSS", Locale.US).format(Date())
        if (lines.size >= MAX_LINES) lines.removeFirst()
        lines.addLast("$time $message")
    }

    @Synchronized
    fun snapshot(): List<String> = lines.toList()

    @Synchronized
    fun clear() = lines.clear()
}
