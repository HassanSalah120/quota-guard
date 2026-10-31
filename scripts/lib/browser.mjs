import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export const root = path.resolve(import.meta.dirname, '../..');
export const dataImage = file => `data:image/${path.extname(file) === '.svg' ? 'svg+xml' : 'png'};base64,${fs.readFileSync(file).toString('base64')}`;

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    };
    ws.onclose = () => {
      for (const pending of this.pending.values()) pending.reject(new Error('Browser connection closed'));
      this.pending.clear();
    };
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => {this.pending.delete(id); reject(new Error(`Timed out: ${method}`));}, 10000);
      this.pending.set(id, {
        resolve: value => {clearTimeout(timer); resolve(value);},
        reject: error => {clearTimeout(timer); reject(error);}
      });
      this.ws.send(JSON.stringify({id, method, params}));
    });
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Browser evaluation failed');
    return result.result?.value;
  }
  close() {this.ws.close();}
}

export async function waitFor(check, description) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await check()) return;
    await pause(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

export async function launch({extension = false} = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-assets-'));
  const browser = spawn(process.env.QG_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    ...(extension ? [`--disable-extensions-except=${root}`, `--load-extension=${root}`] : []), 'about:blank'
  ], {stdio: 'ignore'});
  let launchError;
  browser.on('error', error => {launchError = error;});
  const sessions = [];
  const portFile = path.join(profile, 'DevToolsActivePort');
  try {
    await waitFor(() => {if (launchError) throw launchError; return fs.existsSync(portFile);}, 'Chromium');
    const base = `http://127.0.0.1:${fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]}`;
    const targets = async () => (await fetch(`${base}/json`)).json();
    const connect = async target => {
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {ws.onopen = resolve; ws.onerror = reject;});
      const session = new Session(ws);
      sessions.push(session);
      return session;
    };
    const page = async () => connect(await (await fetch(`${base}/json/new?about:blank`, {method: 'PUT'})).json());
    return {targets, connect, page, async close() {
      for (const session of sessions) session.close();
      browser.kill();
      await pause(700);
      const resolved = path.resolve(profile);
      if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('qg-assets-')) throw new Error('Unsafe browser profile path');
      fs.rmSync(resolved, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
    }};
  } catch (error) {
    browser.kill();
    throw error;
  }
}

export async function screenshot(session, file, width, height, scale = 1) {
  await session.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: scale, mobile: false});
  await session.eval(`(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode()));})()`);
  const shot = await session.send('Page.captureScreenshot', {format: 'png', clip: {x: 0, y: 0, width, height, scale: 1}});
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
}

export async function render(session, html, file, width, height, {transparent = false} = {}) {
  await session.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
  await session.send('Emulation.setDefaultBackgroundColorOverride', {color: {r: 0, g: 0, b: 0, a: transparent ? 0 : 1}});
  await session.send('Page.navigate', {url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html)});
  await waitFor(() => session.eval("document.readyState==='complete'").catch(() => false), 'rendered document');
  await screenshot(session, file, width, height);
}
