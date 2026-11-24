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
// Written by the Windows installer: the ports (and optional domain) the admin picked during setup.
const INSTALL_FILE = process.env.ProgramData
  ? path.join(process.env.ProgramData, 'HomakCast', 'install.ini')
  : null;
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/** Values chosen in the installer (port, httpsPort, lanDomain); invalid or missing entries are left out. */
function readInstallConfig(file = INSTALL_FILE, settingsFile = SETTINGS_FILE) {
  const out = {};
  try {
    if (!file || !fs.existsSync(file)) return out;
    // Whichever was changed last wins: re-running setup, or editing the ports in the settings screen.
    if (fs.existsSync(settingsFile) && fs.statSync(settingsFile).mtimeMs > fs.statSync(file).mtimeMs) return out;
    const values = {};
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(\w+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) values[m[1].toLowerCase()] = m[2];
    }
    const validPort = (v) => /^\d{1,5}$/.test(v || '') && Number(v) >= 1 && Number(v) <= 65535;
    if (validPort(values.httpport)) out.port = Number(values.httpport);
    if (validPort(values.httpsport)) out.httpsPort = Number(values.httpsport);
    if (out.port && out.port === out.httpsPort) delete out.httpsPort;
    if (values.domain && HOSTNAME_RE.test(values.domain)) out.lanDomain = values.domain.toLowerCase();
  } catch (e) {
    console.error('Error reading install config:', e);
  }
  return out;
}
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
  port: 80, // plain http; the installer lets the admin pick another port (falls back to 5240 if busy)
  httpsPort: 443, // LAN HTTPS (self-signed) so phones get a secure context for screen capture (falls back to 5241)
  mirrorAllDisplays: false, // show the same stream full screen on every other monitor too
  lanDomain: '', // optional name for this PC on the LAN; shown instead of the IP and added to the certificate
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
      // Installer choices win over the saved file unless the settings screen was used after setup.
      const loaded = { ...defaultConfig, ...data, ...readInstallConfig() };
      loaded.license = normalizeLicense(loaded.license);
      return loaded;
    }
  } catch (err) {
    console.error('Error reading settings file:', err);
  }
  return { ...defaultConfig, ...readInstallConfig() };
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

const VIRTUAL_INTERFACE_PATTERN = /vethernet|vmware|virtualbox|vbox|hyper-v|docker|wsl|tailscale|zerotier|loopback|bluetooth|veth|^br-|lxd|virbr|vpn|tap-|tun/i;

function getNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal/loopback and non-IPv4
      if (iface.family === 'IPv4' && !iface.internal) {
        const isLocal = iface.address.startsWith('192.168.') || iface.address.startsWith('10.') || iface.address.startsWith('172.');
        addresses.push({
          interface: name,
          address: iface.address,
          isLocal,
          // isLan = a real network card (Ethernet / Wi-Fi) on a private range, not a VM/VPN/container adapter
          isLan: isLocal && !VIRTUAL_INTERFACE_PATTERN.test(name)
        });
      }
    }
  }

  // Sort preferred: real LAN cards first, then other private addresses, then the rest
  const rank = (a) => (a.isLan ? 2 : a.isLocal ? 1 : 0);
  addresses.sort((a, b) => rank(b) - rank(a));
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
  readInstallConfig,
  getNetworkAddresses
};
