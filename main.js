const { app, BrowserWindow, Tray, Menu, screen, ipcMain, nativeImage, session, desktopCapturer, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const SignalingServer = require('./server/signaling-server');
const { loadSettings, saveSettings, getNetworkAddresses, normalizeCompanyName } = require('./server/config');

let mainWindow = null;
let tray = null;
let signalingServer = null;
let settings = loadSettings();

function companyName() {
  return normalizeCompanyName(settings.companyName);
}
function windowTitle() {
  return companyName() + ' — Cast Receiver';
}
function trayTooltip() {
  return companyName() + ' Cast Receiver — Kablosuz Ekran Alıcısı';
}
let currentDisplayId = null;

// Hardware acceleration and WebRTC flags for 60fps performance without black screens
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');

async function createWindow() {
  // Remove default File, Edit, View, Window menus permanently
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: windowTitle(),
    icon: path.join(__dirname, 'src', 'renderer', 'assets', 'icon.png'),
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    fullscreen: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false // Keep full 60fps even in background
    }
  });

  // Never let the renderer open new windows or navigate away from the local UI.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  mainWindow.removeMenu();
  mainWindow.setMenu(null);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setFullScreen(true);

  // Load the Receiver UI
  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  mainWindow.webContents.on('console-message', (e, level, msg, line, src) => {
    console.log(`[Renderer Log] ${msg}`);
  });

  // Multi-monitor placement
  applyDisplaySetting();

  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('fullscreen-changed', true);
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('fullscreen-changed', false);
  });

  // Close to tray logic
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      if (tray) {
        tray.displayBalloon({
          iconType: 'info',
          title: companyName() + ' Cast',
          content: 'Uygulama sistem tepsisinde arka planda çalışıyor. Yayın almaya hazır.'
        });
      }
    }
  });
}

function applyDisplaySetting() {
  const displays = screen.getAllDisplays();
  let targetDisplay = null;

  if (settings.targetDisplayId) {
    targetDisplay = displays.find(d => d.id === settings.targetDisplayId);
  }

  if (!targetDisplay) {
    targetDisplay = screen.getPrimaryDisplay();
  }

  currentDisplayId = targetDisplay.id;

  if (mainWindow) {
    const bounds = targetDisplay.bounds;
    mainWindow.setBounds(bounds);
    mainWindow.setFullScreen(true);
  }
}

function getFormattedDisplays() {
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;

  return displays.map((disp, index) => {
    const isPrimary = disp.id === primaryId;
    const isCurrent = disp.id === currentDisplayId;
    let label = `Ekran ${index + 1} (${disp.bounds.width}x${disp.bounds.height})`;
    if (isPrimary) label += ' [Birincil]';
    if (index > 0 && !isPrimary) label += ' (Harici / Projeksiyon)';

    return {
      id: disp.id,
      index: index + 1,
      label,
      bounds: disp.bounds,
      isPrimary,
      isCurrent
    };
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'src', 'renderer', 'assets', 'icon.png');
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);

  tray.setToolTip(trayTooltip());

  updateTrayMenu();

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;

  const displays = getFormattedDisplays();
  const displayMenuItems = displays.map(disp => ({
    label: disp.label,
    type: 'radio',
    checked: disp.isCurrent,
    click: () => {
      moveToDisplay(disp.id, false);
    }
  }));

  const autoStart = app.getLoginItemSettings().openAtLogin;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '📺 Receiver\'ı Aç',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: '🖥️ Ekran / Projeksiyon Seç',
      submenu: displayMenuItems
    },
    {
      label: '⚙️ Sunucu ve Yayın Ayarları',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.webContents.send('open-settings-modal');
        }
      }
    },
    {
      label: '⏹ Yayını Durdur',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('trigger-stop-stream');
        }
        if (signalingServer) {
          signalingServer.terminateStream('Tepsiden yayın durduruldu.');
        }
      }
    },
    {
      label: '🔄 Yeni Kod Üret',
      click: () => {
        if (signalingServer) {
          signalingServer.generateNewPin();
        }
      }
    },
    { type: 'separator' },
    {
      label: '🚀 Windows ile Otomatik Başlat',
      type: 'checkbox',
      checked: autoStart,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
        settings.autoStartOnBoot = item.checked;
        saveSettings({ autoStartOnBoot: item.checked });
      }
    },
    { type: 'separator' },
    {
      label: '❌ Çıkış',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

function moveToDisplay(displayId, fullscreen = false) {
  const displays = screen.getAllDisplays();
  const target = displays.find(d => d.id === displayId);
  if (!target || !mainWindow) return;

  currentDisplayId = displayId;
  settings.targetDisplayId = displayId;
  saveSettings({ targetDisplayId: displayId });

  if (fullscreen) {
    mainWindow.setFullScreen(false);
    mainWindow.setBounds(target.bounds);
    mainWindow.removeMenu();
    mainWindow.setMenuBarVisibility(false);
    mainWindow.setFullScreen(true);
  } else {
    mainWindow.setFullScreen(false);
    mainWindow.setBounds({
      x: target.bounds.x + 50,
      y: target.bounds.y + 50,
      width: Math.min(1280, target.bounds.width - 100),
      height: Math.min(800, target.bounds.height - 100)
    });
    mainWindow.removeMenu();
    mainWindow.setMenuBarVisibility(false);
  }

  updateTrayMenu();
  mainWindow.webContents.send('displays-updated', getFormattedDisplays());
}

// IPC Handlers
ipcMain.handle('get-displays', () => {
  return getFormattedDisplays();
});

ipcMain.handle('set-display', (event, { displayId, fullscreen }) => {
  moveToDisplay(displayId, fullscreen);
  return { ok: true, currentDisplayId };
});

ipcMain.handle('toggle-fullscreen', () => {
  if (mainWindow) {
    const isFull = mainWindow.isFullScreen();
    mainWindow.setFullScreen(!isFull);
    return !isFull;
  }
  return false;
});

ipcMain.handle('is-fullscreen', () => {
  return mainWindow ? mainWindow.isFullScreen() : false;
});

ipcMain.handle('minimize-window', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('hide-to-tray', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.handle('quit-app', () => {
  app.isQuitting = true;
  app.quit();
});

ipcMain.handle('get-settings', () => {
  return loadSettings();
});

ipcMain.handle('save-settings', (event, newSettings) => {
  const saved = saveSettings(newSettings);
  if (saved) {
    settings = saved;
    if (mainWindow) mainWindow.setTitle(windowTitle());
    if (tray) tray.setToolTip(trayTooltip());
  }
  return settings;
});

ipcMain.handle('get-network-addresses', () => {
  return getNetworkAddresses();
});

ipcMain.handle('get-screen-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
  return sources.map(s => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL()
  }));
});

ipcMain.handle('toggle-auto-start', (event, enabled) => {
  app.setLoginItemSettings({ openAtLogin: enabled });
  settings.autoStartOnBoot = enabled;
  saveSettings({ autoStartOnBoot: enabled });
  updateTrayMenu();
  return enabled;
});

ipcMain.handle('save-recording', async (event, { buffer, filename }) => {
  try {
    const videosDir = path.join(app.getPath('videos'), 'HomakCast_Recordings');
    if (!fs.existsSync(videosDir)) {
      fs.mkdirSync(videosDir, { recursive: true });
    }
    if (!buffer || typeof buffer !== 'object' || !(buffer.byteLength > 0)) {
      return { ok: false, error: 'Geçersiz kayıt verisi.' };
    }
    // Strip any directory components and force a .webm extension (no path traversal / executables).
    const base = path.basename(String(filename || '')).replace(/[^\w.-]/g, '_').replace(/\.[^.]*$/, '');
    const safeFilename = `${base || 'HomakCast_' + Date.now()}.webm`;
    const fullPath = path.join(videosDir, safeFilename);
    if (path.dirname(fullPath) !== videosDir) {
      return { ok: false, error: 'Geçersiz dosya adı.' };
    }
    fs.writeFileSync(fullPath, Buffer.from(buffer));
    console.log('[Recording] File saved successfully:', fullPath);
    return { ok: true, filePath: fullPath };
  } catch (err) {
    console.error('Failed to save recording:', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('open-recordings-folder', async () => {
  const videosDir = path.join(app.getPath('videos'), 'HomakCast_Recordings');
  if (!fs.existsSync(videosDir)) {
    fs.mkdirSync(videosDir, { recursive: true });
  }
  shell.openPath(videosDir);
  return { ok: true };
});

// Screen display events
function registerScreenEvents() {
  const onScreenChange = () => {
    console.log('[HomakCast] Display configuration changed.');
    updateTrayMenu();
    if (mainWindow) {
      mainWindow.webContents.send('displays-updated', getFormattedDisplays());
    }
  };

  screen.on('display-added', onScreenChange);
  screen.on('display-removed', onScreenChange);
  screen.on('display-metrics-changed', onScreenChange);
}

// App lifecycle
app.whenReady().then(async () => {
  // Configure display media handler for screen casting
  if (session.defaultSession.setDisplayMediaRequestHandler) {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      // Only our own local UI may capture the screen; deny anything else.
      const frameUrl = request.frame && request.frame.url ? request.frame.url : '';
      if (!frameUrl.startsWith('file://')) {
        callback({});
        return;
      }
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        if (sources.length > 0) {
          callback({ video: sources[0], audio: 'loopback' });
        } else {
          callback({});
        }
      }).catch(err => {
        console.error('Display media request error:', err);
        callback({});
      });
    });
  }

  // 1. Start embedded Signaling & Web Sender Server
  signalingServer = new SignalingServer({ port: settings.port || 5240, httpsPort: settings.httpsPort || 5241 });
  try {
    await signalingServer.start();
  } catch (err) {
    console.error('Failed to start embedded signaling server:', err);
  }

  // 2. Create Window & Tray
  await createWindow();
  createTray();
  registerScreenEvents();

  // 3. Register auto-start on Windows boot
  if (settings.autoStartOnBoot !== false) {
    try {
      app.setLoginItemSettings({
        openAtLogin: true,
        path: process.execPath
      });
    } catch (e) {
      console.warn('Could not register login item:', e);
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('before-quit', async () => {
  app.isQuitting = true;
  if (signalingServer) {
    await signalingServer.stop();
  }
});

app.on('window-all-closed', () => {
  // Keep app running in background tray unless explicitly quit
  if (process.platform !== 'darwin' && app.isQuitting) {
    app.quit();
  }
});
