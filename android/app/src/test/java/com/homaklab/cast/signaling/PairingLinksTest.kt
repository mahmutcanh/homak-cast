package com.homaklab.cast.signaling

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingLinksTest {

    @Test
    fun bare_pin_is_accepted() {
        assertEquals(PairingLink(null, "123456"), PairingLinks.parse(" 123456 "))
    }

    @Test
    fun cloud_qr_keeps_https_server_and_pin() {
        val link = PairingLinks.parse("https://cast.homaklab.com/?code=654321")
        assertEquals(PairingLink("https://cast.homaklab.com", "654321"), link)
    }

    @Test
    fun lan_https_qr_is_rewritten_to_plain_http_port() {
        val link = PairingLinks.parse("https://192.168.1.20:5241/?code=111222&hp=5240")
        assertEquals(PairingLink("http://192.168.1.20:5240", "111222"), link)
    }

    @Test
    fun older_receivers_without_hint_use_the_default_http_port() {
        val link = PairingLinks.parse("https://192.168.1.20:5241/?code=111222")
        assertEquals("http://192.168.1.20:5240", link?.serverUrl)
    }

    @Test
    fun lan_https_on_a_custom_port_without_hint_is_left_alone() {
        val link = PairingLinks.parse("https://192.168.1.20:9443/?code=111222")
        assertEquals("https://192.168.1.20:9443", link?.serverUrl)
    }

    @Test
    fun http_port_hint_is_ignored_for_public_hosts() {
        val link = PairingLinks.parse("https://example.com/?code=123456&hp=5240")
        assertEquals("https://example.com", link?.serverUrl)
    }

    @Test
    fun invalid_pin_in_query_is_dropped() {
        assertNull(PairingLinks.parse("https://cast.homaklab.com/?code=12ab")?.pin)
    }

    @Test
    fun garbage_is_rejected() {
        listOf("", "   ", "hello", "12345", "1234567", "ftp://x.example/?code=123456", "javascript:alert(1)")
            .forEach { assertNull("should reject: $it", PairingLinks.parse(it)) }
    }

    @Test
    fun typed_server_addresses_are_normalized() {
        assertEquals("http://192.168.1.5:5240", PairingLinks.normalizeServerUrl("192.168.1.5:5240"))
        assertEquals("https://cast.example.com", PairingLinks.normalizeServerUrl("cast.example.com/"))
        assertEquals("http://10.0.0.2:5240", PairingLinks.normalizeServerUrl("http://10.0.0.2:5240/"))
        assertNull(PairingLinks.normalizeServerUrl("  "))
        assertNull(PairingLinks.normalizeServerUrl("ftp://a.example"))
    }

    @Test
    fun private_host_detection() {
        listOf("10.0.0.1", "192.168.1.1", "172.16.0.1", "172.31.255.1", "127.0.0.1", "localhost")
            .forEach { assertTrue(it, PairingLinks.isPrivateHost(it)) }
        listOf("8.8.8.8", "172.32.0.1", "172.15.0.1", "cast.homaklab.com")
            .forEach { assertFalse(it, PairingLinks.isPrivateHost(it)) }
    }
}
