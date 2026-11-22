package com.homaklab.cast.signaling

import org.json.JSONArray
import org.json.JSONObject

/** One entry of the iceServers list the server sends on pairing (STUN/TURN). */
data class IceServerConfig(val urls: List<String>, val username: String?, val credential: String?)

/** Same shape as the browser's RTCIceCandidateInit. */
data class CandidateInit(val candidate: String, val sdpMid: String?, val sdpMLineIndex: Int)

data class PairingConfig(
    val iceServers: List<IceServerConfig>,
    val defaultFps: Int?,
    val maxBitrateKbps: Int?
)

/** Pure JSON <-> model mapping for the Socket.IO signaling protocol (kept free of Android types). */
object SignalingProtocol {

    fun parseIceServers(array: JSONArray?): List<IceServerConfig> {
        if (array == null) return emptyList()
        val out = mutableListOf<IceServerConfig>()
        for (i in 0 until array.length()) {
            val obj = array.optJSONObject(i) ?: continue
            val urls = when (val raw = obj.opt("urls")) {
                is String -> listOf(raw)
                is JSONArray -> (0 until raw.length()).mapNotNull { raw.optString(it).takeIf { s -> s.isNotEmpty() } }
                else -> emptyList()
            }
            if (urls.isEmpty()) continue
            out += IceServerConfig(
                urls,
                obj.optString("username").takeIf { it.isNotEmpty() },
                obj.optString("credential").takeIf { it.isNotEmpty() }
            )
        }
        return out
    }

    fun parsePairingConfig(obj: JSONObject?): PairingConfig = PairingConfig(
        iceServers = parseIceServers(obj?.optJSONArray("iceServers")),
        defaultFps = obj?.optInt("defaultFps", 0)?.takeIf { it > 0 },
        maxBitrateKbps = obj?.optInt("maxBitrateKbps", 0)?.takeIf { it > 0 }
    )

    /** Accepts both `{candidate:{...}}` (server relay) and a bare candidate object; null = end-of-candidates. */
    fun parseCandidate(payload: JSONObject?): CandidateInit? {
        if (payload == null) return null
        val inner = payload.optJSONObject("candidate") ?: payload
        val line = inner.optString("candidate")
        if (line.isEmpty()) return null
        return CandidateInit(
            candidate = line,
            sdpMid = inner.optString("sdpMid").takeIf { it.isNotEmpty() && it != "null" },
            sdpMLineIndex = inner.optInt("sdpMLineIndex", 0)
        )
    }

    fun buildPairingRequest(pin: String, deviceName: String, model: String, os: String): JSONObject =
        JSONObject()
            .put("pin", pin)
            .put("deviceName", deviceName)
            .put("model", model)
            .put("os", os)
            .put("browser", "Homak Cast Android")
            .put("sourceType", "screen")

    fun buildCandidate(candidate: CandidateInit): JSONObject =
        JSONObject().put(
            "candidate",
            JSONObject()
                .put("candidate", candidate.candidate)
                .put("sdpMid", candidate.sdpMid ?: JSONObject.NULL)
                .put("sdpMLineIndex", candidate.sdpMLineIndex)
        )

    fun buildOffer(sdp: String): JSONObject = JSONObject().put("sdp", sdp)
}
