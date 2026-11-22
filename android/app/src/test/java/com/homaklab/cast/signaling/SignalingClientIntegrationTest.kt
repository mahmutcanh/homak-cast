package com.homaklab.cast.signaling

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Runs the real Node signaling server plus a fake receiver and drives [SignalingClient] through the whole
 * sender handshake (pairing -> offer -> answer -> candidates -> stop). Skipped when `node` is unavailable.
 */
class SignalingClientIntegrationTest {

    private val port = 5470
    private val serverUrl = "http://127.0.0.1:$port"
    private val processes = mutableListOf<Process>()
    private val receiverLines = CopyOnWriteArrayList<String>()
    private lateinit var repoRoot: File

    @Before
    fun startServerAndReceiver() {
        assumeTrue("node is required for this integration test", commandExists("node"))
        repoRoot = generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }
            .firstOrNull { File(it, "server/signaling-server.js").exists() }
            ?: run { assumeTrue("repo root not found", false); throw IllegalStateException() }

        val appData = File(System.getProperty("java.io.tmpdir"), "cast_android_it_${System.nanoTime()}").apply { mkdirs() }
        val server = ProcessBuilder("node", File(repoRoot, "server/signaling-server.js").path)
            .directory(repoRoot)
            .redirectErrorStream(true)
            .apply {
                environment()["PORT"] = port.toString()
                environment()["BIND_HOST"] = "127.0.0.1"
                environment()["APPDATA"] = appData.path
            }.start()
        processes += server
        drain(server) { }
        waitForServer()

        val receiver = ProcessBuilder(
            "node", File("src/test/resources/fake_receiver.js").absolutePath, serverUrl, repoRoot.path
        ).redirectErrorStream(true).start()
        processes += receiver
        drain(receiver) { receiverLines += it }
    }

    @After
    fun stopProcesses() {
        processes.forEach { it.destroy() }
    }

    @Test
    fun full_sender_handshake_against_real_server() {
        val pin = awaitReceiverLine("PIN=").removePrefix("PIN=")
        assertTrue(PairingLinks.isValidPin(pin))

        val approved = CountDownLatch(1)
        val answered = CountDownLatch(1)
        val gotCandidate = CountDownLatch(1)
        val terminated = CountDownLatch(1)
        var answerSdp: String? = null
        var remote: CandidateInit? = null
        var failure: String? = null

        val client = SignalingClient(serverUrl, object : SignalingClient.Listener {
            override fun onConnected() = Unit
            override fun onConnectError(message: String) { failure = "connect: $message" }
            override fun onWaitingApproval() { failure = "unexpected approval wait" }
            override fun onPairingApproved(config: PairingConfig) {
                configRef = config
                approved.countDown()
            }
            override fun onPairingRejected(reason: String) { failure = "rejected: $reason" }
            override fun onAnswer(sdp: String) { answerSdp = sdp; answered.countDown() }
            override fun onRemoteCandidate(candidate: CandidateInit) { remote = candidate; gotCandidate.countDown() }
            override fun onStreamTerminated(reason: String) { terminated.countDown() }
            override fun onDisconnected(reason: String) = Unit
        })
        client.connect()
        // connect callback -> pair (the real service does the same from onConnected)
        Thread.sleep(500)
        client.requestPairing(pin, "Test Pixel", "Pixel Test", "Android 15")

        assertTrue("pairing-approved not received ($failure)", approved.await(10, TimeUnit.SECONDS))
        val config = configRef
        assertTrue("server must hand out ICE servers", config != null && config.iceServers.isNotEmpty())

        awaitReceiverLine("SENDER=").let {
            assertTrue(it, it.contains("MODEL=Pixel Test") && it.contains("OS=Android 15"))
        }

        client.sendOffer("v=0 test-offer")
        assertEquals("v=0 test-offer", awaitReceiverLine("OFFER=").removePrefix("OFFER="))
        assertTrue("answer not received", answered.await(10, TimeUnit.SECONDS))
        assertEquals("ANSWER-FROM-RECEIVER", answerSdp)
        assertTrue("remote candidate not received", gotCandidate.await(10, TimeUnit.SECONDS))
        assertEquals("candidate:9 1 udp 1 10.0.0.9 9 typ host", remote?.candidate)
        assertEquals("0", remote?.sdpMid)

        client.sendCandidate(CandidateInit("candidate:7 1 udp 1 10.0.0.7 9 typ host", "0", 0))
        val relayed = awaitReceiverLine("CAND=")
        assertTrue(relayed, relayed.startsWith("CAND=candidate:7 1 udp 1 10.0.0.7 9 typ host"))

        client.stopStream()
        assertTrue("stream-terminated not received", terminated.await(10, TimeUnit.SECONDS))
        client.close()
    }

    @Test
    fun wrong_pin_is_rejected_with_a_message() {
        val rejected = CountDownLatch(1)
        var reason: String? = null
        val client = SignalingClient(serverUrl, object : SignalingClient.Listener {
            override fun onConnected() = Unit
            override fun onConnectError(message: String) = Unit
            override fun onWaitingApproval() = Unit
            override fun onPairingApproved(config: PairingConfig) = Unit
            override fun onPairingRejected(reason0: String) { reason = reason0; rejected.countDown() }
            override fun onAnswer(sdp: String) = Unit
            override fun onRemoteCandidate(candidate: CandidateInit) = Unit
            override fun onStreamTerminated(reason: String) = Unit
            override fun onDisconnected(reason: String) = Unit
        })
        client.connect()
        Thread.sleep(500)
        client.requestPairing("000000", "Test", "Test", "Android 15")
        assertTrue(rejected.await(10, TimeUnit.SECONDS))
        assertTrue(reason.orEmpty().isNotBlank())
        client.close()
    }

    @Test
    fun lan_discovery_finds_the_receiver_that_owns_the_pin() {
        val pin = awaitReceiverLine("PIN=").removePrefix("PIN=")
        // 127.0.0.2 does not answer; 127.0.0.1 runs the real server.
        val hosts = listOf("127.0.0.2", "127.0.0.1")
        assertEquals(serverUrl, LanDiscovery.find(hosts, port, pin))
    }

    @Test
    fun lan_discovery_returns_null_for_an_unknown_pin() {
        awaitReceiverLine("PIN=")
        assertEquals(null, LanDiscovery.find(listOf("127.0.0.1"), port, "000000"))
    }

    @Volatile
    private var configRef: PairingConfig? = null

    private fun awaitReceiverLine(prefix: String, seconds: Long = 15): String {
        val deadline = System.currentTimeMillis() + seconds * 1000
        while (System.currentTimeMillis() < deadline) {
            receiverLines.firstOrNull { it.startsWith(prefix) }?.let { return it }
            Thread.sleep(50)
        }
        throw AssertionError("receiver never printed '$prefix'; saw: $receiverLines")
    }

    private fun drain(process: Process, sink: (String) -> Unit) {
        Thread {
            BufferedReader(InputStreamReader(process.inputStream)).useLines { lines -> lines.forEach(sink) }
        }.apply { isDaemon = true }.start()
    }

    private fun waitForServer() {
        val deadline = System.currentTimeMillis() + 15_000
        while (System.currentTimeMillis() < deadline) {
            try {
                val conn = URL("$serverUrl/api/status").openConnection() as HttpURLConnection
                conn.connectTimeout = 500
                if (conn.responseCode == 200) return
            } catch (_: Exception) {
                Thread.sleep(200)
            }
        }
        throw AssertionError("signaling server did not start on port $port")
    }

    private fun commandExists(cmd: String): Boolean = try {
        ProcessBuilder(cmd, "--version").redirectErrorStream(true).start().waitFor() == 0
    } catch (_: Exception) {
        false
    }
}
