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

// 1. Generate Master SVG Emblem (512x512)
const svgIcon = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <!-- Background Gradient -->
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0c201c"/>
      <stop offset="50%" stop-color="#061614"/>
      <stop offset="100%" stop-color="#030b0a"/>
    </linearGradient>

    <!-- Outer Frame Ring Gradient -->
    <linearGradient id="frameGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4ed3a6"/>
      <stop offset="50%" stop-color="#22d3ee"/>
      <stop offset="100%" stop-color="#0284c7"/>
    </linearGradient>

    <!-- Shield Border Gradient -->
    <linearGradient id="shieldBorder" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#5eead4"/>
      <stop offset="60%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#0284c7"/>
    </linearGradient>

    <!-- Shield Fill Gradient -->
    <linearGradient id="shieldFill" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#11332c"/>
      <stop offset="60%" stop-color="#0a211c"/>
      <stop offset="100%" stop-color="#04100e"/>
    </linearGradient>

    <!-- Lightning / Data Bolt Gradient -->
    <linearGradient id="boltGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a7f3d0"/>
      <stop offset="40%" stop-color="#4ed3a6"/>
      <stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>

    <!-- Neon Glow Filter -->
    <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="10" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>

    <!-- Subtle Drop Shadow -->
    <filter id="shadow" x="-15%" y="-15%" width="130%" height="130%">
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#000000" flood-opacity="0.6"/>
    </filter>
  </defs>

  <!-- Squircle Base Frame -->
  <rect x="20" y="20" width="472" height="472" rx="120" fill="url(#bgGrad)" stroke="url(#frameGrad)" stroke-width="8" filter="url(#shadow)"/>

  <!-- Radial Tech Accent Glow -->
  <circle cx="256" cy="240" r="160" fill="#4ed3a6" opacity="0.06"/>

  <!-- The Guard Shield -->
  <path d="M 256 78 
           C 335 78, 396 102, 400 134 
           C 406 250, 335 368, 256 438 
           C 177 368, 106 250, 112 134 
           C 116 102, 177 78, 256 78 Z"
        fill="url(#shieldFill)"
        stroke="url(#shieldBorder)"
        stroke-width="16"
        stroke-linejoin="round"
        filter="url(#neonGlow)"/>

  <!-- Shield Inner Contour Accent -->
  <path d="M 256 102 
           C 320 102, 370 122, 374 148 
           C 378 242, 320 340, 256 400 
           C 192 340, 134 242, 138 148 
           C 142 122, 192 102, 256 102 Z"
        fill="none"
        stroke="rgba(78, 211, 166, 0.25)"
        stroke-width="3"/>

  <!-- Telemetry Data Waves (Left & Right Saving Arcs) -->
  <path d="M 160 200 A 75 75 0 0 0 160 270" fill="none" stroke="#38bdf8" stroke-width="8" stroke-linecap="round" opacity="0.8"/>
  <path d="M 180 216 A 50 50 0 0 0 180 254" fill="none" stroke="#4ed3a6" stroke-width="6" stroke-linecap="round" opacity="0.9"/>

  <path d="M 352 200 A 75 75 0 0 1 352 270" fill="none" stroke="#38bdf8" stroke-width="8" stroke-linecap="round" opacity="0.8"/>
  <path d="M 332 216 A 50 50 0 0 1 332 254" fill="none" stroke="#4ed3a6" stroke-width="6" stroke-linecap="round" opacity="0.9"/>

  <!-- Dynamic Bandwidth Speed Bolt (Central Guard Energy) -->
  <polygon points="274,136 194,256 248,256 222,376 322,236 264,236"
           fill="url(#boltGrad)"
           filter="url(#neonGlow)"/>

  <!-- Modern Stylized 'Q' Tail Kick (Speed Arrow) -->
  <path d="M 295 355 L 358 418 M 358 418 L 328 418 M 358 418 L 358 388"
        fill="none"
        stroke="#4ed3a6"
        stroke-width="12"
        stroke-linecap="round"
        stroke-linejoin="round"/>
</svg>`;

// 2. Generate Horizontal Logo with Wordmark (800x200)
const svgLogo = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 200" width="800" height="200">
  <defs>
    <linearGradient id="logoBg" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#081816"/>
      <stop offset="100%" stop-color="#040d0c"/>
    </linearGradient>
    <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="55%" stop-color="#f1f5f9"/>
      <stop offset="56%" stop-color="#4ed3a6"/>
      <stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>
  </defs>

  <rect width="800" height="200" rx="24" fill="url(#logoBg)"/>

  <!-- Embedded Scaled Icon (x: 32, y: 24, w: 152, h: 152) -->
  <g transform="translate(32, 24) scale(0.296875)">
    ${svgIcon.replace(/<\?xml.*?\?>/, '').replace(/<svg.*?>/, '').replace(/<\/svg>/, '')}
  </g>

  <!-- Typography: Wordmark -->
  <text x="216" y="112" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="76" font-weight="900" letter-spacing="-1.5">
    <tspan fill="#ffffff">Quota</tspan><tspan fill="#4ed3a6">Guard</tspan>
  </text>

  <!-- Subtitle Tagline -->
  <text x="220" y="152" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="19" font-weight="700" fill="#7af8c3" letter-spacing="4">
    SMART VIDEO DATA SAVER &amp; RADIO MODE
  </text>
</svg>`;

// 3. Generate GitHub Social Preview Banner (1280x640)
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

  <!-- Left Side: Large 280x280 Emblem -->
  <g transform="translate(100, 180) scale(0.546875)">
    ${svgIcon.replace(/<\?xml.*?\?>/, '').replace(/<svg.*?>/, '').replace(/<\/svg>/, '')}
  </g>

  <!-- Right Side: Content & Badges -->
  <g transform="translate(430, 210)">
    <!-- Brand Title -->
    <text x="0" y="70" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="82" font-weight="900" letter-spacing="-2">
      <tspan fill="#ffffff">Quota</tspan><tspan fill="#4ed3a6">Guard</tspan>
    </text>

    <!-- Tagline -->
    <text x="4" y="118" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="24" font-weight="600" fill="#94a3b8">
      Smart Video Data Saver &amp; Radio Mode for Web Browsers
    </text>

    <!-- Feature Pills -->
    <g transform="translate(4, 160)">
      <!-- Pill 1: Platforms -->
      <rect x="0" y="0" width="300" height="44" rx="22" fill="#0d2b25" stroke="#22d3ee" stroke-width="1.5"/>
      <text x="150" y="28" font-family="system-ui, sans-serif" font-size="15" font-weight="700" fill="#5eead4" text-anchor="middle">
        YouTube • Facebook • X • TikTok
      </text>

      <!-- Pill 2: Data Savings -->
      <rect x="315" y="0" width="220" height="44" rx="22" fill="#0d2b25" stroke="#4ed3a6" stroke-width="1.5"/>
      <text x="425" y="28" font-family="system-ui, sans-serif" font-size="15" font-weight="700" fill="#4ed3a6" text-anchor="middle">
        ⚡ Up to ~95% Data Saved
      </text>
    </g>

    <!-- Secondary Line -->
    <text x="6" y="250" font-family="system-ui, sans-serif" font-size="15" font-weight="600" fill="#64748b" letter-spacing="1.5">
      PURE EXTENSION • ZERO LOGS • FIRST-PARTY HTML5 &amp; STREAM CONTROL
    </text>
  </g>
</svg>`;

// Write the SVG files exclusively to assets/branding/
fs.writeFileSync(path.join(BRANDING_DIR, 'quotaguard-icon.svg'), svgIcon, 'utf8');
fs.writeFileSync(path.join(BRANDING_DIR, 'quotaguard-logo.svg'), svgLogo, 'utf8');
fs.writeFileSync(path.join(BRANDING_DIR, 'quotaguard-banner.svg'), svgBanner, 'utf8');

console.log('✓ Master vector SVGs created in assets/branding and icons/');

// Render raster PNGs using Edge/Chromium
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

    // Helper to capture SVG at specific dimension
    async function captureSvg(svgContent, width, height, outputPath) {
      const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${width}px; height: ${height}px; background: transparent; overflow: hidden; }
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

    // Render extension icons
    console.log('Rendering high-DPI icons...');
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
        console.log(`  ✓ ${path.relative('.', destPath)} (${item.size}×${item.size})`);
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

renderPngs().then(() => console.log('\n🌟 Branding & icon asset generation completed successfully!')).catch(console.error);
