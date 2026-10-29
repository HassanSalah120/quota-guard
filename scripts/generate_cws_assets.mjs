import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BROWSER_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CWS_DIR = path.resolve('assets/cws');
const CDP_PORT = 9268;

fs.mkdirSync(CWS_DIR, { recursive: true });

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-cws-'));
const tempHtml = path.resolve('temp_cws.html');

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
  close() { this.ws.close(); }
}

async function run() {
  const browserProcess = spawn(BROWSER_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${tempDir}`,
    '--ignore-certificate-errors',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ]);

  try {
    let pageTarget = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      try {
        const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
        if (res.ok) {
          const targets = await res.json();
          pageTarget = targets.find(t => t.type === 'page');
          if (pageTarget) break;
        }
      } catch (_) {}
    }
    if (!pageTarget) throw new Error('Could not find browser target');

    const session = new CdpSession(pageTarget.webSocketDebuggerUrl);
    await session.ready();
    await session.send('Page.enable');

    async function capturePage(html, width, height, outputPath) {
      fs.writeFileSync(tempHtml, html, 'utf8');
      const fileUrl = 'file:///' + tempHtml.replace(/\\/g, '/');
      await session.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false
      });
      await session.send('Page.navigate', { url: fileUrl });
      await new Promise(r => setTimeout(r, 300));
      const snap = await session.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width, height, scale: 1 }
      });
      fs.writeFileSync(outputPath, Buffer.from(snap.data, 'base64'));
      console.log(`✓ Generated ${path.relative('.', outputPath)} (${width}x${height})`);
    }

    const popupDashImg = fs.readFileSync('assets/screenshots/popup-dashboard.png').toString('base64');
    const popupRadioImg = fs.readFileSync('assets/screenshots/popup-radio-mode.png').toString('base64');
    const onVideoImg = fs.readFileSync('assets/screenshots/on-video-pill.png').toString('base64');
    const shieldSvg = fs.readFileSync('assets/branding/quotaguard-icon.svg', 'utf8');

    // 1. Screenshot 1: Dashboard Overview (1280x800)
    const html1 = `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width: 1280px; height: 800px;
    background: radial-gradient(circle at 75% 30%, #0d2822 0%, #05100e 60%, #020706 100%);
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    color: #ecfdf5; display: flex; align-items: center; justify-content: space-between;
    padding: 60px 80px; overflow: hidden;
  }
  .left-col { max-width: 540px; }
  .badge {
    display: inline-flex; align-items: center; gap: 8px;
    background: rgba(78, 211, 166, 0.12); border: 1px solid rgba(78, 211, 166, 0.4);
    color: #4ed3a6; font-size: 14px; font-weight: 700; padding: 6px 14px; border-radius: 999px;
    margin-bottom: 24px;
  }
  h1 { font-size: 46px; font-weight: 900; line-height: 1.15; margin-bottom: 18px; letter-spacing: -1px; }
  h1 span { color: #4ed3a6; }
  p { font-size: 19px; line-height: 1.5; color: #94a3b8; margin-bottom: 32px; }
  .features { display: flex; flex-direction: column; gap: 14px; }
  .feat-item { display: flex; align-items: center; gap: 12px; font-size: 16px; font-weight: 600; color: #cbd5e1; }
  .feat-dot { width: 10px; height: 10px; border-radius: 50%; background: #4ed3a6; box-shadow: 0 0 8px #4ed3a6; }
  .right-col {
    position: relative; display: flex; align-items: center; justify-content: center;
  }
  .glow-back {
    position: absolute; width: 440px; height: 600px;
    background: radial-gradient(circle, rgba(78, 211, 166, 0.25) 0%, transparent 70%);
    filter: blur(40px); z-index: 1;
  }
  .popup-frame {
    position: relative; z-index: 2; width: 350px; height: 535px;
    border-radius: 16px; overflow: hidden;
    box-shadow: 0 25px 60px rgba(0,0,0,0.85), 0 0 0 1px rgba(78, 211, 166, 0.35);
  }
  .popup-frame img { width: 100%; height: 100%; object-fit: cover; display: block; }
</style>
</head>
<body>
  <div class="left-col">
    <div class="badge">⚡ Bandwidth Optimizer for Web Video</div>
    <h1>Cut Video Data By Up To <span>90%</span></h1>
    <p>QuotaGuard locks streams to clean data-saver resolutions (360p/240p) and prevents auto-play churn before megabytes are wasted.</p>
    <div class="features">
      <div class="feat-item"><div class="feat-dot"></div> Native HLS, MPEG-DASH & InnerTube interception</div>
      <div class="feat-item"><div class="feat-dot"></div> Live browser-wide download & upload speed monitor</div>
      <div class="feat-item"><div class="feat-dot"></div> Zero account logins, zero tokens, 100% privacy</div>
    </div>
  </div>
  <div class="right-col">
    <div class="glow-back"></div>
    <div class="popup-frame">
      <img src="data:image/png;base64,${popupDashImg}">
    </div>
  </div>
</body>
</html>`;
    await capturePage(html1, 1280, 800, path.join(CWS_DIR, 'screenshot-1-dashboard-1280x800.png'));

    // 2. Screenshot 2: Radio Mode (1280x800)
    const html2 = `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width: 1280px; height: 800px;
    background: radial-gradient(circle at 25% 40%, #08202b 0%, #040f14 60%, #010609 100%);
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    color: #ecfdf5; display: flex; align-items: center; justify-content: space-between;
    padding: 60px 80px; overflow: hidden;
  }
  .left-col {
    position: relative; display: flex; align-items: center; justify-content: center;
  }
  .glow-back {
    position: absolute; width: 440px; height: 600px;
    background: radial-gradient(circle, rgba(56, 189, 248, 0.25) 0%, transparent 70%);
    filter: blur(40px); z-index: 1;
  }
  .popup-frame {
    position: relative; z-index: 2; width: 350px; height: 535px;
    border-radius: 16px; overflow: hidden;
    box-shadow: 0 25px 60px rgba(0,0,0,0.85), 0 0 0 1px rgba(56, 189, 248, 0.4);
  }
  .popup-frame img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .right-col { max-width: 540px; }
  .badge {
    display: inline-flex; align-items: center; gap: 8px;
    background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.4);
    color: #38bdf8; font-size: 14px; font-weight: 700; padding: 6px 14px; border-radius: 999px;
    margin-bottom: 24px;
  }
  h1 { font-size: 46px; font-weight: 900; line-height: 1.15; margin-bottom: 18px; letter-spacing: -1px; }
  h1 span { color: #38bdf8; }
  p { font-size: 19px; line-height: 1.5; color: #94a3b8; margin-bottom: 32px; }
  .features { display: flex; flex-direction: column; gap: 14px; }
  .feat-item { display: flex; align-items: center; gap: 12px; font-size: 16px; font-weight: 600; color: #cbd5e1; }
  .feat-dot { width: 10px; height: 10px; border-radius: 50%; background: #38bdf8; box-shadow: 0 0 8px #38bdf8; }
</style>
</head>
<body>
  <div class="left-col">
    <div class="glow-back"></div>
    <div class="popup-frame">
      <img src="data:image/png;base64,${popupRadioImg}">
    </div>
  </div>
  <div class="right-col">
    <div class="badge">📻 Background Audio Listening</div>
    <h1>Radio Mode: Stream <span>Sound Only</span></h1>
    <p>Listen to podcasts, live commentary, music, and debates on YouTube and Facebook without streaming high-bandwidth video pixels.</p>
    <div class="features">
      <div class="feat-item"><div class="feat-dot"></div> ~95% bandwidth reduction compared to standard video</div>
      <div class="feat-item"><div class="feat-dot"></div> Keeps video element and controls visible and interactive</div>
      <div class="feat-item"><div class="feat-dot"></div> Works smoothly with screen dimming and multi-tasking</div>
    </div>
  </div>
</body>
</html>`;
    await capturePage(html2, 1280, 800, path.join(CWS_DIR, 'screenshot-2-radio-mode-1280x800.png'));

    // 3. Screenshot 3: Video Player with Quality Pill (1280x800)
    const html3 = `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width: 1280px; height: 800px;
    background: radial-gradient(circle at 50% 30%, #0d2822 0%, #05100e 60%, #020706 100%);
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    color: #ecfdf5; display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 40px; overflow: hidden; text-align: center;
  }
  .badge {
    display: inline-flex; align-items: center; gap: 8px;
    background: rgba(78, 211, 166, 0.12); border: 1px solid rgba(78, 211, 166, 0.4);
    color: #4ed3a6; font-size: 14px; font-weight: 700; padding: 6px 14px; border-radius: 999px;
    margin-bottom: 16px;
  }
  h1 { font-size: 40px; font-weight: 900; line-height: 1.15; margin-bottom: 12px; }
  h1 span { color: #4ed3a6; }
  p { font-size: 17px; color: #94a3b8; max-width: 650px; margin-bottom: 28px; }
  .player-box {
    width: 760px; height: 420px; border-radius: 16px; overflow: hidden;
    box-shadow: 0 25px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(78, 211, 166, 0.35);
  }
  .player-box img { width: 100%; height: 100%; object-fit: cover; display: block; }
</style>
</head>
<body>
  <div class="badge">🎯 Transparent Feedback</div>
  <h1>Real-Time <span>On-Video Verification</span></h1>
  <p>QuotaGuard places a discreet status pill directly on video players showing current stream caps and instant single-click audio toggle.</p>
  <div class="player-box">
    <img src="data:image/png;base64,${onVideoImg}">
  </div>
</body>
</html>`;
    await capturePage(html3, 1280, 800, path.join(CWS_DIR, 'screenshot-3-player-pill-1280x800.png'));

    // 4. Small Promo Tile (440x280)
    const htmlPromo = `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width: 440px; height: 280px;
    background: linear-gradient(135deg, #091e1a 0%, #05100e 50%, #020706 100%);
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    color: #ecfdf5; display: flex; flex-direction: column; align-items: center; justify-content: center;
    position: relative; overflow: hidden; text-align: center; padding: 20px;
  }
  .glow {
    position: absolute; width: 260px; height: 260px;
    background: radial-gradient(circle, rgba(78, 211, 166, 0.3) 0%, transparent 70%);
    filter: blur(30px); z-index: 1;
  }
  .content { position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; }
  .shield-icon { width: 68px; height: 68px; margin-bottom: 12px; filter: drop-shadow(0 0 16px rgba(78, 211, 166, 0.5)); }
  h2 { font-size: 26px; font-weight: 900; letter-spacing: -0.5px; margin-bottom: 4px; }
  h2 span { color: #4ed3a6; }
  p { font-size: 13px; font-weight: 600; color: #94a3b8; margin-bottom: 12px; }
  .tags { display: flex; gap: 8px; }
  .tag {
    font-size: 11px; font-weight: 700; color: #4ed3a6; background: rgba(78, 211, 166, 0.12);
    border: 1px solid rgba(78, 211, 166, 0.3); padding: 3px 8px; border-radius: 999px;
  }
</style>
</head>
<body>
  <div class="glow"></div>
  <div class="content">
    <div class="shield-icon">${shieldSvg}</div>
    <h2>Quota<span>Guard</span></h2>
    <p>Smart Video Data Saver &amp; Radio Mode</p>
    <div class="tags">
      <div class="tag">Save Up To 90%</div>
      <div class="tag">YouTube • FB • X • TikTok</div>
    </div>
  </div>
</body>
</html>`;
    await capturePage(htmlPromo, 440, 280, path.join(CWS_DIR, 'promo-tile-small-440x280.png'));

    // 5. Marquee Banner (1400x560)
    const htmlMarquee = `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width: 1400px; height: 560px;
    background: linear-gradient(135deg, #071916 0%, #030d0b 50%, #010504 100%);
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    color: #ecfdf5; display: flex; align-items: center; justify-content: space-between;
    padding: 0 100px; position: relative; overflow: hidden;
  }
  .glow {
    position: absolute; width: 600px; height: 600px; right: 120px;
    background: radial-gradient(circle, rgba(78, 211, 166, 0.22) 0%, transparent 70%);
    filter: blur(50px); z-index: 1;
  }
  .left { position: relative; z-index: 2; max-width: 650px; }
  .badge {
    display: inline-flex; align-items: center; gap: 8px;
    background: rgba(78, 211, 166, 0.12); border: 1px solid rgba(78, 211, 166, 0.4);
    color: #4ed3a6; font-size: 14px; font-weight: 700; padding: 6px 14px; border-radius: 999px;
    margin-bottom: 20px;
  }
  h1 { font-size: 54px; font-weight: 900; line-height: 1.1; margin-bottom: 16px; letter-spacing: -1.5px; }
  h1 span { color: #4ed3a6; }
  p { font-size: 20px; line-height: 1.5; color: #94a3b8; margin-bottom: 24px; }
  .right { position: relative; z-index: 2; }
  .shield-icon { width: 220px; height: 220px; filter: drop-shadow(0 0 32px rgba(78, 211, 166, 0.45)); }
</style>
</head>
<body>
  <div class="glow"></div>
  <div class="left">
    <div class="badge">⚡ Chrome Web Store Official</div>
    <h1>Quota<span>Guard</span> Data Saver</h1>
    <p>Stream smarter on metered, mobile, and roaming plans with instant stream resolution locks, autoplay prevention, and background Radio Mode.</p>
  </div>
  <div class="right">
    <div class="shield-icon">${shieldSvg}</div>
  </div>
</body>
</html>`;
    await capturePage(htmlMarquee, 1400, 560, path.join(CWS_DIR, 'marquee-banner-1400x560.png'));

    session.close();
  } finally {
    browserProcess.kill();
    try { fs.unlinkSync(tempHtml); } catch (_) {}
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
}

run().then(() => console.log('\n🌟 Chrome Web Store promotional & screenshot assets generated successfully!')).catch(console.error);
