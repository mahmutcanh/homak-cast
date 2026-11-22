package com.homaklab.cast.signaling

import java.net.URI

/** A scanned QR / typed address resolved to a signaling server and (optionally) a PIN. */
data class PairingLink(val serverUrl: String?, val pin: String?)

object PairingLinks {
    const val DEFAULT_SERVER = "https://cast.homaklab.com"
    private const val DEFAULT_LAN_HTTPS_PORT = 5241
    private const val DEFAULT_LAN_HTTP_PORT = 5240

    private val PIN_RE = Regex("^\\d{6}$")
    private val PRIVATE_IPV4_RE =
        Regex("^(10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|192\\.168\\.\\d{1,3}\\.\\d{1,3}|127\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|172\\.(1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3})$")

    fun isPrivateHost(host: String): Boolean = host == "localhost" || PRIVATE_IPV4_RE.matches(host)

    fun isValidPin(pin: String): Boolean = PIN_RE.matches(pin)

    /**
     * Parses what the receiver screen shows in its QR code, e.g.
     *   https://cast.homaklab.com/?code=123456
     *   https://192.168.1.20:5241/?code=123456&hp=5240   (LAN: browsers use https, the app talks plain http on hp)
     * A bare 6-digit PIN is accepted as well. Returns null when the text is neither.
     */
    fun parse(raw: String): PairingLink? {
        val text = raw.trim()
        if (text.isEmpty()) return null
        if (isValidPin(text)) return PairingLink(null, text)

        val uri = try { URI(text) } catch (e: Exception) { return null }
        val scheme = uri.scheme?.lowercase() ?: return null
        val host = uri.host ?: return null
        if (scheme != "http" && scheme != "https") return null

        val params = parseQuery(uri.rawQuery)
        val pin = params["code"]?.takeIf { isValidPin(it) }
        // Receivers that predate the "hp" hint still use the default pair: HTTPS 5241 <-> HTTP 5240.
        val httpPort = params["hp"]?.toIntOrNull()?.takeIf { it in 1..65535 }
            ?: if (uri.port == DEFAULT_LAN_HTTPS_PORT) DEFAULT_LAN_HTTP_PORT else null

        val server = if (scheme == "https" && isPrivateHost(host) && httpPort != null) {
            // The LAN HTTPS listener uses a self-signed certificate that only browsers can be told to
            // accept; the native app does not need a secure context, so it uses the plain HTTP port.
            "http://$host:$httpPort"
        } else {
            val port = if (uri.port > 0) ":${uri.port}" else ""
            "$scheme://$host$port"
        }
        return PairingLink(server, pin)
    }

    /** Turns user-typed server text ("192.168.1.5:5240", "cast.example.com") into a base URL, or null. */
    fun normalizeServerUrl(raw: String): String? {
        var text = raw.trim().trimEnd('/')
        if (text.isEmpty()) return null
        if (!text.contains("://")) {
            val host = text.substringBefore(':').substringBefore('/')
            text = (if (isPrivateHost(host)) "http://" else "https://") + text
        }
        val uri = try { URI(text) } catch (e: Exception) { return null }
        val scheme = uri.scheme?.lowercase()
        val host = uri.host
        if (host == null || (scheme != "http" && scheme != "https")) return null
        val port = if (uri.port > 0) ":${uri.port}" else ""
        return "$scheme://$host$port"
    }

    private fun parseQuery(rawQuery: String?): Map<String, String> {
        if (rawQuery.isNullOrEmpty()) return emptyMap()
        return rawQuery.split('&').mapNotNull { part ->
            val idx = part.indexOf('=')
            if (idx <= 0) null else part.substring(0, idx) to java.net.URLDecoder.decode(part.substring(idx + 1), "UTF-8")
        }.toMap()
    }
}
