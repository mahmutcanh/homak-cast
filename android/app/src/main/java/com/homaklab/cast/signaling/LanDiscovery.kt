package com.homaklab.cast.signaling

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Finds the LAN receiver that owns a pairing PIN without the user typing an address.
 *
 * The receiver's embedded server answers `GET /api/status` on a fixed port. We probe every host of the phone's
 * subnet for that endpoint (cheap, no side effects), then ask each Homak Cast server that answered whether it knows
 * the PIN (`POST /api/verify-code`). Several receivers on one network are fine: only the owner of the PIN matches.
 */
object LanDiscovery {
    const val DEFAULT_PORT = 5240
    private const val MAX_HOSTS = 1022
    private const val MIN_PREFIX = 22

    /** All usable host addresses of the subnet containing [ownIp] (own address, network and broadcast excluded). */
    fun hostsInSubnet(ownIp: String, prefixLength: Int): List<String> {
        val parts = ownIp.split('.').mapNotNull { it.toIntOrNull()?.takeIf { n -> n in 0..255 } }
        if (parts.size != 4) return emptyList()
        val prefix = prefixLength.coerceIn(MIN_PREFIX, 30)
        val own = parts.fold(0L) { acc, p -> (acc shl 8) or p.toLong() }
        val mask = (0xFFFFFFFFL shl (32 - prefix)) and 0xFFFFFFFFL
        val network = own and mask
        val broadcast = network or (mask.inv() and 0xFFFFFFFFL)
        val hosts = ArrayList<String>()
        var addr = network + 1
        while (addr < broadcast && hosts.size < MAX_HOSTS) {
            if (addr != own) hosts += dotted(addr)
            addr++
        }
        return hosts
    }

    /**
     * Returns the base URL (`http://host:port`) of the receiver server that accepts [pin], or null when none does.
     * Blocking: call from a background thread.
     */
    fun find(
        hosts: List<String>,
        port: Int,
        pin: String,
        connectTimeoutMs: Int = 500,
        readTimeoutMs: Int = 1500,
        threads: Int = 64
    ): String? {
        if (hosts.isEmpty()) return null
        val pool = Executors.newFixedThreadPool(threads.coerceAtMost(hosts.size))
        try {
            val probes = hosts.map { host ->
                pool.submit(Callable { if (isHomakServer(host, port, connectTimeoutMs, readTimeoutMs)) host else null })
            }
            val servers = probes.mapNotNull { runCatching { it.get(10, TimeUnit.SECONDS) }.getOrNull() }
            return servers.firstNotNullOfOrNull { host ->
                val base = "http://$host:$port"
                if (ownsPin(base, pin, connectTimeoutMs, readTimeoutMs)) base else null
            }
        } finally {
            pool.shutdownNow()
        }
    }

    private fun isHomakServer(host: String, port: Int, connectTimeoutMs: Int, readTimeoutMs: Int): Boolean {
        val body = request("http://$host:$port/api/status", "GET", null, connectTimeoutMs, readTimeoutMs)?.second ?: return false
        return try {
            val json = JSONObject(body)
            json.optBoolean("ok") && json.optString("service").startsWith("Homak Cast")
        } catch (e: Exception) {
            false
        }
    }

    /** 200 = known PIN; 409 = known PIN but the receiver is full (pairing will then show the proper message). */
    private fun ownsPin(base: String, pin: String, connectTimeoutMs: Int, readTimeoutMs: Int): Boolean {
        val payload = JSONObject().put("code", pin).toString()
        val status = request("$base/api/verify-code", "POST", payload, connectTimeoutMs, readTimeoutMs)?.first
        return status == 200 || status == 409
    }

    /** Returns (httpStatus, body) or null on any network failure. */
    private fun request(url: String, method: String, body: String?, connectTimeoutMs: Int, readTimeoutMs: Int): Pair<Int, String>? {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = connectTimeoutMs
                readTimeout = readTimeoutMs
                instanceFollowRedirects = false
                if (body != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    outputStream.use { it.write(body.toByteArray()) }
                }
            }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            status to (stream?.bufferedReader()?.use { it.readText() }.orEmpty())
        } catch (e: Exception) {
            null
        } finally {
            conn?.disconnect()
        }
    }

    private fun dotted(addr: Long): String =
        "${(addr shr 24) and 255}.${(addr shr 16) and 255}.${(addr shr 8) and 255}.${addr and 255}"
}
