import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BROWSER_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EXT_PATH = path.resolve('.');
const CDP_PORT = 9265;
const ASSETS_DIR = path.resolve('assets/screenshots');

fs.mkdirSync(ASSETS_DIR, { recursive: true });

console.log('Capturing high-resolution screenshots for GitHub README...\n');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-capture-'));
const browserProcess = spawn(BROWSER_PATH, [
  '--headless=new',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${tempDir}`,
  `--disable-extensions-except=${EXT_PATH}`,
  `--load-extension=${EXT_PATH}`,
  '--ignore-certificate-errors',
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank'
]);

class CdpSession {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
  }
  async ready() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || 'Eval error');
    return res.result?.value;
  }
  close() { this.ws.close(); }
}

try {
  let versionData = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (res.ok) { versionData = await res.json(); break; }
    } catch (_) {}
  }

  // Find extension ID
  let swTarget = null;
  for (let i = 0; i < 25; i++) {
    const targetsRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
    const targets = await targetsRes.json();
    swTarget = targets.find(t => t.type === 'service_worker' && t.url?.includes('background.js'));
    if (swTarget) break;
    await new Promise(r => setTimeout(r, 200));
  }
  const extId = new URL(swTarget.url).hostname;

  // Open extension popup page
  const popupUrl = `chrome-extension://${extId}/popup.html`;
  const popupTabRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${popupUrl}`, { method: 'PUT' });
  const popupTarget = await popupTabRes.json();
  const session = new CdpSession(popupTarget.webSocketDebuggerUrl);
  await session.ready();
  await session.send('Page.enable');
  await session.send('Runtime.enable');

  // Set device metric emulation for clean crisp high DPI screenshot
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: 370,
    height: 560,
    deviceScaleFactor: 2,
    mobile: false
  });

  await new Promise(r => setTimeout(r, 400));

  // Populate mock data for a vibrant screenshot
  await session.eval(`(() => {
    document.getElementById('meter-dl').textContent = '245.8 KB/s';
    document.getElementById('meter-ul').textContent = '38.4 KB/s';
    document.getElementById('stat-videos').textContent = '24';
    document.getElementById('stat-autoplays').textContent = '11';
    document.getElementById('stat-saved').textContent = '~184 MB';

    // Draw a rich sample sparkline on canvas
    const canvas = document.getElementById('speed-sparkline');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const points = [15, 30, 45, 20, 80, 140, 110, 190, 240, 210, 160, 180, 220, 260, 230, 245];
      const maxVal = 280;
      const step = w / (points.length - 1);

      ctx.beginPath();
      points.forEach((val, idx) => {
        const x = idx * step;
        const y = h - 3 - (val / maxVal) * (h - 6);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = '#4ed3a6';
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.stroke();

      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(78, 211, 166, 0.4)');
      grad.addColorStop(1, 'rgba(78, 211, 166, 0.0)');
      ctx.fillStyle = grad;
      ctx.fill();
    }
  })()`);

  await new Promise(r => setTimeout(r, 200));

  // Screenshot 1: Facebook dashboard
  const snap1 = await session.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 350, height: 535, scale: 2 } });
  fs.writeFileSync(path.join(ASSETS_DIR, 'popup-dashboard.png'), Buffer.from(snap1.data, 'base64'));
  console.log('✓ Captured assets/screenshots/popup-dashboard.png');

  // Screenshot 2: YouTube tab with Radio Mode
  await session.eval(`(() => {
    document.getElementById('tab-youtube').click();
    document.getElementById('quality').value = 'audio';
    const verifier = document.getElementById('quality-verification');
    if (verifier) verifier.textContent = 'Stream status: Radio mode (sound only) applied';
  })()`);
  await new Promise(r => setTimeout(r, 200));

  const snap2 = await session.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 350, height: 535, scale: 2 } });
  fs.writeFileSync(path.join(ASSETS_DIR, 'popup-radio-mode.png'), Buffer.from(snap2.data, 'base64'));
  console.log('✓ Captured assets/screenshots/popup-radio-mode.png');

  // Screenshot 3: Video Player with Persistent Pill Badge
  const videoMockHtml = `<!DOCTYPE html>
  <html>
  <head>
    <link rel="stylesheet" href="content.css">
    <style>
      body { background: #0b0f19; display: grid; place-items: center; min-height: 100vh; margin: 0; font-family: system-ui, sans-serif; }
      .mock-player {
        position: relative; width: 640px; height: 360px; background: #000; border-radius: 12px;
        overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.6); border: 1px solid #1f2937;
      }
      .mock-content {
        width: 100%; height: 100%; background: linear-gradient(135deg, #111827 0%, #030712 100%);
        display: flex; flex-direction: column; align-items: center; justify-content: center; color: #9ca3af;
      }
      .play-icon { font-size: 48px; color: #4ed3a6; margin-bottom: 8px; opacity: 0.9; }
      .player-bar {
        position: absolute; bottom: 0; left: 0; right: 0; height: 40px;
        background: rgba(0,0,0,0.75); display: flex; align-items: center; padding: 0 16px; gap: 12px;
      }
      .progress { flex: 1; height: 4px; background: #374151; border-radius: 2px; position: relative; }
      .progress-fill { width: 35%; height: 100%; background: #4ed3a6; border-radius: 2px; }
    </style>
  </head>
  <body>
    <div class="mock-player">
      <div class="mock-content">
        <div class="play-icon">▶</div>
        <div style="font-size: 14px; font-weight: 600; color: #ecfdf5;">4K Nature Stream (Capped to 360p Data Saver)</div>
      </div>
      <div class="player-bar">
        <span style="color:#4ed3a6; font-size:14px;">❚❚</span>
        <div class="progress"><div class="progress-fill"></div></div>
        <span style="color:#9ca3af; font-size:11px; font-family:monospace;">01:42 / 04:50</span>
      </div>
      <div class="qg-pill-badge" style="display:block;">⚡ QuotaGuard: 360p Saved</div>
    </div>
  </body>
  </html>`;

  const videoPageTab = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?chrome-extension://${extId}/popup.html`, { method: 'PUT' });
  const videoTarget = await videoPageTab.json();
  const videoSession = new CdpSession(videoTarget.webSocketDebuggerUrl);
  await videoSession.ready();
  await videoSession.send('Page.enable');
  await videoSession.send('Runtime.enable');
  await videoSession.send('Page.setDocumentContent', {
    frameId: (await videoSession.send('Page.getFrameTree')).frameTree.frame.id,
    html: videoMockHtml
  });
  await videoSession.send('Emulation.setDeviceMetricsOverride', {
    width: 720,
    height: 440,
    deviceScaleFactor: 2,
    mobile: false
  });
  await new Promise(r => setTimeout(r, 400));

  const snap3 = await videoSession.send('Page.captureScreenshot', { format: 'png', clip: { x: 40, y: 40, width: 640, height: 360, scale: 2 } });
  fs.writeFileSync(path.join(ASSETS_DIR, 'on-video-pill.png'), Buffer.from(snap3.data, 'base64'));
  console.log('✓ Captured assets/screenshots/on-video-pill.png');
  videoSession.close();

  session.close();
} catch (err) {
  console.error('Screenshot error:', err);
} finally {
  browserProcess.kill();
  setTimeout(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }, 1000);
}
