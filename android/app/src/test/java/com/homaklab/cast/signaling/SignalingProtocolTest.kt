package com.homaklab.cast.signaling

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SignalingProtocolTest {

    @Test
    fun ice_servers_accept_string_and_array_urls_with_credentials() {
        val json = JSONArray(
            """[
              {"urls":"stun:stun.l.google.com:19302"},
              {"urls":["turn:1.2.3.4:3478?transport=udp","turn:1.2.3.4:3478?transport=tcp"],"username":"u","credential":"c"},
              {"urls":[]},
              {"nope":true}
            ]"""
        )
        val servers = SignalingProtocol.parseIceServers(json)
        assertEquals(2, servers.size)
        assertEquals(listOf("stun:stun.l.google.com:19302"), servers[0].urls)
        assertNull(servers[0].username)
        assertEquals(2, servers[1].urls.size)
        assertEquals("u", servers[1].username)
        assertEquals("c", servers[1].credential)
    }

    @Test
    fun pairing_config_reads_optional_numbers() {
        val cfg = SignalingProtocol.parsePairingConfig(
            JSONObject("""{"iceServers":[{"urls":"stun:x"}],"defaultFps":60,"maxBitrateKbps":8000}""")
        )
        assertEquals(60, cfg.defaultFps)
        assertEquals(8000, cfg.maxBitrateKbps)
        val empty = SignalingProtocol.parsePairingConfig(JSONObject("{}"))
        assertNull(empty.defaultFps)
        assertTrue(empty.iceServers.isEmpty())
    }

    @Test
    fun candidate_is_read_from_server_relay_and_bare_shapes() {
        val relay = JSONObject("""{"candidate":{"candidate":"candidate:1 1 udp 1 1.1.1.1 9 typ host","sdpMid":"0","sdpMLineIndex":0}}""")
        val bare = JSONObject("""{"candidate":"candidate:2 1 udp 1 2.2.2.2 9 typ host","sdpMid":"1","sdpMLineIndex":1}""")
        assertEquals("0", SignalingProtocol.parseCandidate(relay)?.sdpMid)
        assertEquals(1, SignalingProtocol.parseCandidate(bare)?.sdpMLineIndex)
    }

    @Test
    fun end_of_candidates_and_null_mid_are_handled() {
        assertNull(SignalingProtocol.parseCandidate(null))
        assertNull(SignalingProtocol.parseCandidate(JSONObject("""{"candidate":null}""")))
        val c = SignalingProtocol.parseCandidate(JSONObject("""{"candidate":"candidate:3","sdpMid":"null","sdpMLineIndex":2}"""))
        assertNull(c?.sdpMid)
    }

    @Test
    fun outgoing_messages_match_the_web_sender_shape() {
        val req = SignalingProtocol.buildPairingRequest("123456", "Pixel 8", "Pixel 8", "Android 15")
        assertEquals("123456", req.getString("pin"))
        assertEquals("screen", req.getString("sourceType"))
        assertEquals("Android 15", req.getString("os"))

        val cand = SignalingProtocol.buildCandidate(CandidateInit("candidate:1", "0", 0))
        assertEquals("candidate:1", cand.getJSONObject("candidate").getString("candidate"))
        assertEquals("0", cand.getJSONObject("candidate").getString("sdpMid"))
        assertEquals("sdp-text", SignalingProtocol.buildOffer("sdp-text").getString("sdp"))
    }
}
