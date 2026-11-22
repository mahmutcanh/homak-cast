const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cast_license_'));
process.env.APPDATA = tmp;

const root = path.join(__dirname, '..') + path.sep;
const {
  normalizeLicense, licenseStatus, passwordProblem, hashPassword, verifyPassword, AdminSession
} = require(root + 'server/license');
const { loadSettings, saveSettings } = require(root + 'server/config');
const SignalingServer = require(root + 'server/signaling-server.js');
const { io } = require(root + 'node_modules/socket.io-client');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const emitAck = (sock, ev, data) => new Promise((res) => sock.emit(ev, data, res));
const connect = (url) => new Promise((res, rej) => {
  const s = io(url, { transports: ['websocket'], forceNew: true });
  s.on('connect', () => res(s));
  s.on('connect_error', rej);
});
async function checkAsync(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

(async () => {
  // ---- pure license logic
  check('normalizeLicense fills defaults and clamps values', () => {
    assert.deepStrictEqual(normalizeLicense(null), { holder: '', expiresAt: '', maxDevices: 4, lockBranding: false });
    assert.strictEqual(normalizeLicense({ maxDevices: 99 }).maxDevices, 4);
    assert.strictEqual(normalizeLicense({ maxDevices: 0 }).maxDevices, 1);
    assert.strictEqual(normalizeLicense({ maxDevices: 'abc' }).maxDevices, 4);
    assert.strictEqual(normalizeLicense({ lockBranding: 'yes' }).lockBranding, false);
    assert.strictEqual(normalizeLicense({ holder: '  Acme \n Corp ' }).holder, 'Acme Corp');
    assert.strictEqual(normalizeLicense({ holder: 'x'.repeat(100) }).holder.length, 60);
  });
  check('invalid or impossible dates are dropped', () => {
    assert.strictEqual(normalizeLicense({ expiresAt: '2026-02-31' }).expiresAt, '');
    assert.strictEqual(normalizeLicense({ expiresAt: '2026-13-01' }).expiresAt, '');
    assert.strictEqual(normalizeLicense({ expiresAt: 'tomorrow' }).expiresAt, '');
    assert.strictEqual(normalizeLicense({ expiresAt: '2026-12-31' }).expiresAt, '2026-12-31');
  });
  check('licenseStatus: expiry is end of the given day', () => {
    const noon = Date.parse('2026-06-10T12:00:00');
    assert.strictEqual(licenseStatus({ expiresAt: '2026-06-10' }, noon).expired, false);
    assert.strictEqual(licenseStatus({ expiresAt: '2026-06-09' }, noon).expired, true);
    assert.strictEqual(licenseStatus({ expiresAt: '2026-06-12' }, noon).daysLeft, 3);
    assert.strictEqual(licenseStatus({ expiresAt: '' }, noon).expired, false);
    assert.strictEqual(licenseStatus({}, noon).daysLeft, null);
  });
  check('password policy and hashing', () => {
    assert.ok(passwordProblem('12345'));
    assert.strictEqual(passwordProblem('123456'), null);
    const hash = hashPassword('correct horse');
    assert.ok(hash.startsWith('scrypt$'));
    assert.notStrictEqual(hash, hashPassword('correct horse')); // random salt
    assert.strictEqual(verifyPassword('correct horse', hash), true);
    assert.strictEqual(verifyPassword('wrong', hash), false);
    assert.strictEqual(verifyPassword('x', ''), false);
    assert.strictEqual(verifyPassword('x', 'garbage'), false);
  });
  check('AdminSession: login, lockout after 5 failures, idle timeout', () => {
    let t = 1000000;
    const session = new AdminSession({ now: () => t, idleMs: 60000, lockMs: 30000 });
    const hash = hashPassword('secret1');
    assert.strictEqual(session.active, false);
    for (let i = 0; i < 4; i += 1) assert.strictEqual(session.login('bad', hash).ok, false);
    assert.strictEqual(session.login('bad', hash).ok, false); // 5th failure locks
    const locked = session.login('secret1', hash);
    assert.strictEqual(locked.ok, false);
    assert.ok(/bekle|sn sonra/i.test(locked.error));
    t += 31000;
    assert.strictEqual(session.login('secret1', hash).ok, true);
    assert.strictEqual(session.active, true);
    t += 61000;
    assert.strictEqual(session.active, false); // idle timeout
    session.start();
    session.logout();
    assert.strictEqual(session.active, false);
  });

  // ---- settings persistence
  check('license persists normalized; hash stored; default license is unrestricted', () => {
    assert.deepStrictEqual(loadSettings().license, { holder: '', expiresAt: '', maxDevices: 4, lockBranding: false });
    saveSettings({ license: { holder: 'Acme', maxDevices: 2, expiresAt: '2030-01-01', lockBranding: true }, adminPasswordHash: hashPassword('secret1') });
    const s = loadSettings();
    assert.strictEqual(s.license.maxDevices, 2);
    assert.strictEqual(s.license.lockBranding, true);
    assert.ok(verifyPassword('secret1', s.adminPasswordHash));
    saveSettings({ license: { maxDevices: 7, expiresAt: 'bogus' } });
    assert.deepStrictEqual(loadSettings().license, { holder: '', expiresAt: '', maxDevices: 4, lockBranding: false });
  });

  // ---- server enforcement
  let license = { maxDevices: 4, expiresAt: '' };
  const srv = new SignalingServer({ port: 5392, getLicense: () => license });
  await srv.start();
  const url = 'http://127.0.0.1:5392';
  const receiver = await connect(url);
  const reg = await emitAck(receiver, 'register-receiver', { deviceName: 'R', requireApproval: false });

  await checkAsync('device limit from the license is enforced (1 device)', async () => {
    license = { maxDevices: 1, expiresAt: '' };
    const s1 = await connect(url);
    const r1 = await emitAck(s1, 'request-pairing', { pin: reg.pin, model: 'A', os: 'x' });
    assert.ok(r1.ok, JSON.stringify(r1));
    const s2 = await connect(url);
    const r2 = await emitAck(s2, 'request-pairing', { pin: reg.pin, model: 'B', os: 'x' });
    assert.strictEqual(r2.ok, false);
    assert.ok(/1\/1/.test(r2.error), r2.error);
    s1.close();
    s2.close();
    await wait(200);
  });

  await checkAsync('expired license rejects new pairings with a clear message', async () => {
    license = { maxDevices: 4, expiresAt: '2000-01-01' };
    const s = await connect(url);
    const r = await emitAck(s, 'request-pairing', { pin: reg.pin, model: 'C', os: 'x' });
    assert.strictEqual(r.ok, false);
    assert.ok(/lisans/i.test(r.error), r.error);
    s.close();
  });

  await checkAsync('verify-code: 403 when expired, 200 when valid', async () => {
    const call = () => fetch(url + '/api/verify-code', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: reg.pin })
    });
    license = { maxDevices: 4, expiresAt: '2000-01-01' };
    assert.strictEqual((await call()).status, 403);
    license = { maxDevices: 4, expiresAt: '' };
    assert.strictEqual((await call()).status, 200);
  });

  await checkAsync('socket update-settings cannot touch admin data or the license', async () => {
    saveSettings({ license: { maxDevices: 3, holder: 'Keep' }, adminPasswordHash: hashPassword('secret1') });
    const before = loadSettings();
    await emitAck(receiver, 'update-settings', { adminPasswordHash: 'x', license: { maxDevices: 1 }, deviceName: 'New' });
    const after = loadSettings();
    assert.strictEqual(after.adminPasswordHash, before.adminPasswordHash);
    assert.deepStrictEqual(after.license, before.license);
  });

  receiver.close();
  await srv.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`test_license: ${passed}/${passed} passed`);
  process.exit(0);
})().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
