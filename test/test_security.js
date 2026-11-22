const path = require('path');
process.env.APPDATA = path.join(require('os').tmpdir(), 'cast_sec_test_appdata');
const root = path.join(__dirname, '..') + path.sep;
const SignalingServer = require(root + 'server/signaling-server.js');
const { io } = require(root + 'node_modules/socket.io-client');

const results = [];
const check = (name, ok) => { results.push([name, ok]); console.log(ok ? 'PASS' : 'FAIL', name); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const emitAck = (sock, ev, data) => new Promise(res => sock.emit(ev, data, res));
const connect = (url, opts = {}) => new Promise((res, rej) => {
  const s = io(url, { transports: ['websocket'], forceNew: true, ...opts });
  s.on('connect', () => res(s)); s.on('connect_error', rej);
});

(async () => {
  const srv = new SignalingServer({ port: 5391 });
  await srv.start();
  const url = 'http://127.0.0.1:5391';

  // receivers
  const recvA = await connect(url);
  const a = await emitAck(recvA, 'register-receiver', { deviceName: '<img src=x onerror=1>A', requireApproval: true });
  const recvB = await connect(url);
  await emitAck(recvB, 'register-receiver', { deviceName: 'B' });

  // sender pairs with A (approval required) -> pending
  const sender = await connect(url);
  let approvalReq = null;
  recvA.on('approval-request', (d) => { approvalReq = d; });
  let approved = false;
  sender.on('pairing-approved', () => { approved = true; });
  const r = await emitAck(sender, 'request-pairing', { pin: a.pin, model: '<script>alert(1)</script>Pixel', os: 'x'.repeat(500) });
  await wait(150);
  check('per-receiver approval honored (WAITING_APPROVAL)', r && r.status === 'WAITING_APPROVAL');
  check('model sanitized (no < >)', approvalReq && !/[<>]/.test(approvalReq.senderInfo.model));
  check('os truncated', approvalReq && approvalReq.senderInfo.os.length <= 60);

  // attacker (receiver B) tries to approve A's pending sender
  recvB.emit('approval-decision', { senderId: sender.id, approved: true });
  await wait(200);
  check('foreign receiver cannot approve', approved === false);
  // real receiver A approves
  recvA.emit('approval-decision', { senderId: sender.id, approved: true });
  await wait(200);
  check('owner receiver can approve', approved === true);

  // answer/candidate hijack: B sends answer/candidate to A's sender
  let gotAnswer = false, gotCand = false;
  sender.on('webrtc-answer', () => { gotAnswer = true; });
  sender.on('webrtc-candidate', () => { gotCand = true; });
  recvB.emit('webrtc-answer', { senderId: sender.id, sdp: 'v=0' });
  recvB.emit('webrtc-candidate', { senderId: sender.id, candidate: {} });
  await wait(200);
  check('foreign receiver cannot inject answer', !gotAnswer);
  check('foreign receiver cannot inject candidate', !gotCand);
  recvA.emit('webrtc-answer', { senderId: sender.id, sdp: 'v=0' });
  await wait(200);
  check('owner receiver answer delivered', gotAnswer);

  // malformed payloads must not crash the server
  const evil = await connect(url);
  evil.emit('request-pairing', undefined);
  evil.emit('approval-decision', null);
  evil.emit('webrtc-answer', 5);
  evil.emit('webrtc-candidate', 'x');
  evil.emit('update-settings', 'x');
  evil.emit('register-receiver', 12);
  await wait(300);
  const alive = await emitAck(evil, 'request-pairing', { pin: '000000' });
  check('server survives malformed payloads', !!alive);

  // brute force: 5 wrong pins -> blocked
  const bf = await connect(url);
  let last;
  for (let i = 0; i < 6; i++) last = await emitAck(bf, 'request-pairing', { pin: '00000' + i });
  check('brute force blocked after 5 fails', last && /bekleyin/.test(last.error || ''));
  // blocked even for a correct pin
  const good = await emitAck(bf, 'request-pairing', { pin: a.pin });
  check('blocked client cannot use valid pin', good && good.ok === false);

  // origin check
  const http = require('http');
  const probe = (origin) => new Promise(res => {
    http.get(url + '/socket.io/?EIO=4&transport=polling', { headers: { Origin: origin, Host: 'cast.homaklab.com' } },
      (resp) => { resp.resume(); res(resp.statusCode); }).on('error', () => res(0));
  });
  check('evil origin rejected', (await probe('https://evil.example')) === 403);
  check('cast.homaklab.com origin allowed', (await probe('https://cast.homaklab.com')) === 200);

  // headers + QR validation
  const fetchJson = (p) => new Promise((res) => http.get(url + p, (resp) => {
    let b = ''; resp.on('data', d => b += d); resp.on('end', () => res({ h: resp.headers, b }));
  }));
  const idx = await fetchJson('/');
  check('CSP header present', /script-src 'self'/.test(idx.h['content-security-policy'] || ''));
  check('x-frame-options', idx.h['x-frame-options'] === 'DENY');
  const qr = JSON.parse((await fetchJson('/api/qr?code=123456&url=' + encodeURIComponent('https://evil.example/phish'))).b);
  check('QR rejects foreign url', qr.url && !qr.url.includes('evil.example'));
  const qr2 = JSON.parse((await fetchJson('/api/qr?code=123456&url=' + encodeURIComponent('http://192.168.1.20:5240/?code=123456'))).b);
  check('QR accepts LAN url', qr2.url === 'http://192.168.1.20:5240/?code=123456');

  // Proxy headers only trusted from a loopback peer
  check('spoofed XFF ignored for non-loopback peer', srv.getClientIp({ 'x-forwarded-for': '1.2.3.4' }, '203.0.113.9') === '203.0.113.9');
  check('XFF honoured behind loopback proxy', srv.getClientIp({ 'cf-connecting-ip': '198.51.100.7' }, '127.0.0.1') === '198.51.100.7');

  srv.resetRateLimit('127.0.0.1'); // earlier brute-force test blocked loopback
  // Annotation relay: whitelisted fields only
  const annSender = await connect(url);
  const annRecv = await connect(url);
  const annReg = await emitAck(annRecv, 'register-receiver', { deviceName: 'Ann' });
  await emitAck(annSender, 'request-pairing', { pin: annReg.pin });
  let ann = null;
  annRecv.on('stream-annotation', (d) => { ann = d; });
  annSender.emit('stream-annotation', { type: 'draw', x0: 5, y0: -2, x1: 0.5, y1: 0.5, color: 'red;evil', size: 9999, extra: 'x' });
  await wait(150);
  check('annotation fields clamped/whitelisted', ann && ann.x0 === 1 && ann.y0 === 0 && ann.color === '#ff1744' && ann.size === 32 && !('extra' in ann));
  ann = null;
  annSender.emit('stream-annotation', { type: 'bogus' });
  await wait(100);
  check('unknown annotation type dropped', ann === null);

  // webrtc-answer with garbage must not throw / crash
  annRecv.emit('webrtc-answer', null);
  annRecv.emit('webrtc-answer', 'str');
  await wait(100);
  check('server alive after bad webrtc-answer', (await fetchJson('/api/status')).b.includes('"ok":true'));

  // Settings sanitation helper (loopback-only path in server)
  check('rotatePin keeps device name', (() => {
    const rec = srv.receiversByPin.get(annReg.pin);
    const before = rec.deviceName;
    const rot = srv.rotatePin(annRecv.id, { keepSenders: true });
    return rot && rot.record.deviceName === before && rot.record.activeSenders.size === rec.activeSenders.size;
  })());

  // Pending approval is rejected when the receiver disappears
  const apRecv = await connect(url);
  const apReg = await emitAck(apRecv, 'register-receiver', { deviceName: 'Ap', requireApproval: true });
  const apSender = await connect(url);
  let rejected = false;
  apSender.on('pairing-rejected', () => { rejected = true; });
  await emitAck(apSender, 'request-pairing', { pin: apReg.pin });
  apRecv.disconnect();
  await wait(200);
  check('pending approval rejected when receiver drops', rejected);

  const failed = results.filter(x => !x[1]);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('TEST ERROR', e); process.exit(2); });
