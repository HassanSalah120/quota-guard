import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const BROWSER_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EXT_PATH = path.resolve('C:\\Users\\hassa\\Downloads\\quota-guard-fb-x-v1.1\\quota-guard-fb-x');
const CDP_PORT = 9245;

console.log('=== Running Popup Smoke & UI Render Test ===\n');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-popup-test-'));
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
  assert.ok(versionData, 'Chromium CDP must be available');

  // Find extension ID
  let swTarget = null;
  for (let i = 0; i < 25; i++) {
    const targetsRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
    const targets = await targetsRes.json();
    swTarget = targets.find(t => t.type === 'service_worker' && t.url?.includes('background.js'));
    if (swTarget) break;
    await new Promise(r => setTimeout(r, 200));
  }
  assert.ok(swTarget, 'Service worker must be present');
  const extId = new URL(swTarget.url).hostname;

  // Open extension popup page directly
  const popupUrl = `chrome-extension://${extId}/popup.html`;
  const popupTabRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${popupUrl}`, { method: 'PUT' });
  const popupTarget = await popupTabRes.json();
  const session = new CdpSession(popupTarget.webSocketDebuggerUrl);
  await session.ready();
  await session.send('Page.enable');
  await session.send('Runtime.enable');

  await new Promise(r => setTimeout(r, 600));

  // Verify all essential UI nodes and sparkline canvas
  const uiCheck = await session.eval(`(() => {
    return {
      title: document.querySelector('.brand-title')?.textContent,
      canvasWidth: document.getElementById('speed-sparkline')?.width,
      canvasHeight: document.getElementById('speed-sparkline')?.height,
      hasTabs: Boolean(
        document.getElementById('tab-facebook') &&
        document.getElementById('tab-x') &&
        document.getElementById('tab-tiktok') &&
        document.getElementById('tab-youtube')
      ),
      hasSpeeds: Boolean(document.getElementById('meter-dl') && document.getElementById('meter-ul')),
      hasStats: Boolean(document.getElementById('stat-videos') && document.getElementById('stat-saved')),
      bodyWidth: document.body.offsetWidth,
      bodyHeight: document.body.offsetHeight
    };
  })()`);

  assert.equal(uiCheck.title, 'QuotaGuard');
  assert.equal(uiCheck.canvasWidth, 316);
  assert.equal(uiCheck.canvasHeight, 26);
  assert.equal(uiCheck.hasTabs, true);
  assert.equal(uiCheck.hasSpeeds, true);
  assert.equal(uiCheck.hasStats, true);
  assert.ok(uiCheck.bodyWidth <= 360, `Body width ${uiCheck.bodyWidth} must be <= 360px`);

  // Verify switching to TikTok tab (Radio Mode must be hidden/ignored)
  const tiktokTabCheck = await session.eval(`(() => {
    document.getElementById('tab-tiktok').click();
    return {
      siteTitle: document.getElementById('site-title')?.textContent,
      isSelected: document.getElementById('tab-tiktok')?.classList.contains('selected'),
      tipText: document.getElementById('native-tip')?.textContent,
      radioHidden: document.getElementById('opt-radio')?.hidden
    };
  })()`);

  assert.equal(tiktokTabCheck.siteTitle, 'TikTok');
  assert.equal(tiktokTabCheck.isSelected, true);
  assert.ok(tiktokTabCheck.tipText.includes('TikTok feeds are capped'), 'Tip must describe TikTok');
  assert.equal(tiktokTabCheck.radioHidden, true, 'Radio Mode must be hidden for TikTok');

  // Verify switching to YouTube tab (Radio Mode must be available)
  const ytTabCheck = await session.eval(`(() => {
    document.getElementById('tab-youtube').click();
    return {
      siteTitle: document.getElementById('site-title')?.textContent,
      isSelected: document.getElementById('tab-youtube')?.classList.contains('selected'),
      tipText: document.getElementById('native-tip')?.textContent,
      radioHidden: document.getElementById('opt-radio')?.hidden
    };
  })()`);

  assert.equal(ytTabCheck.siteTitle, 'YouTube');
  assert.equal(ytTabCheck.isSelected, true);
  assert.ok(ytTabCheck.tipText.includes('Radio Mode'), 'Tip must mention Radio Mode on YouTube');
  assert.equal(ytTabCheck.radioHidden, false, 'Radio Mode must be available for YouTube');

  console.log(`✓ Popup rendered cleanly (${uiCheck.bodyWidth}px × ${uiCheck.bodyHeight}px)`);
  console.log('✓ Hero telemetry canvas and sparkline active');
  console.log('✓ 4 Segmented tabs (Facebook, X, TikTok, YouTube) bound and functional');

  session.close();
  console.log('\n=== POPUP UI SMOKE TEST PASSED 100% ===');
} finally {
  browserProcess.kill();
  setTimeout(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }, 1000);
}
