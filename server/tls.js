const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const selfsigned = require('selfsigned');
const { APPDATA_DIR, getNetworkAddresses } = require('./config');

const CERT_DIR = path.join(APPDATA_DIR, 'tls');
const VALID_DAYS = 825;
const RENEW_BEFORE_MS = 30 * 24 * 60 * 60 * 1000;

function currentIps() {
  const ips = new Set(['127.0.0.1']);
  for (const a of getNetworkAddresses()) ips.add(a.address);
  return [...ips].sort();
}

function readExisting(dir, ips, now) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    const covered = ips.every((ip) => meta.ips.includes(ip));
    if (!covered || meta.notAfter - now < RENEW_BEFORE_MS) return null;
    return {
      key: fs.readFileSync(path.join(dir, 'key.pem'), 'utf8'),
      cert: fs.readFileSync(path.join(dir, 'cert.pem'), 'utf8'),
      fingerprint: meta.fingerprint
    };
  } catch (e) {
    return null;
  }
}

/**
 * Per-machine self-signed certificate for the LAN HTTPS listener. Phones need a secure context
 * (https) for screen capture; the user accepts the certificate warning once per device.
 * The private key never leaves this machine and is not shared between installs.
 * The cert is reused until the machine gets an IP the cert does not cover, or it nears expiry.
 */
async function loadOrCreateCert(dir = CERT_DIR, ips = currentIps(), now = Date.now()) {
  const existing = readExisting(dir, ips, now);
  if (existing) return existing;

  const notAfter = new Date(now + VALID_DAYS * 24 * 60 * 60 * 1000);
  const altNames = [
    { type: 2, value: 'localhost' },
    ...ips.map((ip) => ({ type: 7, ip })),
    { type: 7, ip: '::1' }
  ];
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'Homak Cast' }], {
    algorithm: 'sha256',
    keySize: 2048,
    notBeforeDate: new Date(now - 60 * 1000),
    notAfterDate: notAfter,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames }
    ]
  });

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'key.pem'), pems.private, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'cert.pem'), pems.cert, 'utf8');
  const fingerprint = pems.fingerprint || crypto.createHash('sha256').update(pems.cert).digest('hex');
  fs.writeFileSync(
    path.join(dir, 'meta.json'),
    JSON.stringify({ ips, notAfter: notAfter.getTime(), fingerprint }),
    'utf8'
  );
  return { key: pems.private, cert: pems.cert, fingerprint };
}

module.exports = { loadOrCreateCert, currentIps };
