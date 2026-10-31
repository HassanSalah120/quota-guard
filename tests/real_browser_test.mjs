import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const BROWSER_PATH = process.env.QG_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EXT_PATH = path.resolve(import.meta.dirname, '..');
const CDP_PORT = 9232;

console.log('=== Starting QuotaGuard Real Chromium Integration Tests ===\n');

const sampleHls = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=256000,RESOLUTION=180x320,CODECS="avc1"
/pu/pl/180x320.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=360x640,CODECS="avc1"
/pu/pl/360x640.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=720x1280,CODECS="avc1"
/pu/pl/720x1280.m3u8
`;

const sampleMpd = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
  <Period>
    <AdaptationSet mimeType="video/mp4" contentType="video">
      <Representation id="v180" width="320" height="180" bandwidth="200000">
        <BaseURL>180.mp4</BaseURL>
      </Representation>
      <Representation id="v360" width="640" height="360" bandwidth="600000">
        <BaseURL>360.mp4</BaseURL>
      </Representation>
      <Representation id="v720" width="1280" height="720" bandwidth="2500000">
        <BaseURL>720.mp4</BaseURL>
      </Representation>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" contentType="audio">
      <Representation id="a1" bandwidth="64000"><BaseURL>audio.mp4</BaseURL></Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

const pageHtml = `<!DOCTYPE html>
<html>
<head><title>Test Feed</title></head>
<body>
  <div data-testid="videoPlayer" id="player-container">
    <video id="test-video" width="640" height="360"></video>
    <button data-testid="playButton" id="play-btn">Play</button>
  </div>
</body>
</html>`;

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-real-test-'));
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
      if (msg.method === 'Fetch.requestPaused') {
        this.handleFetch(msg.params);
        return;
      }
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

  async eval(expression, awaitPromise = true) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || 'Eval error');
    }
    return res.result?.value;
  }

  handleFetch(params) {
    const requestId = params.requestId;
    const url = params.request.url;

    let body = pageHtml;
    let contentType = 'text/html';

    if (url.includes('/test-size.webm') && this.mediaFixture) {
      body = this.mediaFixture;
      contentType = 'video/webm';
    } else if (url.includes('.m3u8')) {
      body = sampleHls;
      contentType = 'application/vnd.apple.mpegurl';
    } else if (url.includes('/api/graphql')) {
      body = JSON.stringify({
        data: {
          video: {
            id: 'test_vid_123',
            dash_manifest: sampleMpd
          }
        }
      });
      contentType = 'application/json';
    } else if (url.includes('/api/recommend/item_list') || url.includes('/api/item_list')) {
      body = JSON.stringify({
        statusCode: 0,
        itemList: [
          {
            id: 'tt_mock_001',
            video: {
              playAddr: 'https://v16-webapp-prime.tiktok.com/video/1080p.mp4',
              bitrateInfo: [
                {
                  GearName: 'normal_360_0',
                  Bitrate: 350000,
                  PlayAddr: { UrlList: ['https://v16-webapp-prime.tiktok.com/video/360p.mp4'] }
                },
                {
                  GearName: 'normal_1080_0',
                  Bitrate: 2200000,
                  PlayAddr: { UrlList: ['https://v16-webapp-prime.tiktok.com/video/1080p.mp4'] }
                }
              ]
            }
          }
        ]
      });
      contentType = 'application/json';
    } else if (url.includes('/youtubei/v1/player')) {
      body = JSON.stringify({
        responseContext: {},
        streamingData: {
          formats: [
            { itag: 18, width: 640, height: 360, qualityLabel: '360p' },
            { itag: 22, width: 1280, height: 720, qualityLabel: '720p' }
          ],
          adaptiveFormats: [
            { itag: 134, width: 640, height: 360, qualityLabel: '360p', mimeType: 'video/mp4; codecs="avc1.4d401e"' },
            { itag: 137, width: 1920, height: 1080, qualityLabel: '1080p', mimeType: 'video/mp4; codecs="avc1.640028"' },
            { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', audioQuality: 'AUDIO_QUALITY_MEDIUM' }
          ]
        }
      });
      contentType = 'application/json';
    }

    const encodedBody = Buffer.from(body).toString('base64');
    this.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: [
        { name: 'Content-Type', value: contentType },
        { name: 'Content-Length', value: String(Buffer.byteLength(body)) },
        { name: 'Access-Control-Allow-Origin', value: '*' }
      ],
      body: encodedBody
    }).catch(console.error);
  }

  close() {
    this.ws.close();
  }
}

try {
  // Wait for Browser CDP
  let versionData = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (res.ok) { versionData = await res.json(); break; }
    } catch (_) {}
  }
  assert.ok(versionData, 'Chromium CDP must be available');
  console.log(`✓ Chromium connected (${versionData.Browser})`);

  // Verify Service Worker
  let swTarget = null;
  for (let i = 0; i < 25; i++) {
    const targetsRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
    const targets = await targetsRes.json();
    swTarget = targets.find(t => t.type === 'service_worker' && t.url?.includes('background.js'));
    if (swTarget) break;
    await new Promise(r => setTimeout(r, 200));
  }
  assert.ok(swTarget, 'QuotaGuard background service worker must be loaded and running');
  console.log('✓ TEST 1: Service Worker registered and active in MV3');

  // Open a test tab for x.com
  const newTabRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?https://x.com/test_video`, { method: 'PUT' });
  const tabTarget = await newTabRes.json();
  const session = new CdpSession(tabTarget.webSocketDebuggerUrl);
  await session.ready();
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  await session.send('Fetch.enable', {
    patterns: [{ urlPattern: '*', requestStage: 'Request' }]
  });

  // Reload page to let Fetch interceptor serve pageHtml
  await session.send('Page.reload');

  // Wait for scripts to settle
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 100));
    const isReady = await session.eval('document.readyState === "complete" && window.__qgStreamHook === true').catch(() => false);
    if (isReady) break;
  }

  // TEST 2: Content scripts injected
  const isHooked = await session.eval('window.__qgStreamHook === true');
  const isPatched = await session.eval('window.__quotaGuardPatched === true');
  assert.equal(isHooked, true, 'Stream hook must be active in MAIN world');
  assert.equal(isPatched, true, 'Main guard must be active in MAIN world');
  console.log('✓ TEST 2: Page scripts (MAIN world) successfully injected on x.com');

  // TEST 3: Intercept X HLS Master Playlist
  const hlsResult = await session.eval(`(async () => {
    const res = await fetch('https://video.twimg.com/ext_tw_video/test.m3u8');
    const text = await res.text();
    return {
      status: res.status,
      body: text,
      applied: document.documentElement.getAttribute('data-qg-quality-applied')
    };
  })()`);

  assert.equal(hlsResult.status, 200);
  assert.ok(hlsResult.body.includes('/pu/pl/360x640.m3u8'), 'Must include 360p stream');
  assert.ok(!hlsResult.body.includes('/pu/pl/720x1280.m3u8'), 'Must STRIP 720p stream');
  assert.equal(hlsResult.applied, '360p HLS cap applied');
  console.log('✓ TEST 3: Real HLS master playlist intercepted & capped to 360p on x.com');

  // TEST 4: Autoplay Blocking
  const autoplayBlocked = await session.eval(`(async () => {
    const v = document.getElementById('test-video');
    let blocked = false;
    let errorName = '';
    try {
      await v.play();
    } catch (err) {
      if (err.message?.includes('QuotaGuard')) {
        blocked = true;
        errorName = err.name;
      }
    }
    return { blocked, name: errorName };
  })()`);

  assert.equal(autoplayBlocked.blocked, true, 'Unsolicited play() must be blocked by QuotaGuard');
  assert.equal(autoplayBlocked.name, 'NotAllowedError');
  console.log('✓ TEST 4: Programmatic autoplay blocked with NotAllowedError');

  // TEST 5: User Gesture Unblocking
  const btnBox = await session.eval(`(() => {
    const r = document.getElementById('play-btn').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);

  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: btnBox.x,
    y: btnBox.y,
    button: 'left',
    clickCount: 1
  });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: btnBox.x,
    y: btnBox.y,
    button: 'left',
    clickCount: 1
  });

  await new Promise(r => setTimeout(r, 100));

  const clickUnblock = await session.eval(`(() => {
    const video = document.getElementById('test-video');
    const manualFlag = video.getAttribute('data-qg-manual-play');
    let quotaGuardRefused = false;
    video.play().catch(err => {
      if (err.message?.includes('QuotaGuard')) quotaGuardRefused = true;
    });
    return { manualFlag, quotaGuardRefused };
  })()`);

  assert.equal(clickUnblock.manualFlag, 'yes', 'User click on player container must set manual-play=yes');
  assert.equal(clickUnblock.quotaGuardRefused, false, 'play() must NOT be refused by QuotaGuard after user click');
  console.log('✓ TEST 5: User click immediately authorizes video without breaking native play buttons');

  // TEST 6: Facebook DASH GraphQL Interception
  await session.send('Page.navigate', { url: 'https://www.facebook.com/watch/?v=123' });
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 100));
    const isReady = await session.eval('document.readyState === "complete" && window.__qgStreamHook === true').catch(() => false);
    if (isReady) break;
  }

  const dashResult = await session.eval(`(async () => {
    const res = await fetch('https://www.facebook.com/api/graphql');
    const json = await res.json();
    return {
      manifest: json.data.video.dash_manifest,
      applied: document.documentElement.getAttribute('data-qg-quality-applied')
    };
  })()`);

  assert.ok(dashResult.manifest.includes('id="v360"'), 'Must include 360p representation in parsed json');
  assert.ok(!dashResult.manifest.includes('id="v720"'), 'Must STRIP 720p representation from parsed json');
  assert.ok(dashResult.manifest.includes('id="a1"'), 'Must preserve audio representation');
  assert.equal(dashResult.applied, '360p DASH cap applied');
  console.log('✓ TEST 6: Facebook GraphQL DASH manifest intercepted via response.json() & capped to 360p');

  // TEST 7: DOMParser manifest interception in MAIN world
  const domParserResult = await session.eval(`(() => {
    const rawXml = \`<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
      <Period>
        <AdaptationSet contentType="video">
          <Representation id="sd_rep" width="640" height="360" bandwidth="500000"><BaseURL>sd.mp4</BaseURL></Representation>
          <Representation id="hd_rep" width="1280" height="720" bandwidth="2500000"><BaseURL>hd.mp4</BaseURL></Representation>
        </AdaptationSet>
      </Period>
    </MPD>\`;
    const doc = new DOMParser().parseFromString(rawXml, 'application/xml');
    const reps = [...doc.querySelectorAll('Representation')].map(r => r.getAttribute('id'));
    return { reps };
  })()`);

  assert.deepEqual(domParserResult.reps, ['sd_rep'], 'DOMParser must filter out 720p representation');
  console.log('✓ TEST 7: DOMParser.prototype.parseFromString intercepts & caps DASH manifests');

  // TEST 8: Persistent Pill Badge on Video
  const pillResult = await session.eval(`(() => {
    const video = document.getElementById('test-video');
    video.click(); // Sets activeVideo in content script
    document.dispatchEvent(new CustomEvent('qg-cap-applied', {
      detail: { quality: '720', fallbackLowest: true }
    }));
    const badge = video.parentElement.querySelector('.qg-pill-badge');
    return {
      exists: Boolean(badge),
      text: badge?.textContent || ''
    };
  })()`);

  assert.equal(pillResult.exists, true, 'Pill badge must be rendered in parent');
  assert.ok(pillResult.text.includes('720p'), 'Pill text must include resolution');
  console.log('✓ TEST 8: On-video pill badge persists on video container');

  // TEST 9: Real autoplay events reach the serialized activity writer.
  await new Promise(r => setTimeout(r, 300));
  const swSession = new CdpSession(swTarget.webSocketDebuggerUrl);
  await swSession.ready();
  let activity;
  for (let i = 0; i < 40; i++) {
    activity = await swSession.eval("chrome.storage.local.get('activity')");
    if (activity.activity?.x?.autoplaysBlocked === 1) break;
    await new Promise(r => setTimeout(r, 50));
  }
  assert.equal(activity.activity?.x?.autoplaysBlocked, 1, 'One blocked video must be counted once');
  console.log('✓ TEST 9: Blocked-video activity recorded without fabricated MB savings');

  // TEST 10: TikTok Feed API Interception & XGPlayer Bitrate Reduction
  await session.send('Page.navigate', { url: 'https://www.tiktok.com/foryou' });
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 100));
    const isReady = await session.eval('document.readyState === "complete" && window.__qgStreamHook === true').catch(() => false);
    if (isReady) break;
  }

  const tiktokResult = await session.eval(`(async () => {
    const res = await fetch('https://www.tiktok.com/api/recommend/item_list');
    const json = await res.json();
    return {
      itemCount: json.itemList?.length || 0,
      bitrates: json.itemList[0]?.video?.bitrateInfo?.map(b => b.GearName) || [],
      playAddr: json.itemList[0]?.video?.playAddr || '',
      applied: document.documentElement.getAttribute('data-qg-quality-applied')
    };
  })()`);

  assert.equal(tiktokResult.itemCount, 1);
  assert.deepEqual(tiktokResult.bitrates, ['normal_360_0'], 'Must prune normal_1080_0 out of bitrateInfo');
  assert.equal(tiktokResult.playAddr, 'https://v16-webapp-prime.tiktok.com/video/360p.mp4', 'Must redirect playAddr to 360p stream');
  assert.equal(tiktokResult.applied, '360p TikTok cap applied');
  console.log('✓ TEST 10: TikTok feed API intercepted via response.json() & capped to 360p');

  // TEST 11: YouTube InnerTube API Interception & adaptiveFormats Pruning
  await session.send('Page.navigate', { url: 'https://www.youtube.com/watch?v=mock123' });
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 100));
    const isReady = await session.eval('document.readyState === "complete" && window.__qgStreamHook === true').catch(() => false);
    if (isReady) break;
  }

  const ytResult = await session.eval(`(async () => {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player');
    const json = await res.json();
    return {
      adaptiveVideos: json.streamingData.adaptiveFormats.filter(f => f.mimeType.startsWith('video/')).map(f => f.qualityLabel),
      hasAudio: json.streamingData.adaptiveFormats.some(f => f.mimeType.startsWith('audio/')),
      applied: document.documentElement.getAttribute('data-qg-quality-applied')
    };
  })()`);

  assert.deepEqual(ytResult.adaptiveVideos, ['360p'], 'Must prune 1080p video from adaptiveFormats');
  assert.equal(ytResult.hasAudio, true, 'Must preserve audio streams in adaptiveFormats');
  assert.equal(ytResult.applied, '360p YouTube cap applied');
  console.log('✓ TEST 11: YouTube InnerTube API intercepted via response.json() & capped to 360p');

  // TEST 12: YouTube Radio Mode (Sound Only — zero video chunks, video element visible)
  await session.eval(`(() => {
    document.documentElement.setAttribute('data-qg-quality', 'audio');
  })()`);

  const radioResult = await session.eval(`(async () => {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player');
    const json = await res.json();
    const video = document.getElementById('test-video');
    return {
      adaptiveVideos: json.streamingData.adaptiveFormats.filter(f => f.mimeType.startsWith('video/')),
      adaptiveAudios: json.streamingData.adaptiveFormats.filter(f => f.mimeType.startsWith('audio/')),
      formatsCount: json.streamingData.formats?.length || 0,
      applied: document.documentElement.getAttribute('data-qg-quality-applied'),
      videoVisible: video ? getComputedStyle(video).display !== 'none' : true
    };
  })()`);

  assert.equal(radioResult.adaptiveVideos.length, 0, 'Must strip all video streams in radio mode');
  assert.ok(radioResult.adaptiveAudios.length > 0, 'Must keep audio streams');
  assert.equal(radioResult.formatsCount, 0, 'Must strip all progressive formats');
  assert.equal(radioResult.applied, 'Radio mode (sound only) applied');
  assert.equal(radioResult.videoVisible, true, 'Video element must NOT be hidden');
  console.log('✓ TEST 12: YouTube Radio Mode offers audio-only formats while keeping player visible');

  // TEST 13: YouTube Anti-Adblock Compliance & Player API Quality Integration
  const antiAdblockCheck = await session.eval(`(() => {
    // 1. YouTube Anti-Adblock Safety: Verify ytInitialPlayerResponse is NOT intercepted via getter/setter
    const desc = Object.getOwnPropertyDescriptor(window, 'ytInitialPlayerResponse');
    const hasAccessor = Boolean(desc && (desc.get || desc.set));

    // 2. HTML5 Player API Quality Resolution Mapping
    const best360 = window.QuotaGuardYouTube?.pickBestQualityLevel(['hd1080', 'hd720', 'medium', 'small', 'tiny'], '360');
    const best240 = window.QuotaGuardYouTube?.pickBestQualityLevel(['hd1080', 'hd720', 'medium', 'small', 'tiny'], '240');

    // 3. YouTube Media Element Play Compliance: play() must not be blocked or rejected by QuotaGuard on YouTube
    const ytVideo = document.createElement('video');
    let qgBlocked = false;
    try {
      const p = ytVideo.play();
      if (p && typeof p.catch === 'function') {
        p.catch(err => {
          if (err.message && err.message.includes('QuotaGuard')) qgBlocked = true;
        });
      }
    } catch (err) {
      if (err.message && err.message.includes('QuotaGuard')) qgBlocked = true;
    }

    return {
      hasAccessor,
      best360,
      best240,
      qgBlocked
    };
  })()`);

  assert.equal(antiAdblockCheck.hasAccessor, false, 'ytInitialPlayerResponse must NOT define accessors (anti-adblock trigger prevention)');
  assert.equal(antiAdblockCheck.best360, 'medium', 'Player API must map 360p to medium');
  assert.equal(antiAdblockCheck.best240, 'small', 'Player API must map 240p to small');
  assert.equal(antiAdblockCheck.qgBlocked, false, 'play() must NOT be blocked on YouTube (anti-adblock ad-engine compliance)');
  console.log('✓ TEST 13: YouTube initial object and play lifecycle preserved; quality mappings verified');

  // TEST 14: TikTok Container Quality Badge & Resolution Verification
  await session.send('Page.navigate', { url: 'https://www.tiktok.com/@creator/video/123456' });
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 100));
    const isReady = await session.eval('document.readyState === "complete" && window.__qgStreamHook === true').catch(() => false);
    if (isReady) break;
  }

  const tiktokPillCheck = await session.eval(`(() => {
    const video = document.getElementById('test-video');
    const container = document.getElementById('player-container');
    container.className = 'xgplayer xgplayer-is-pc';
    container.setAttribute('data-e2e', 'feed-video');

    // Simulate stream cap applied
    document.dispatchEvent(new CustomEvent('qg-cap-applied', {
      detail: { quality: '540', fallbackLowest: true }
    }));

    const badge = container.querySelector('.qg-pill-badge');
    return {
      badgeExists: Boolean(badge),
      inOuterContainer: badge ? badge.parentElement === container : false,
      text: badge?.textContent || ''
    };
  })()`);

  assert.equal(tiktokPillCheck.badgeExists, true, 'Badge must be created upon stream cap applied');
  assert.equal(tiktokPillCheck.inOuterContainer, true, 'Badge must be mounted to the outer XGPlayer container');
  assert.ok(tiktokPillCheck.text.includes('540p'), 'Badge text must reflect 540p stream');
  console.log('✓ TEST 14: TikTok player container detection & 540p stream badge verified');


  async function waitUntil(expression) {
    for (let i=0;i<40;i++) {
      if (await session.eval(expression).catch(()=>false)) return;
      await new Promise(r=>setTimeout(r,50));
    }
    throw new Error('Timed out waiting for browser state');
  }
  async function setting(site,key,value) {
    await swSession.eval(`(async()=>{const d=await chrome.storage.local.get('settings');const s=QuotaGuard.normalize(d.settings);s[${JSON.stringify(site)}][${JSON.stringify(key)}]=${JSON.stringify(value)};await chrome.storage.local.set({settings:s});})()`);
  }
  // TEST 15: Real settings propagation disables response filtering.
  await setting('tiktok','enabled',false);
  await waitUntil("document.documentElement.getAttribute('data-qg-enabled')==='no'");
  const offPlaylist=await session.eval("fetch('https://video.twimg.com/off.m3u8').then(r=>r.text())");
  assert.ok(offPlaylist.includes('720x1280'));
  assert.equal(await session.eval("!!document.querySelector('.qg-pill-badge')"),false);
  console.log('✓ TEST 15: Off removes the badge and preserves HD stream choices');
  await setting('tiktok','enabled',true);
  await setting('tiktok','preventPreload',false);
  await waitUntil("document.documentElement.getAttribute('data-qg-preload')==='allow'");
  const separatePreload=await session.eval(`(async()=>{
    const v=document.createElement('video');v.preload='auto';
    const before=v.preload;let blocked=false;
    try{await v.play();}catch(e){blocked=e.message.includes('QuotaGuard');}
    return {before,after:v.preload,blocked};
  })()`);
  assert.equal(separatePreload.blocked,true);
  assert.equal(separatePreload.after,separatePreload.before);
  console.log('✓ TEST 16: Autoplay blocking respects the independent preload setting');

  await session.send('Page.navigate',{url:'https://www.youtube.com/watch?v=bytes-test'});
  await waitUntil("document.readyState==='complete'&&document.documentElement.getAttribute('data-qg-site')==='youtube'");
  await setting('youtube','quality','360');
  await waitUntil("document.documentElement.getAttribute('data-qg-quality')==='360'");
  // A real playable recording exercises media events and decoded dimensions.
  // No videoWidth, paused, duration, or content-script state is mocked here.
  const fixture = await session.eval(`(async()=>{
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#23342b';ctx.fillRect(0,0,640,360);
    const stream=canvas.captureStream(10);
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
    const chunks=[];recorder.ondataavailable=e=>chunks.push(e.data);
    const stopped=new Promise(r=>recorder.onstop=r);recorder.start();
    await new Promise(r=>setTimeout(r,300));ctx.fillStyle='#314c3c';ctx.fillRect(0,0,640,360);
    await new Promise(r=>setTimeout(r,300));recorder.stop();await stopped;
    stream.getTracks().forEach(t=>t.stop());
    const bytes=await new Blob(chunks).arrayBuffer();
    window.__qgTestBytes=bytes;
    const v=document.getElementById('test-video');v.muted=true;v.loop=true;v.preload='auto';
    const media=new MediaSource();v.src=URL.createObjectURL(media);
    await new Promise(r=>media.addEventListener('sourceopen',r,{once:true}));
    const buffer=media.addSourceBuffer('video/webm;codecs="vp8"');
    buffer.appendBuffer(bytes);await new Promise(r=>buffer.addEventListener('updateend',r,{once:true}));
    media.endOfStream();await v.play();
    return {bytes:bytes.byteLength,data:Array.from(new Uint8Array(bytes)),width:v.videoWidth,height:v.videoHeight};
  })()`);
  assert.equal(fixture.width,640);
  assert.equal(fixture.height,360);
  await new Promise(r=>setTimeout(r,400));
  let beforeActivity;
  for(let i=0;i<40;i++){
    beforeActivity=await swSession.eval("chrome.storage.local.get('activity')");
    if(beforeActivity.activity?.youtube?.videosCapped===1)break;
    await new Promise(r=>setTimeout(r,50));
  }
  const statusExpression="(async()=>{const [tab]=await chrome.tabs.query({url:'https://www.youtube.com/*'});return chrome.tabs.sendMessage(tab.id,{type:'qg-status'});})()";
  assert.equal(beforeActivity.activity.youtube.videosCapped,1,JSON.stringify(await swSession.eval(statusExpression)));
  for(let i=0;i<3;i++){
    await session.eval("document.body.appendChild(document.createElement('div'))");
    await new Promise(r=>setTimeout(r,400));
  }
  const afterActivity=await swSession.eval("chrome.storage.local.get('activity')");
  assert.equal(afterActivity.activity.youtube.videosCapped,1,'Repeated playback/DOM events must not recount one source');
  console.log('✓ TEST 17: A real 360p video is counted once across loops and DOM mutations');
  await setting('youtube','quality','240');
  await waitUntil("document.documentElement.getAttribute('data-qg-quality')==='240'");
  let liveStatus=await swSession.eval("(async()=>{const [tab]=await chrome.tabs.query({url:'https://www.youtube.com/*'});return chrome.tabs.sendMessage(tab.id,{type:'qg-status'});})()");
  assert.equal(liveStatus.state,'above');
  assert.equal(liveStatus.actualResolution,360);
  assert.equal(liveStatus.mediaSize.kind,'buffered');
  assert.equal(liveStatus.mediaSize.bytes,fixture.bytes,'Byte count must match the real MSE append exactly');
  assert.ok(!liveStatus.quality.includes('est.'));
  await session.eval("document.getElementById('test-video').dispatchEvent(new Event('timeupdate'))");
  assert.ok((await session.eval("document.querySelector('.qg-pill-badge').textContent")).includes('buffered'));

  const chip=await session.eval(`(()=>{
    const badge=document.querySelector('.qg-pill-badge');const r=badge.getBoundingClientRect();
    const v=document.getElementById('test-video').getBoundingClientRect();
    return {text:badge.textContent,width:r.width,top:r.top-v.top,bottom:v.bottom-r.bottom,left:r.left-v.left,right:v.right-r.right,warning:getComputedStyle(badge.querySelector('.qg-badge-warning')).display};
  })()`);
  assert.ok(!chip.text.includes('Above target')&&!chip.text.includes('Size unavailable'),'No warning paragraph on the video');
  assert.ok(chip.width<240,'Compact chip must stay narrow');
  assert.ok(chip.top>40&&chip.bottom>=40,'Chip must clear top corners and bottom player controls');
  assert.ok(chip.left>=10&&chip.right>=10,'Chip must stay inside the video even when its container is wider');
  assert.notEqual(chip.warning,'none');

  console.log('✓ TEST 18: Above-target state uses real dimensions and exact per-player MSE bytes');
  if(process.env.QG_SCREENSHOT_DIR){
    fs.mkdirSync(process.env.QG_SCREENSHOT_DIR,{recursive:true});
    const videoBox=await session.eval("(()=>{const r=document.getElementById('test-video').getBoundingClientRect();return {x:r.x,y:r.y};})()");
    await session.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:videoBox.x+60,y:videoBox.y+60});
    await new Promise(r=>setTimeout(r,200));
    const clip=await session.eval("(()=>{const r=document.querySelector('.qg-pill-badge').getBoundingClientRect();return {x:r.x-6,y:r.y-6,width:r.width+12,height:r.height+12,scale:2};})()");
    const shot=await session.send('Page.captureScreenshot',{format:'png',clip});
    fs.writeFileSync(path.join(process.env.QG_SCREENSHOT_DIR,'quotaguard-player.png'),Buffer.from(shot.data,'base64'));
  }
  // A native media request bypasses fetch; its full length must reach this video.
  session.mediaFixture=Buffer.from(fixture.data);
  await session.eval(`(async()=>{
    const v=document.getElementById('test-video');
    v.src='https://video.twimg.com/test-size.webm';await v.play();
  })()`);
  await new Promise(r=>setTimeout(r,250));
  liveStatus=await swSession.eval("(async()=>{const [tab]=await chrome.tabs.query({url:'https://www.youtube.com/*'});return chrome.tabs.sendMessage(tab.id,{type:'qg-status'});})()");
  assert.equal(liveStatus.mediaSize.kind,'total');
  assert.equal(liveStatus.mediaSize.bytes,fixture.bytes,'Full media total must match the real response body length');
  console.log('✓ TEST 19: Native video response Content-Length reports the exact full resource size');

  // Opening a Facebook Reel must not let quality automation close its viewer.
  await session.send('Page.navigate',{url:'https://www.facebook.com/reel/navigation-regression'});
  await waitUntil("document.readyState==='complete'&&document.documentElement.getAttribute('data-qg-site')==='facebook'");
  await session.eval(`(async()=>{
    document.body.replaceChildren();
    window.reelActions={gear:0,quality:0,close:0};
    const viewer=document.createElement('section');viewer.id='reel-viewer';viewer.setAttribute('role','dialog');
    const close=document.createElement('button');close.setAttribute('aria-label','Close reel');close.textContent='Close';
    close.onclick=()=>{window.reelActions.close++;viewer.remove();history.replaceState({},'','/');};
    const gear=document.createElement('button');gear.setAttribute('aria-label','Playback settings');gear.textContent='Settings';
    gear.onclick=()=>{
      window.reelActions.gear++;
      const menu=document.createElement('div');menu.setAttribute('role','menu');
      const quality=document.createElement('button');quality.setAttribute('role','menuitemradio');quality.textContent='360p';
      quality.onclick=()=>{window.reelActions.quality++;menu.remove();};menu.append(quality);viewer.append(menu);
    };
    const video=document.createElement('video');video.width=640;video.height=360;video.muted=true;video.loop=true;
    video.setAttribute('data-qg-manual-play','yes');video.src='https://video.twimg.com/test-size.webm';
    viewer.append(close,gear,video);document.body.append(viewer);await video.play();
  })()`);
  await new Promise(r=>setTimeout(r,1600));
  const reelResult=await session.eval("({viewerOpen:!!document.getElementById('reel-viewer'),path:location.pathname,actions:window.reelActions})");
  assert.equal(reelResult.viewerOpen,true,JSON.stringify(reelResult));
  assert.deepEqual(reelResult.actions,{gear:0,quality:0,close:0});
  assert.equal(reelResult.path,'/reel/navigation-regression');
  console.log('✓ TEST 20: Facebook Reel stays open; no automated settings, quality, or Close clicks');

  // A genuine Home -> Reel click authorizes the new viewer, not only its preview.
  await session.eval(`(()=>{
    document.body.replaceChildren();history.replaceState({},'','/');
    const link=document.createElement('a');link.id='open-reel';link.href='/reel/from-home';link.textContent='Open reel';
    link.onclick=event=>{
      event.preventDefault();history.pushState({},'','/reel/from-home');
      const viewer=document.createElement('section');viewer.id='manual-reel-viewer';viewer.setAttribute('role','dialog');
      const video=document.createElement('video');video.width=640;video.height=360;video.muted=true;video.loop=true;
      video.src='https://video.twimg.com/test-size.webm';viewer.append(video);document.body.append(viewer);
      video.play().then(()=>window.manualReelResult='playing').catch(error=>window.manualReelResult=error.message);
    };
    document.body.append(link);
  })()`);
  const reelLink=await session.eval("(()=>{const r=document.getElementById('open-reel').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
  await session.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...reelLink});
  await session.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...reelLink});
  await waitUntil("typeof window.manualReelResult==='string'");
  assert.equal(await session.eval('window.manualReelResult'),'playing','A trusted Reel-open click must allow its newly mounted video');
  assert.equal(await session.eval('location.pathname'),'/reel/from-home');
  console.log('✓ TEST 21: A genuine Home-to-Reel click authorizes the newly mounted viewer video');

  const otherAutoplayBlocked=await session.eval(`(async()=>{
    const unrelated=document.createElement('video');document.body.append(unrelated);
    try{await unrelated.play();return false;}catch(error){return error.message.includes('QuotaGuard');}
    finally{unrelated.remove();}
  })()`);
  assert.equal(otherAutoplayBlocked,true,'Reel-open permission must not enable unrelated feed videos');
  console.log('✓ TEST 22: Reel-open permission leaves unrelated autoplay blocked');
  swSession.close();
  session.close();
  console.log('\n=======================================================');
  console.log('  ALL 22 REAL BROWSER INTEGRATION TESTS PASSED 100%');
  console.log('=======================================================');

} finally {
  browserProcess.kill();
  setTimeout(() => {
    try {
      const absolute = path.resolve(tempDir);
      if (absolute.startsWith(path.join(os.tmpdir(), 'qg-'))) fs.rmSync(absolute, {recursive: true, force: true});
    } catch (_) {}
  }, 1000);
}
