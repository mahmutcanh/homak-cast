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
        receiverSocket.emit('register-receiver', { deviceName: 'Test Living Room TV' }, (res) => {
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
        badSenderSocket.emit('request-pairing', { pin: '000000', deviceName: 'Bad Actor' }, (res) => {
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

    // 5. DIRECT PAIRING TEST (requireApproval = false by default)
    const directSenderSocket = io(serverUrl);
    await new Promise((resolve) => directSenderSocket.on('connect', resolve));

    server.resetRateLimit('127.0.0.1');

    const receiverConnectedPromise = new Promise((resolve) => {
      receiverSocket.once('sender-connected', ({ senderInfo }) => {
        assert.strictEqual(senderInfo.model, 'Samsung Galaxy S23');
        assert.strictEqual(senderInfo.os, 'Android');
        console.log(`[PASS] Receiver directly connected without prompt! Detected Model: ${senderInfo.model} (${senderInfo.os})`);
        resolve();
      });
    });

    const senderApprovedPromise = new Promise((resolve) => {
      directSenderSocket.on('pairing-approved', (config) => {
        assert.ok(config.iceServers.length > 0, 'ICE servers must be provided');
        console.log('[PASS] Sender directly approved and received ICE servers immediately.');
        resolve();
      });
    });

    directSenderSocket.emit('request-pairing', {
      pin: initialPin,
      deviceName: 'Samsung Galaxy S23 (Chrome)',
      model: 'Samsung Galaxy S23',
      os: 'Android',
      browser: 'Chrome Mobile'
    });

    await Promise.all([receiverConnectedPromise, senderApprovedPromise]);

    // 6. Multi-sender capacity: same PIN accepts up to 4 senders, the 5th is rejected
    const extraSockets = [];
    const pairExtra = async () => {
      const sock = io(serverUrl);
      await new Promise((resolve) => sock.on('connect', resolve));
      extraSockets.push(sock);
      return new Promise((resolve) => {
        sock.emit('request-pairing', { pin: initialPin, deviceName: 'Extra' }, resolve);
      });
    };
    for (let i = 0; i < 3; i++) {
      const res = await pairExtra();
      assert.strictEqual(res.ok, true, `Sender ${i + 2}/4 should be accepted`);
    }
    const overflow = await pairExtra();
    assert.strictEqual(overflow.ok, false, 'Fifth sender must be rejected');
    assert.ok(/4\/4/.test(overflow.error), 'Rejection must mention capacity');
    console.log('[PASS] Multi-sender capacity (4/4) enforced.');
    extraSockets.forEach((sock) => sock.disconnect());

    // 7. Receiver stops all streams -> brand new PIN (device name preserved)
    let newPin = null;
    const newPinPromise = new Promise((resolve) => {
      receiverSocket.on('pin-update', ({ pin }) => {
        assert.strictEqual(pin.length, 6);
        assert.notStrictEqual(pin, initialPin, 'New PIN must be different from previous PIN');
        newPin = pin;
        console.log(`[PASS] Stream terminated. Brand new PIN generated: ${pin}`);
        resolve();
      });
    });

    receiverSocket.emit('stop-stream');
    await newPinPromise;
    assert.strictEqual(server.receiversByPin.get(newPin).deviceName, 'Test Living Room TV',
      'Receiver device name must survive PIN rotation');
    directSenderSocket.disconnect();

    // 8. APPROVAL MODE TEST (when enabled in settings)
    server.settings.requireApproval = true;
    console.log('[INFO] Testing approval mode enabled in settings...');

    const promptSenderSocket = io(serverUrl);
    await new Promise((resolve) => promptSenderSocket.on('connect', resolve));

    const approvalPromptPromise = new Promise((resolve) => {
      receiverSocket.once('approval-request', ({ senderId, senderInfo }) => {
        console.log(`[PASS] Approval prompt received on receiver for: ${senderInfo.deviceName}`);
        receiverSocket.emit('approval-decision', { senderId, approved: true });
        resolve();
      });
    });

    promptSenderSocket.emit('request-pairing', {
      pin: newPin,
      deviceName: 'Windows 11 Laptop',
      model: 'ThinkPad X1',
      os: 'Windows',
      browser: 'Edge'
    });

    await approvalPromptPromise;
    promptSenderSocket.disconnect();
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
