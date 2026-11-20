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

const defaultConfig = {
  port: 5240,
  signalingServerUrl: 'https://cast.homaklab.com',
  deviceName: 'Homak Cast Receiver',
  requireApproval: true,
  autoStartOnBoot: false,
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
      return { ...defaultConfig, ...data };
    }
  } catch (err) {
    console.error('Error reading settings file:', err);
  }
  return { ...defaultConfig };
}

function saveSettings(newSettings) {
  try {
    const merged = { ...loadSettings(), ...newSettings };
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
  loadSettings,
  saveSettings,
  getNetworkAddresses
};
