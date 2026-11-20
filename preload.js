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
  toggleAutoStart: (enabled) => ipcRenderer.invoke('toggle-auto-start', enabled),
  
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
  }
});
