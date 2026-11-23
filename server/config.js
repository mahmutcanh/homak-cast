const path = require('path');
const fs = require('fs');
const os = require('os');

const APPDATA_DIR = process.env.APPDATA 
  ? path.join(process.env.APPDATA, 'HomakCast')
  : path.join(os.homedir(), '.homakcast');

if (!fs.existsSync(APPDATA_DIR)) {
  try {
    fs.mkdirSync(APPDATA_DIR, { recursive: true });
  } catch (e) {
    console.error('Failed to create appdata dir:', e);
  }
}

const SETTINGS_FILE = path.join(APPDATA_DIR, 'settings.json');
const { defaultLicense, normalizeLicense } = require('./license');

const DEFAULT_COMPANY_NAME = 'Cast';

/** Trimmed, single-line, max 60 chars; falls back to the default brand when empty. */
function normalizeCompanyName(value) {
  const text = typeof value === 'string'
    ? Array.from(value).map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch)).join('').split(' ').filter(Boolean).join(' ')
    : '';
  return text.slice(0, 60) || DEFAULT_COMPANY_NAME;
}

const defaultConfig = {
  adminPasswordHash: '', // scrypt hash of the local admin password; empty = not set yet
  license: { ...defaultLicense }, // holder / expiry / device limit / branding lock (edited in the admin screen)
  companyName: DEFAULT_COMPANY_NAME, // shown in window title, tray and UI header (set in receiver settings)
  port: 5240,
  httpsPort: 5241, // LAN HTTPS (self-signed) so phones get a secure context for screen capture
  signalingServerUrl: '', // empty = built-in default relay
  deviceName: 'Cast Receiver',
  preferredMode: 'lan', // 'lan' = this PC is the server (default), 'cloud' = cast.homaklab.com
  requireApproval: false, // Default: no approval needed (connects immediately), can be enabled in settings
  showHeaderInFullscreen: false, // Default: clean immersive fullscreen video without header
  autoStartOnBoot: true, // Auto-start with Windows on boot
  targetDisplayId: null, // null = primary display
  audioOutputId: 'default',
  defaultFps: 60,
  adaptiveBitrate: true,
  maxBitrateKbps: 8000,
  stunServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.services.mozilla.com' }
  ],
  turnServers: []
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      const loaded = { ...defaultConfig, ...data };
      loaded.license = normalizeLicense(loaded.license);
      return loaded;
    }
  } catch (err) {
    console.error('Error reading settings file:', err);
  }
  return { ...defaultConfig };
}

function saveSettings(newSettings) {
  try {
    const merged = { ...loadSettings(), ...newSettings };
    merged.companyName = normalizeCompanyName(merged.companyName);
    merged.license = normalizeLicense(merged.license);
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
  } catch (err) {
    console.error('Error saving settings:', err);
    return null;
  }
}

function getNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal/loopback and non-IPv4
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({
          interface: name,
          address: iface.address,
          isLocal: iface.address.startsWith('192.168.') || iface.address.startsWith('10.') || iface.address.startsWith('172.')
        });
      }
    }
  }

  // Sort preferred: local LAN first, then others
  addresses.sort((a, b) => (b.isLocal ? 1 : 0) - (a.isLocal ? 1 : 0));
  return addresses;
}

module.exports = {
  APPDATA_DIR,
  SETTINGS_FILE,
  defaultConfig,
  DEFAULT_COMPANY_NAME,
  normalizeCompanyName,
  loadSettings,
  saveSettings,
  getNetworkAddresses
};
