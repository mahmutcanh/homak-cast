const assert = require('assert');
const { io } = require('socket.io-client');
const SignalingServer = require('../server/signaling-server');

async function runTests() {
  console.log('--- HOMAK CAST INTEGRATION TESTS STARTING ---');
  
  const testPort = 5299;
  const server = new SignalingServer({ port: testPort });
  await server.start();
  console.log(`[PASS] Server started on port ${testPort}`);

  const serverUrl = `http://localhost:${testPort}`;

  try {
    // 1. Status API check
    const statusRes = await fetch(`${serverUrl}/api/status`).then(r => r.json());
    assert.strictEqual(statusRes.ok, true, 'Status API should return ok: true');
    assert.strictEqual(statusRes.receiverOnline, false, 'Receiver should initially be offline');
    console.log('[PASS] Status API verified.');

    // 2. Connect Receiver
    const receiverSocket = io(serverUrl);
    let initialPin = null;

    await new Promise((resolve) => {
      receiverSocket.on('connect', () => {
        receiverSocket.emit('register-receiver', {}, (res) => {
          assert.strictEqual(res.ok, true);
          assert.strictEqual(typeof res.pin, 'string');
          assert.strictEqual(res.pin.length, 6, 'PIN must be exactly 6 digits');
          initialPin = res.pin;
          console.log(`[PASS] Receiver registered. Active PIN: ${initialPin}`);
          resolve();
        });
      });
    });

    // 3. QR Endpoint Check
    const qrRes = await fetch(`${serverUrl}/api/qr?code=${initialPin}`).then(r => r.json());
    assert.strictEqual(qrRes.ok, true);
    assert.ok(qrRes.qr.startsWith('data:image/png;base64,'), 'QR must be base64 PNG data URL');
    console.log('[PASS] QR code generation verified.');

    // 4. Rate Limiting Check (Sender tries wrong PIN 5 times)
    const badSenderSocket = io(serverUrl);
    await new Promise((resolve) => badSenderSocket.on('connect', resolve));

    let rateLimitTriggered = false;
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => {
        badSenderSocket.emit('request-pairing', { pin: '000000', deviceName: 'Test Bad Actor' }, (res) => {
          if (!res.ok && res.error.includes('bekleyin')) {
            rateLimitTriggered = true;
          }
          resolve();
        });
      });
    }
    assert.strictEqual(rateLimitTriggered, true, 'Rate limit should be triggered after 5 failed attempts');
    console.log('[PASS] Brute-force rate limiting verified.');
    badSenderSocket.disconnect();

    // 5. Valid Sender Pairing with Approval Flow
    const goodSenderSocket = io(serverUrl);
    await new Promise((resolve) => goodSenderSocket.on('connect', resolve));

    // Listen for approval request on receiver
    const approvalPromise = new Promise((resolve) => {
      receiverSocket.on('approval-request', ({ senderId, senderInfo }) => {
        console.log(`[PASS] Receiver received approval request from: ${senderInfo.deviceName}`);
        // Approve it!
        receiverSocket.emit('approval-decision', { senderId, approved: true });
        resolve();
      });
    });

    const pairingPromise = new Promise((resolve) => {
      goodSenderSocket.on('pairing-approved', (config) => {
        assert.ok(config.iceServers.length > 0, 'ICE servers must be provided');
        console.log('[PASS] Sender received pairing approval and ICE servers.');
        resolve();
      });
    });

    // Sender requests pairing
    server.resetRateLimit('127.0.0.1'); // clear rate limit for good test
    goodSenderSocket.emit('request-pairing', { pin: initialPin, deviceName: 'Test Sender Laptop' });

    await Promise.all([approvalPromise, pairingPromise]);

    // 6. Check PIN invalidation (Code should now be invalid while in use)
    const intruderSocket = io(serverUrl);
    await new Promise((resolve) => intruderSocket.on('connect', resolve));
    await new Promise((resolve) => {
      intruderSocket.emit('request-pairing', { pin: initialPin }, (res) => {
        assert.strictEqual(res.ok, false, 'Invalidated PIN should be rejected');
        console.log('[PASS] Active PIN invalidation verified (code cannot be reused).');
        resolve();
      });
    });
    intruderSocket.disconnect();

    // 7. Stream Termination & New PIN Generation
    const newPinPromise = new Promise((resolve) => {
      receiverSocket.on('pin-update', ({ pin }) => {
        assert.strictEqual(pin.length, 6);
        assert.notStrictEqual(pin, initialPin, 'New PIN must be different from previous PIN');
        console.log(`[PASS] Stream terminated. Brand new PIN generated: ${pin}`);
        resolve();
      });
    });

    // Sender stops stream
    goodSenderSocket.emit('stop-stream');
    await newPinPromise;

    goodSenderSocket.disconnect();
    receiverSocket.disconnect();

    console.log('\n=============================================');
    console.log(' ALL HOMAK CAST TESTS PASSED SUCCESSFULLY! ');
    console.log('=============================================\n');

  } finally {
    await server.stop();
  }
}

runTests().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
