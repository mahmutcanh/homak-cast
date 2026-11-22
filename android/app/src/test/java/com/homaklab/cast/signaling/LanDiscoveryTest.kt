package com.homaklab.cast.signaling

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LanDiscoveryTest {

    @Test
    fun slash24_lists_254_hosts_minus_own_address() {
        val hosts = LanDiscovery.hostsInSubnet("192.168.1.20", 24)
        assertEquals(253, hosts.size)
        assertEquals("192.168.1.1", hosts.first())
        assertEquals("192.168.1.254", hosts.last())
        assertFalse(hosts.contains("192.168.1.20"))
        assertFalse(hosts.contains("192.168.1.0"))
        assertFalse(hosts.contains("192.168.1.255"))
    }

    @Test
    fun smaller_subnet_is_respected() {
        val hosts = LanDiscovery.hostsInSubnet("10.0.0.130", 26) // 10.0.0.128/26 -> .129 - .190
        assertEquals("10.0.0.129", hosts.first())
        assertEquals("10.0.0.190", hosts.last())
        assertEquals(61, hosts.size)
    }

    @Test
    fun huge_subnets_are_capped_to_a_slash22() {
        val hosts = LanDiscovery.hostsInSubnet("10.1.2.3", 8)
        assertTrue(hosts.size <= 1022)
        assertTrue(hosts.contains("10.1.0.1"))
        assertTrue(hosts.contains("10.1.3.254"))
        assertFalse(hosts.contains("10.2.0.1"))
    }

    @Test
    fun invalid_address_yields_nothing() {
        assertTrue(LanDiscovery.hostsInSubnet("not-an-ip", 24).isEmpty())
        assertTrue(LanDiscovery.hostsInSubnet("300.1.1.1", 24).isEmpty())
    }
}
