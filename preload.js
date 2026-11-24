const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  setDisplay: (displayId, fullscreen = false) => ipcRenderer.invoke('set-display', { displayId, fullscreen }),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('is-fullscreen'),
  minimize: () => ipcRenderer.invoke('minimize-window'),
  hideToTray: () => ipcRenderer.invoke('hide-to-tray'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getNetworkAddresses: () => ipcRenderer.invoke('get-network-addresses'),
  adminStatus: () => ipcRenderer.invoke('admin-status'),
  adminSetPassword: (password) => ipcRenderer.invoke('admin-set-password', { password }),
  adminLogin: (password) => ipcRenderer.invoke('admin-login', { password }),
  adminLogout: () => ipcRenderer.invoke('admin-logout'),
  adminSaveLicense: (license, newPassword) => ipcRenderer.invoke('admin-save-license', { license, newPassword }),
  getLogo: () => ipcRenderer.invoke('get-logo'),
  pickLogo: () => ipcRenderer.invoke('pick-logo'),
  clearLogo: () => ipcRenderer.invoke('clear-logo'),
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  toggleAutoStart: (enabled) => ipcRenderer.invoke('toggle-auto-start', enabled),
  saveRecording: (data) => ipcRenderer.invoke('save-recording', data),
  openRecordingsFolder: () => ipcRenderer.invoke('open-recordings-folder'),
  mirrorActive: (active) => ipcRenderer.send('mirror-active', !!active),
  mirrorSend: (mirrorId, msg) => ipcRenderer.send('mirror-to-mirror', { mirrorId, msg }),
  
  // Event listeners
  onDisplaysUpdated: (callback) => {
    const handler = (event, displays) => callback(displays);
    ipcRenderer.on('displays-updated', handler);
    return () => ipcRenderer.removeListener('displays-updated', handler);
  },
  onTriggerStopStream: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('trigger-stop-stream', handler);
    return () => ipcRenderer.removeListener('trigger-stop-stream', handler);
  },
  onOpenSettingsModal: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('open-settings-modal', handler);
    return () => ipcRenderer.removeListener('open-settings-modal', handler);
  },
  onMirrorReady: (callback) => {
    const handler = (event, mirrorId) => callback(mirrorId);
    ipcRenderer.on('mirror-ready', handler);
    return () => ipcRenderer.removeListener('mirror-ready', handler);
  },
  onMirrorGone: (callback) => {
    const handler = (event, mirrorId) => callback(mirrorId);
    ipcRenderer.on('mirror-gone', handler);
    return () => ipcRenderer.removeListener('mirror-gone', handler);
  },
  onMirrorSignal: (callback) => {
    const handler = (event, payload) => callback(payload);
    ipcRenderer.on('mirror-signal', handler);
    return () => ipcRenderer.removeListener('mirror-signal', handler);
  },
  onFullscreenChanged: (callback) => {
    const handler = (event, isFull) => callback(isFull);
    ipcRenderer.on('fullscreen-changed', handler);
    return () => ipcRenderer.removeListener('fullscreen-changed', handler);
  }
});
