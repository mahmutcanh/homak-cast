// Renders index.html frame by frame (deterministic) and pipes JPEG frames into ffmpeg.
// Usage: electron.exe render-main.js <ffmpeg.exe> <out-silent.mp4> <events.json> [fps] [maxSeconds]
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const [ffmpegPath, outFile, eventsFile, fpsArg, maxArg] = process.argv.slice(2);
const FPS = Number(fpsArg) || 30;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1920, height: 1080, show: false, useContentSize: true, enableLargerThanScreen: true, resizable: false, webPreferences: { offscreen: true } });
  win.webContents.setFrameRate(60);
  win.setBounds({ x: 0, y: 0, width: 1920, height: 1080 });
  console.log('content size', win.getContentSize());
  await win.loadFile(path.join(__dirname, 'index.html'));
  await new Promise((r) => setTimeout(r, 500));
  const duration = await win.webContents.executeJavaScript('DURATION');
  fs.writeFileSync(eventsFile, JSON.stringify({ duration, events: await win.webContents.executeJavaScript('collectEvents()') }));

  const ff = spawn(ffmpegPath, ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', '-preset', 'medium', outFile], { stdio: ['pipe', 'ignore', 'inherit'] });

  const total = Math.min(Math.round(duration * FPS), maxArg ? Math.round(Number(maxArg) * FPS) : Infinity);
  for (let i = 0; i < total; i++) {
    await win.webContents.executeJavaScript(`render(${i / FPS})`);
    await new Promise((r) => setTimeout(r, 20));
    const img = await win.webContents.capturePage();
    const jpg = img.toJPEG(95);
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 90 === 0) console.log('frame', i, '/', total);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  app.quit();
});
