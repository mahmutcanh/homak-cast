const { contextBridge, ipcRenderer } = require('electron');

// Preload for the mirror windows (extra monitors): they only receive video from the main receiver window.
contextBridge.exposeInMainWorld('mirrorAPI', {
  ready: () => ipcRenderer.send('mirror-ready'),
  send: (msg) => ipcRenderer.send('mirror-to-main', msg),
  onSignal: (callback) => {
    const handler = (event, msg) => callback(msg);
    ipcRenderer.on('mirror-signal', handler);
    return () => ipcRenderer.removeListener('mirror-signal', handler);
  }
});
