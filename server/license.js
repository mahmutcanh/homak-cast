const crypto = require('crypto');

const MAX_DEVICES_LIMIT = 4;
const MIN_PASSWORD_LENGTH = 6;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const defaultLicense = Object.freeze({
  holder: '',
  expiresAt: '', // 'YYYY-MM-DD' (valid through the end of that day), empty = never expires
  maxDevices: MAX_DEVICES_LIMIT,
  lockBranding: false // true: company name and logo can only be changed after the admin password
});

function validDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  // Round-trip: JS silently rolls 2026-02-31 over to March, so compare the parts again.
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** Always returns a complete, safe license object whatever was stored or submitted. */
function normalizeLicense(input) {
  const src = input && typeof input === 'object' ? input : {};
  const holder = typeof src.holder === 'string'
    ? Array.from(src.holder).map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch))
      .join('').split(' ').filter(Boolean).join(' ').slice(0, 60)
    : '';
  const devices = Math.round(Number(src.maxDevices));
  return {
    holder,
    expiresAt: validDate(src.expiresAt) ? src.expiresAt : '',
    maxDevices: Number.isFinite(devices) ? Math.min(MAX_DEVICES_LIMIT, Math.max(1, devices)) : MAX_DEVICES_LIMIT,
    lockBranding: src.lockBranding === true
  };
}

/** What the server enforces right now. */
function licenseStatus(license, now = Date.now()) {
  const lic = normalizeLicense(license);
  let expired = false;
  let daysLeft = null;
  if (lic.expiresAt) {
    const endOfDay = Date.parse(`${lic.expiresAt}T23:59:59.999`);
    expired = now > endOfDay;
    daysLeft = expired ? 0 : Math.ceil((endOfDay - now) / 86400000);
  }
  return { expired, daysLeft, maxDevices: lic.maxDevices, lockBranding: lic.lockBranding, holder: lic.holder, expiresAt: lic.expiresAt };
}

function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı.`;
  }
  if (password.length > 200) return 'Şifre çok uzun.';
  return null;
}

/** scrypt with a random salt, stored as "scrypt$<salt>$<hash>". */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (err) {
    return false;
  }
}

/** Local admin session: password login with lockout after repeated failures, sliding inactivity timeout. */
class AdminSession {
  constructor({ maxFailures = 5, lockMs = 60 * 1000, idleMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
    this.maxFailures = maxFailures;
    this.lockMs = lockMs;
    this.idleMs = idleMs;
    this.now = now;
    this.failures = 0;
    this.lockedUntil = 0;
    this.activeUntil = 0;
  }

  get active() {
    if (this.now() > this.activeUntil) return false;
    this.activeUntil = this.now() + this.idleMs; // sliding window while the admin keeps working
    return true;
  }

  /** @returns {{ok: boolean, error?: string}} */
  login(password, storedHash) {
    if (this.now() < this.lockedUntil) {
      return { ok: false, error: `Çok fazla hatalı deneme. ${Math.ceil((this.lockedUntil - this.now()) / 1000)} sn sonra tekrar deneyin.` };
    }
    if (verifyPassword(password, storedHash)) {
      this.failures = 0;
      this.activeUntil = this.now() + this.idleMs;
      return { ok: true };
    }
    this.failures += 1;
    if (this.failures >= this.maxFailures) {
      this.failures = 0;
      this.lockedUntil = this.now() + this.lockMs;
      return { ok: false, error: 'Çok fazla hatalı deneme. Bir süre bekleyin.' };
    }
    return { ok: false, error: 'Şifre hatalı.' };
  }

  start() {
    this.failures = 0;
    this.activeUntil = this.now() + this.idleMs;
  }

  logout() {
    this.activeUntil = 0;
  }
}

module.exports = {
  MAX_DEVICES_LIMIT,
  MIN_PASSWORD_LENGTH,
  defaultLicense,
  normalizeLicense,
  licenseStatus,
  passwordProblem,
  hashPassword,
  verifyPassword,
  AdminSession
};
