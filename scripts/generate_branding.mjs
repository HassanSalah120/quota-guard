import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BROWSER_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BRANDING_DIR = path.resolve('assets/branding');
const ICONS_DIR = path.resolve('icons');
const CDP_PORT = 9266;

fs.mkdirSync(BRANDING_DIR, { recursive: true });
fs.mkdirSync(ICONS_DIR, { recursive: true });

// 1. Master Free-Standing Shield Emblem (512x512) - 100% Transparent Canvas, No Outer Box/Frame
const svgIcon = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <!-- Outer Shield Border Gradient (Neon Emerald to Electric Cyan) -->
    <linearGradient id="shieldBorder" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4ed3a6"/>
      <stop offset="50%" stop-color="#22d3ee"/>
      <stop offset="100%" stop-color="#0ea5e9"/>
    </linearGradient>

    <!-- Shield Interior Fill Gradient (Deep Cyber Obsidian) -->
    <linearGradient id="shieldFill" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#0f2e27"/>
      <stop offset="50%" stop-color="#091c18"/>
      <stop offset="100%" stop-color="#040e0c"/>
    </linearGradient>

    <!-- Lightning / Data Bolt Gradient -->
    <linearGradient id="boltGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a7f3d0"/>
      <stop offset="45%" stop-color="#4ed3a6"/>
      <stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>

    <!-- Neon Glow Filter -->
    <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>

    <!-- Soft Ambient Drop Shadow -->
    <filter id="shieldShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#000000" flood-opacity="0.75"/>
    </filter>
  </defs>

  <!-- The Guard Shield (Hero Emblem) -->
  <path d="M 256 36 
           C 356 36, 444 68, 452 112 
           C 460 265, 368 405, 256 480 
           C 144 405, 52 265, 60 112 
           C 68 68, 156 36, 256 36 Z"
        fill="url(#shieldFill)"
        stroke="url(#shieldBorder)"
        stroke-width="22"
        stroke-linejoin="round"
        filter="url(#shieldShadow)"/>

  <!-- Inner Glowing Shield Rim -->
  <path d="M 256 68 
           C 336 68, 412 94, 418 132 
           C 424 252, 348 370, 256 438 
           C 164 370, 88 252, 94 132 
           C 100 94, 176 68, 256 68 Z"
        fill="none"
        stroke="rgba(78, 211, 166, 0.35)"
        stroke-width="4"/>

  <!-- Telemetry Data Waves (Left & Right Saving Arcs) -->
  <path d="M 125 190 A 90 90 0 0 0 125 285" fill="none" stroke="#38bdf8" stroke-width="12" stroke-linecap="round" opacity="0.85"/>
  <path d="M 152 210 A 60 60 0 0 0 152 265" fill="none" stroke="#4ed3a6" stroke-width="9" stroke-linecap="round" opacity="0.95"/>

  <path d="M 387 190 A 90 90 0 0 1 387 285" fill="none" stroke="#38bdf8" stroke-width="12" stroke-linecap="round" opacity="0.85"/>
  <path d="M 360 210 A 60 60 0 0 1 360 265" fill="none" stroke="#4ed3a6" stroke-width="9" stroke-linecap="round" opacity="0.95"/>

  <!-- Dynamic Bandwidth Speed Bolt (Central Guard Energy) -->
  <polygon points="278,110 182,252 248,252 216,402 336,226 266,226"
           fill="url(#boltGrad)"
           filter="url(#neonGlow)"/>

  <!-- Modern Stylized 'Q' Tail Kick (Speed Arrow) -->
  <path d="M 305 380 L 388 456 M 388 456 L 350 456 M 388 456 L 388 418"
        fill="none"
        stroke="#4ed3a6"
        stroke-width="16"
        stroke-linecap="round"
        stroke-linejoin="round"
        filter="url(#neonGlow)"/>
</svg>`;

// 2. Horizontal Logo with Wordmark (800x200)
const svgLogo = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 200" width="800" height="200">
  <defs>
    <linearGradient id="logoBg" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#081816"/>
      <stop offset="100%" stop-color="#040d0c"/>
    </linearGradient>
  </defs>

  <rect width="800" height="200" rx="24" fill="url(#logoBg)"/>

  <!-- Embedded Scaled Free-Standing Shield Icon (x: 28, y: 16, w: 168, h: 168) -->
  <g transform="translate(28, 16) scale(0.328125)">
    ${svgIcon.replace(/<\?xml.*?\?>/, '').replace(/<svg.*?>/, '').replace(/<\/svg>/, '')}
  </g>

  <!-- Typography: Wordmark -->
  <text x="220" y="112" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="76" font-weight="900" letter-spacing="-1.5">
    <tspan fill="#ffffff">Quota</tspan><tspan fill="#4ed3a6">Guard</tspan>
  </text>

  <!-- Subtitle Tagline -->
  <text x="224" y="152" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="19" font-weight="700" fill="#7af8c3" letter-spacing="4">
    SMART VIDEO DATA SAVER &amp; RADIO MODE
  </text>
</svg>`;

// 3. GitHub Social Preview Banner (1280x640)
const svgBanner = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 640" width="1280" height="640">
  <defs>
    <linearGradient id="bannerBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0a1d1a"/>
      <stop offset="50%" stop-color="#041210"/>
      <stop offset="100%" stop-color="#020807"/>
    </linearGradient>
    <radialGradient id="centerGlow" cx="50%" cy="40%" r="50%">
      <stop offset="0%" stop-color="rgba(78, 211, 166, 0.18)"/>
      <stop offset="100%" stop-color="rgba(78, 211, 166, 0.0)"/>
    </radialGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(78, 211, 166, 0.04)" stroke-width="1"/>
    </pattern>
  </defs>

  <rect width="1280" height="640" fill="url(#bannerBg)"/>
  <rect width="1280" height="640" fill="url(#grid)"/>
  <rect width="1280" height="640" fill="url(#centerGlow)"/>

  <!-- Left Side: Large Free-Standing Shield Emblem -->
  <g transform="translate(100, 160) scale(0.625)">
    ${svgIcon.replace(/<\?xml.*?\?>/, '').replace(/<svg.*?>/, '').replace(/<\/svg>/, '')}
  </g>

  <!-- Right Side: Content & Badges -->
  <g transform="translate(460, 210)">
    <text x="0" y="70" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="82" font-weight="900" letter-spacing="-2">
      <tspan fill="#ffffff">Quota</tspan><tspan fill="#4ed3a6">Guard</tspan>
    </text>

    <text x="4" y="118" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="24" font-weight="600" fill="#94a3b8">
      Smart Video Data Saver &amp; Radio Mode for Web Browsers
    </text>

    <g transform="translate(4, 160)">
      <rect x="0" y="0" width="300" height="44" rx="22" fill="#0d2b25" stroke="#22d3ee" stroke-width="1.5"/>
      <text x="150" y="28" font-family="system-ui, sans-serif" font-size="15" font-weight="700" fill="#5eead4" text-anchor="middle">
        YouTube • Facebook • X • TikTok
      </text>

      <rect x="315" y="0" width="220" height="44" rx="22" fill="#0d2b25" stroke="#4ed3a6" stroke-width="1.5"/>
      <text x="425" y="28" font-family="system-ui, sans-serif" font-size="15" font-weight="700" fill="#4ed3a6" text-anchor="middle">
        ⚡ Up to ~95% Data Saved
      </text>
    </g>

    <text x="6" y="250" font-family="system-ui, sans-serif" font-size="15" font-weight="600" fill="#64748b" letter-spacing="1.5">
      PURE EXTENSION • ZERO LOGS • FIRST-PARTY HTML5 &amp; STREAM CONTROL
    </text>
  </g>
</svg>`;

// Write master SVGs exclusively to assets/branding/
fs.writeFileSync(path.join(BRANDING_DIR, 'quotaguard-icon.svg'), svgIcon, 'utf8');
fs.writeFileSync(path.join(BRANDING_DIR, 'quotaguard-logo.svg'), svgLogo, 'utf8');
fs.writeFileSync(path.join(BRANDING_DIR, 'quotaguard-banner.svg'), svgBanner, 'utf8');

console.log('✓ Master vector SVGs created in assets/branding/');

// Render raster PNGs with TRUE ALPHA TRANSPARENCY (RGBA colorType: 6, ZERO white frame)
const tempHtml = path.resolve('temp_render.html');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-branding-'));

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

async function renderPngs() {
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
    if (!pageTarget) throw new Error('Could not find browser page target');

    const session = new CdpSession(pageTarget.webSocketDebuggerUrl);
    await session.ready();
    await session.send('Page.enable');

    // CRITICAL: Force transparent background on Chromium rendering pipeline
    await session.send('Emulation.setDefaultBackgroundColorOverride', {
      color: { r: 0, g: 0, b: 0, a: 0 }
    });

    // Helper to capture SVG at specific dimension with true RGBA transparency
    async function captureSvg(svgContent, width, height, outputPath) {
      const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${width}px; height: ${height}px; background: transparent !important; overflow: hidden; }
    svg { width: 100%; height: 100%; display: block; }
  </style>
</head>
<body>
  ${svgContent}
</body>
</html>`;
      fs.writeFileSync(tempHtml, html, 'utf8');
      const fileUrl = 'file:///' + tempHtml.replace(/\\/g, '/');

      await session.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false
      });
      await session.send('Page.navigate', { url: fileUrl });
      await new Promise(r => setTimeout(r, 150));

      const screenshot = await session.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        clip: { x: 0, y: 0, width, height, scale: 1 }
      });

      fs.writeFileSync(outputPath, Buffer.from(screenshot.data, 'base64'));
    }

    // Render pure transparent extension PNG icons
    console.log('Rendering 100% transparent RGBA icons...');
    const sizes = [
      { size: 16, dest: [path.join(ICONS_DIR, 'icon16.png'), path.join(BRANDING_DIR, 'icon-16.png')] },
      { size: 32, dest: [path.join(ICONS_DIR, 'icon32.png'), path.join(BRANDING_DIR, 'icon-32.png')] },
      { size: 48, dest: [path.join(ICONS_DIR, 'icon48.png'), path.join(BRANDING_DIR, 'icon-48.png')] },
      { size: 128, dest: [path.join(ICONS_DIR, 'icon128.png'), path.join(BRANDING_DIR, 'icon-128.png')] },
      { size: 256, dest: [path.join(BRANDING_DIR, 'icon-256.png')] },
      { size: 512, dest: [path.join(BRANDING_DIR, 'icon-512.png')] }
    ];

    for (const item of sizes) {
      for (const destPath of item.dest) {
        await captureSvg(svgIcon, item.size, item.size, destPath);
        console.log(`  ✓ ${path.relative('.', destPath)} (${item.size}×${item.size} RGBA)`);
      }
    }

    // Render Logo and Banner
    console.log('Rendering logos & banners...');
    await captureSvg(svgLogo, 800, 200, path.join(BRANDING_DIR, 'quotaguard-logo.png'));
    console.log('  ✓ assets/branding/quotaguard-logo.png (800×200)');

    await captureSvg(svgBanner, 1280, 640, path.join(BRANDING_DIR, 'quotaguard-banner.png'));
    console.log('  ✓ assets/branding/quotaguard-banner.png (1280×640)');

    session.close();
  } finally {
    browserProcess.kill();
    try { fs.unlinkSync(tempHtml); } catch (_) {}
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
}

renderPngs().then(() => console.log('\n🌟 100% Transparent branding & icon asset generation completed successfully!')).catch(console.error);
