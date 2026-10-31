import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const BROWSER_PATH = process.env.QG_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EXT_PATH = path.resolve(import.meta.dirname, '..');
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
    this.ws.onclose = () => {
      for (const {reject} of this.pending.values()) reject(new Error('Popup CDP connection closed'));
      this.pending.clear();
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
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timed out: ' + method)); }, 5000);
      this.pending.set(id, {resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); }});
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

  // Exercise the native toolbar popup; a regular tab misses intrinsic sizing bugs.
  const popupUrl = `chrome-extension://${extId}/popup.html`;
  const worker = new CdpSession(swTarget.webSocketDebuggerUrl);
  await worker.ready();
  await worker.eval('void chrome.action.openPopup().catch(console.warn); true');
  worker.close();
  let popupTarget;
  for (let i = 0; i < 40; i++) {
    const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
    popupTarget = targets.find(target => target.url === popupUrl);
    if (popupTarget) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(popupTarget, 'Native toolbar popup must open');
  const session = new CdpSession(popupTarget.webSocketDebuggerUrl);
  await session.ready();
  await session.send('Page.enable');
  await session.send('Runtime.enable');

  // The native target exists before CSS/deferred scripts finish loading.
  // Wait for the real ready state rather than sampling a partially built popup.
  let ready = false;
  for (let i = 0; i < 100; i++) {
    ready = await session.eval(`document.readyState === 'complete' &&
      document.styleSheets.length > 0 &&
      document.getElementById('site-status')?.textContent !== 'Checking' &&
      document.querySelector('[data-setting="enabled"]')?.disabled === false`).catch(() => false);
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(ready, true, 'Popup stylesheet, scripts, and settings must finish loading');
  await new Promise(resolve => setTimeout(resolve, 100));

  const uiCheck = await session.eval(`(() => ({
    title: document.querySelector('.brand-title').textContent,
    width: document.body.offsetWidth,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    height: document.body.offsetHeight,
    advancedOpen: document.getElementById('advanced-controls').open,
    status: document.getElementById('site-status').textContent,
    overflow: document.documentElement.scrollWidth > innerWidth
  }))()`);
  assert.equal(uiCheck.title, 'QuotaGuard');
  assert.ok(uiCheck.width >= 380 && uiCheck.width <= 420, `Native popup ${uiCheck.width}px must have a usable width`);
  assert.ok(uiCheck.viewportWidth >= uiCheck.width, 'The native frame must fit the popup');
  assert.ok(uiCheck.height <= 600, `Default popup ${uiCheck.height}px should fit Chrome’s popup height`);
  assert.equal(uiCheck.advancedOpen, false);
  assert.notEqual(uiCheck.status, 'Verified', 'No video is playing in the popup tab');
  assert.equal(uiCheck.overflow, false);
  assert.ok(uiCheck.height <= uiCheck.viewportHeight, `Default content ${uiCheck.height}px must fit native frame ${uiCheck.viewportHeight}px`);
  console.log(`✓ Native toolbar popup is ${uiCheck.width}×${uiCheck.height} in a ${uiCheck.viewportWidth}px frame`);

  const tikTok = await session.eval(`(() => {
    document.getElementById('tab-tiktok').click();
    return [...document.getElementById('quality').options].map(o => ({value:o.value, text:o.textContent}));
  })()`);
  assert.deepEqual(tikTok.map(o=>o.value), ['540','720','auto']);
  assert.ok(tikTok[1].text.includes('720p'));
  const youtube = await session.eval(`(() => {
    document.getElementById('tab-youtube').click();
    return {
      radio: !!document.querySelector('#quality option[value="audio"]'),
      disabled: ['stopAutoplay','preventPreload','pauseOffscreen'].every(key=>document.querySelector('[data-setting="'+key+'"]').disabled),
      noteVisible: !document.getElementById('capability-note').hidden
    };
  })()`);
  assert.equal(youtube.radio, true);
  assert.equal(youtube.disabled, true);
  assert.equal(youtube.noteVisible, true);
  console.log('✓ Per-site quality options and YouTube capability controls');
  await session.eval("document.getElementById('tab-youtube').focus()");
  await session.send('Input.dispatchKeyEvent', {type:'keyDown', key:'Home', code:'Home'});
  await session.send('Input.dispatchKeyEvent', {type:'keyUp', key:'Home', code:'Home'});
  assert.equal(await session.eval('document.activeElement.id'), 'tab-facebook');
  await session.send('Input.dispatchKeyEvent', {type:'keyDown', key:'ArrowRight', code:'ArrowRight'});
  await session.send('Input.dispatchKeyEvent', {type:'keyUp', key:'ArrowRight', code:'ArrowRight'});
  assert.equal(await session.eval('document.activeElement.id'), 'tab-x');
  assert.equal(await session.eval("document.getElementById('site-panel').getAttribute('aria-labelledby')"), 'tab-x');
  console.log('✓ Native popup keyboard tab navigation');

  // Exercise the real popup -> worker -> storage -> popup save path.
  await session.eval(`(() => {
    const input=document.querySelector('[data-setting="enabled"]');
    input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await new Promise(r=>setTimeout(r,250));
  const disabled = await session.eval(`(async()=>({
    stored:(await chrome.storage.local.get('settings')).settings.x.enabled,
    disabled:document.getElementById('regular-controls').disabled,
    status:document.getElementById('site-status').textContent,
    focusVisibleRule:[...document.styleSheets[0].cssRules].some(r=>r.selectorText?.includes('input:focus-visible'))
  }))()`);
  assert.equal(disabled.stored,false);
  assert.equal(disabled.disabled,true);
  assert.equal(disabled.status,'Off');
  assert.equal(disabled.focusVisibleRule,true);

  // Render the reported 720p / 240p state through the popup's status boundary.
  // This is a UI fixture, not a claim about an authenticated Facebook feed.
  await session.eval(`(()=>{
    window.popupReading={site:'facebook',enabled:true,strictBlock:false,requestedQuality:'240',actualResolution:720,state:'above',quality:'720p · Above target',mediaSize:null};
    chrome.tabs.query=async()=>[{id:1,url:'https://www.facebook.com/reel/ui-test'}];
    chrome.tabs.sendMessage=async()=>window.popupReading;
    document.getElementById('tab-facebook').click();
    const quality=document.getElementById('quality');quality.value='240';quality.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  for(let i=0;i<40;i++){
    if(await session.eval("document.getElementById('actual-quality').textContent==='720p'"))break;
    await new Promise(r=>setTimeout(r,50));
  }
  const reading=await session.eval(`({
    actual:document.getElementById('actual-quality').textContent,
    target:document.getElementById('target-quality').textContent,
    status:document.getElementById('site-status').textContent,
    size:document.getElementById('media-value').textContent,
    bodyHeight:document.body.offsetHeight,frameHeight:innerHeight,
    singleLine:getComputedStyle(document.getElementById('site-status')).whiteSpace,
    fits:[...document.querySelectorAll('.app-header,.site-tabs,.stream-state,.quality-control,footer')].every(e=>{const r=e.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth;})
  })`);
  assert.equal(reading.actual,'720p');assert.equal(reading.target,'240p');
  assert.equal(reading.status,'Above cap');assert.equal(reading.size,'Not reported');
  assert.equal(reading.singleLine,'nowrap');assert.equal(reading.fits,true);
  assert.ok(reading.bodyHeight<=reading.frameHeight,'Above-cap reading must fit the native popup without scrolling');
  console.log('✓ Native 720p / 240p reading fits; no wrapped status badge or explanatory wall of text');
  if(process.env.QG_SCREENSHOT_DIR){
    fs.mkdirSync(process.env.QG_SCREENSHOT_DIR,{recursive:true});
    await session.eval("document.activeElement.blur()");
    const shot=await session.send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(process.env.QG_SCREENSHOT_DIR,'quotaguard-popup.png'),Buffer.from(shot.data,'base64'));
  }
  console.log(`✓ Popup fits at ${uiCheck.width}×${uiCheck.height}, advanced controls collapsed`);
  console.log('✓ Accurate TikTok values, explicit YouTube capabilities, keyboard tabs, focus styles, persisted off switch');

  session.close();
  console.log('\n=== POPUP UI SMOKE TEST PASSED 100% ===');
} finally {
  browserProcess.kill();
  setTimeout(() => {
    try {
      const absolute = path.resolve(tempDir);
      if (absolute.startsWith(path.join(os.tmpdir(), 'qg-'))) fs.rmSync(absolute, {recursive: true, force: true});
    } catch (_) {}
  }, 1000);
}
