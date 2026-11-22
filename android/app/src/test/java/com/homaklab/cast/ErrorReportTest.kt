package com.homaklab.cast

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ErrorReportTest {

    @Test
    fun report_contains_version_device_message_and_log() {
        val text = ErrorReport.format(
            appVersion = "1.5.1 (7)",
            device = "Samsung SM-S911B",
            androidVersion = "14 (SDK 34)",
            time = "2026-11-22 23:59:00",
            message = "Sunucuya bağlanılamadı",
            log = listOf("23:58:59.100 Yerel alıcı bulundu", "23:58:59.900 Bağlanılıyor")
        )
        assertTrue(text.contains("Sürüm: 1.5.1 (7)"))
        assertTrue(text.contains("Cihaz: Samsung SM-S911B"))
        assertTrue(text.contains("Android: 14 (SDK 34)"))
        assertTrue(text.contains("Hata: Sunucuya bağlanılamadı"))
        assertTrue(text.contains("23:58:59.100 Yerel alıcı bulundu"))
    }

    @Test
    fun stack_trace_is_included_only_when_present() {
        val withStack = ErrorReport.format("1", "d", "a", "t", "m", emptyList(), "java.lang.Boom\n\tat x.y(Z.kt:1)")
        assertTrue(withStack.contains("--- Hata ayrıntısı ---"))
        assertTrue(withStack.contains("java.lang.Boom"))
        val without = ErrorReport.format("1", "d", "a", "t", "m", emptyList(), null)
        assertTrue(!without.contains("Hata ayrıntısı"))
        assertTrue(without.contains("(kayıt yok)"))
    }

    @Test
    fun debug_log_keeps_only_the_last_200_lines_in_order() {
        DebugLog.clear()
        repeat(250) { DebugLog.add("line $it") }
        val lines = DebugLog.snapshot()
        assertEquals(200, lines.size)
        assertTrue(lines.first().endsWith("line 50"))
        assertTrue(lines.last().endsWith("line 249"))
        DebugLog.clear()
    }
}
