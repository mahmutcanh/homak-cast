package com.homaklab.cast.signaling

import io.socket.client.Ack
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject
import java.net.URI

/**
 * Sender side of the Homak Cast signaling protocol (same events the web sender uses):
 *   -> request-pairing {pin, deviceName, model, os, browser, sourceType}   (ack: ok | WAITING_APPROVAL)
 *   <- pairing-approved {iceServers, defaultFps, maxBitrateKbps} | pairing-rejected {reason}
 *   -> webrtc-offer {sdp}      <- webrtc-answer {sdp}
 *   <> webrtc-candidate {candidate}
 *   <- stream-terminated {reason}      -> stop-stream
 * Callbacks arrive on the Socket.IO thread; callers must hop to their own thread if needed.
 */
class SignalingClient(private val serverUrl: String, private val listener: Listener) {

    interface Listener {
        fun onConnected()
        fun onConnectError(message: String)
        fun onWaitingApproval()
        fun onPairingApproved(config: PairingConfig)
        fun onPairingRejected(reason: String)
        fun onAnswer(sdp: String)
        fun onRemoteCandidate(candidate: CandidateInit)
        fun onStreamTerminated(reason: String)
        fun onDisconnected(reason: String)
    }

    private var socket: Socket? = null

    fun connect() {
        val options = IO.Options().apply {
            // WebSocket only: works through Cloudflare tunnels and avoids long-polling overhead.
            transports = arrayOf("websocket")
            reconnection = false // a dropped signaling link ends the session; the user restarts it
            timeout = 10_000
        }
        val s = IO.socket(URI.create(serverUrl), options)
        socket = s

        s.on(Socket.EVENT_CONNECT) { listener.onConnected() }
        s.on(Socket.EVENT_CONNECT_ERROR) { args ->
            listener.onConnectError(args.firstOrNull()?.toString() ?: "connect_error")
        }
        s.on(Socket.EVENT_DISCONNECT) { args ->
            listener.onDisconnected(args.firstOrNull()?.toString() ?: "disconnect")
        }
        s.on("pairing-approved") { args ->
            listener.onPairingApproved(SignalingProtocol.parsePairingConfig(args.firstOrNull() as? JSONObject))
        }
        s.on("pairing-rejected") { args ->
            listener.onPairingRejected(reasonOf(args))
        }
        s.on("webrtc-answer") { args ->
            val sdp = (args.firstOrNull() as? JSONObject)?.optString("sdp").orEmpty()
            if (sdp.isNotEmpty()) listener.onAnswer(sdp)
        }
        s.on("webrtc-candidate") { args ->
            SignalingProtocol.parseCandidate(args.firstOrNull() as? JSONObject)?.let(listener::onRemoteCandidate)
        }
        s.on("stream-terminated") { args -> listener.onStreamTerminated(reasonOf(args)) }
        s.connect()
    }

    fun requestPairing(pin: String, deviceName: String, model: String, os: String) {
        val request = SignalingProtocol.buildPairingRequest(pin, deviceName, model, os)
        socket?.emit("request-pairing", request, Ack { args ->
            val res = args.firstOrNull() as? JSONObject
            when {
                res == null -> listener.onPairingRejected("Sunucudan geçersiz yanıt alındı.")
                !res.optBoolean("ok") -> listener.onPairingRejected(res.optString("error", "Eşleştirme reddedildi."))
                res.optString("status") == "WAITING_APPROVAL" -> listener.onWaitingApproval()
                // CONNECTED: 'pairing-approved' arrives as its own event.
            }
        })
    }

    fun sendOffer(sdp: String) {
        socket?.emit("webrtc-offer", SignalingProtocol.buildOffer(sdp))
    }

    fun sendCandidate(candidate: CandidateInit) {
        socket?.emit("webrtc-candidate", SignalingProtocol.buildCandidate(candidate))
    }

    fun stopStream() {
        socket?.emit("stop-stream")
    }

    fun close() {
        socket?.let {
            it.off()
            it.disconnect()
            it.close()
        }
        socket = null
    }

    private fun reasonOf(args: Array<Any?>): String =
        (args.firstOrNull() as? JSONObject)?.optString("reason").orEmpty().ifEmpty { "Bağlantı sonlandı." }
}
