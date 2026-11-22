package com.homaklab.cast

import android.content.Context
import android.os.Build
import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Builds a plain-text report (version, device, message, recent steps, stack trace) that the user can copy and
 * hand to any assistant or support person, and remembers a crash so it can be shown on the next launch.
 */
object ErrorReport {
    private const val CRASH_FILE = "last_crash.txt"

    fun format(
        appVersion: String,
        device: String,
        androidVersion: String,
        time: String,
        message: String,
        log: List<String>,
        stack: String? = null
    ): String = buildString {
        appendLine("Homak Cast hata raporu")
        appendLine("Sürüm: $appVersion")
        appendLine("Cihaz: $device")
        appendLine("Android: $androidVersion")
        appendLine("Zaman: $time")
        appendLine("Hata: $message")
        if (!stack.isNullOrBlank()) {
            appendLine()
            appendLine("--- Hata ayrıntısı ---")
            appendLine(stack.trim())
        }
        appendLine()
        appendLine("--- Son adımlar ---")
        if (log.isEmpty()) appendLine("(kayıt yok)") else log.forEach { appendLine(it) }
    }.trimEnd()

    fun build(context: Context, message: String, stack: String? = null): String {
        val version = runCatching {
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            @Suppress("DEPRECATION")
            "${info.versionName} (${info.versionCode})"
        }.getOrDefault("?")
        return format(
            appVersion = version,
            device = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
            androidVersion = "${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})",
            time = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date()),
            message = message,
            log = DebugLog.snapshot(),
            stack = stack
        )
    }

    /** Saves uncaught exceptions (any thread, including the cast service) for display on the next launch. */
    fun install(context: Context) {
        val app = context.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            runCatching {
                DebugLog.add("ÇÖKME: ${throwable.javaClass.simpleName}: ${throwable.message}")
                File(app.filesDir, CRASH_FILE).writeText(
                    build(app, "Beklenmeyen çökme (${thread.name}): $throwable", Log.getStackTraceString(throwable))
                )
            }
            previous?.uncaughtException(thread, throwable)
        }
    }

    fun pendingCrash(context: Context): String? =
        File(context.filesDir, CRASH_FILE).takeIf { it.exists() }?.let { runCatching { it.readText() }.getOrNull() }

    fun clearCrash(context: Context) {
        File(context.filesDir, CRASH_FILE).delete()
    }
}
