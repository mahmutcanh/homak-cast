const { app, BrowserWindow, Tray, Menu, screen, ipcMain, nativeImage } = require('electron');
const path = require('path');
const SignalingServer = require('./server/signaling-server');
const { loadSettings, saveSettings, getNetworkAddresses } = require('./server/config');

let mainWindow = null;
let tray = null;
let signalingServer = null;
let settings = loadSettings();
let currentDisplayId = null;

// Hardware acceleration and WebRTC flags for 60fps performance
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-webrtc-pipewire-capturer');

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'Homak Cast Receiver',
    icon: path.join(__dirname, 'src', 'renderer', 'assets', 'icon.png'),
    backgroundColor: '#0a0e17',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false // Keep full 60fps even in background
    }
  });

  // Load the Receiver UI
  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  // Multi-monitor placement
  applyDisplaySetting();

  // Close to tray logic
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      if (tray) {
        tray.displayBalloon({
          iconType: 'info',
          title: 'Homak Cast',
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
    mainWindow.setBounds({
      x: bounds.x + Math.floor((bounds.width - 1280) / 2),
      y: bounds.y + Math.floor((bounds.height - 800) / 2),
      width: Math.min(1280, bounds.width),
      height: Math.min(800, bounds.height)
    });
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

  tray.setToolTip('Homak Cast Receiver — Kablosuz Ekran Alıcısı');

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
    mainWindow.setFullScreen(true);
  } else {
    mainWindow.setFullScreen(false);
    mainWindow.setBounds({
      x: target.bounds.x + 50,
      y: target.bounds.y + 50,
      width: Math.min(1280, target.bounds.width - 100),
      height: Math.min(800, target.bounds.height - 100)
    });
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
  settings = saveSettings(newSettings);
  return settings;
});

ipcMain.handle('get-network-addresses', () => {
  return getNetworkAddresses();
});

ipcMain.handle('toggle-auto-start', (event, enabled) => {
  app.setLoginItemSettings({ openAtLogin: enabled });
  settings.autoStartOnBoot = enabled;
  saveSettings({ autoStartOnBoot: enabled });
  updateTrayMenu();
  return enabled;
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
  // 1. Start embedded Signaling & Web Sender Server
  signalingServer = new SignalingServer({ port: settings.port || 5240 });
  try {
    await signalingServer.start();
  } catch (err) {
    console.error('Failed to start embedded signaling server:', err);
  }

  // 2. Create Window & Tray
  await createWindow();
  createTray();
  registerScreenEvents();

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
