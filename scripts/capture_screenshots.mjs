import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {launch, root, waitFor} from './lib/browser.mjs';

// Capture the actual popup. Only the tab-status boundary uses example readings;
// the DOM, styles, options, settings persistence and status rendering are real.
const directory = path.join(root, 'assets/screenshots');
fs.mkdirSync(directory, {recursive: true});
const browser = await launch({extension: true});
try {
  let workerTarget;
  await waitFor(async () => {
    workerTarget = (await browser.targets()).find(target => target.type === 'service_worker' && target.url.endsWith('/background.js'));
    return !!workerTarget;
  }, 'extension service worker');
  // A fixed-size extension page keeps captures stable across multiple states.
  // tests/popup_smoke_test.mjs separately verifies the native toolbar frame.
  const popup = await browser.page();
  await popup.send('Emulation.setDeviceMetricsOverride', {width: 400, height: 600, deviceScaleFactor: 1, mobile: false});
  await popup.send('Page.navigate', {url: workerTarget.url.replace('background.js', 'popup.html')});
  await waitFor(() => popup.eval(`document.readyState==='complete' && document.styleSheets.length>0 && document.querySelector('[data-setting="enabled"]')?.disabled===false`).catch(() => false), 'popup settings');
  const examples = [
    {file: 'popup-dashboard.png', site: 'facebook', quality: '360', actual: 360, state: 'verified'},
    {file: 'popup-above-cap.png', site: 'facebook', quality: '240', actual: 720, state: 'above'},
    {file: 'popup-radio-mode.png', site: 'youtube', quality: 'audio', actual: null, state: 'requested'},
    {file: 'popup-tiktok.png', site: 'tiktok', quality: '540', actual: 540, state: 'verified'}
  ];
  for (const example of examples) {
    await popup.eval(`(async()=>{
      const example=${JSON.stringify(example)};
      window.assetReading={enabled:true,requestedQuality:example.quality,actualResolution:example.actual,state:example.state,quality:example.state,mediaSize:null};
      chrome.tabs.query=async()=>[{id:1,url:'https://www.'+example.site+'.com/'}];
      chrome.tabs.sendMessage=async()=>window.assetReading;
      await chrome.runtime.sendMessage({type:'qg-setting',site:example.site,key:'quality',value:example.quality});
      document.getElementById('tab-'+example.site).click();
      document.getElementById('advanced-controls').open=false;
      document.activeElement.blur();
    })()`);
    await waitFor(() => popup.eval(`document.getElementById('stream-state').dataset.state===${JSON.stringify(example.state)} && document.getElementById('target-quality').textContent===${JSON.stringify(example.quality === 'audio' ? 'Audio' : example.quality + 'p')}`), example.file);
    const height = await popup.eval('document.body.offsetHeight');
    await popup.eval('document.fonts.ready.then(()=>Promise.all([...document.images].map(image=>image.decode())))');
    const shot = await popup.send('Page.captureScreenshot', {format: 'png', clip: {x: 0, y: 0, width: 400, height, scale: 2}});
    fs.writeFileSync(path.join(directory, example.file), Buffer.from(shot.data, 'base64'));
    console.log(`Captured ${example.file}: 400×${height} CSS pixels (2×).`);
  }
} finally {await browser.close();}

// The real-browser harness records a playable video, appends its bytes through
// MediaSource and captures the actual content-script chip, without a mock badge.
const result = spawnSync(process.execPath, [path.join(root, 'tests/real_browser_test.mjs')], {
  cwd: root, env: {...process.env, QG_SCREENSHOT_DIR: directory}, stdio: 'inherit'
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Player screenshot checks failed (${result.status})`);
fs.renameSync(path.join(directory, 'quotaguard-player-context.png'), path.join(directory, 'on-video-pill.png'));
fs.renameSync(path.join(directory, 'quotaguard-player.png'), path.join(directory, 'player-chip.png'));
