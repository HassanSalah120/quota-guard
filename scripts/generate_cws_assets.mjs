import fs from 'node:fs';
import path from 'node:path';
import {dataImage, launch, render, root} from './lib/browser.mjs';

const directory = path.join(root, 'assets/cws');
const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))).version;
const icon = dataImage(path.join(root, 'assets/branding/quotaguard-icon.svg'));
const image = name => dataImage(path.join(root, 'assets/screenshots', name));
const style = `<style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{background:#17191f;color:#f2f4f7;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}header{position:absolute;top:48px;left:64px;right:64px;display:flex;align-items:center;justify-content:space-between}header span{display:flex;align-items:center;gap:12px;font-size:23px;font-weight:600}header img{width:32px;height:32px}header small,.eyebrow{color:#8ce3c1;font-size:14px;letter-spacing:.12em;text-transform:uppercase}h1{font-size:62px;letter-spacing:-.045em;line-height:1.08;font-weight:600;margin:18px 0 26px}p{font-size:23px;line-height:1.55;color:#a6aeba;margin:0}article{position:absolute;left:64px;top:195px;width:590px}.note{font-size:15px;line-height:1.6;color:#a6aeba;margin-top:28px;max-width:520px}.capture{position:absolute;right:68px;top:142px;width:400px;margin:0}.capture img{width:400px;display:block;border:1px solid #343944;border-radius:12px}.capture figcaption{font-size:12px;color:#a6aeba;margin-top:13px;text-align:center}footer{position:absolute;left:64px;right:64px;bottom:38px;border-top:1px solid #343944;padding-top:22px;font-size:15px;color:#a6aeba;display:flex;justify-content:space-between}.tag{color:#8ce3c1}</style>`;
const header = `<header><span><img src="${icon}" alt="">QuotaGuard</span><small>Version ${version}</small></header>`;
const footer = `<footer><span>Facebook · X · TikTok · YouTube</span><span class="tag">Open source / Manifest V3</span></footer>`;
const frame = body => `<!doctype html><meta charset="utf-8">${style}${header}${body}${footer}`;
const browser = await launch();
try {
  const page = await browser.page();
  const captures = [
    ['screenshot-1-dashboard-1280x800.png', '01 / Quality', 'Set the limit.<br>See what plays.', 'Your requested ceiling and the actual decoded quality, side by side.', 'Lower qualities depend on the streams offered by each video.', 'popup-dashboard.png'],
    ['screenshot-2-radio-mode-1280x800.png', '02 / Audio only', 'Keep listening.<br>Request less video.', 'Audio-only requests for supported Facebook and YouTube responses.', 'Reload to apply. Player support varies; audio-only transfer is not verified.', 'popup-radio-mode.png'],
    ['screenshot-4-above-cap-1280x800.png', '04 / Clear readings', 'Know when a video<br>is above your cap.', 'A requested quality is a ceiling. The popup tells you when playback exceeds it.', 'Media size appears only when it can be measured for that video. No estimates.', 'popup-above-cap.png']
  ];
  for (const [file, eyebrow, title, copy, note, capture] of captures) {
    await render(page, frame(`<article><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${copy}</p><p class="note">${note}</p></article><figure class="capture"><img src="${image(capture)}" alt="Current popup"><figcaption>Current interface · Example playback state</figcaption></figure>`), path.join(directory, file), 1280, 800);
  }
  await render(page, frame(`<article style="width:440px"><div class="eyebrow">03 / On the player</div><h1>Small chip.<br>Useful detail.</h1><p>Hover or focus to see quality and available measured bytes.</p><p class="note">Buffered bytes are data supplied to this player, not total video size or internet usage.</p></article><figure style="position:absolute;right:64px;top:190px;width:620px;margin:0"><img style="width:620px;border:1px solid #343944;border-radius:12px" src="${image('on-video-pill.png')}" alt="Real MediaSource test player"><figcaption style="font-size:13px;color:#a6aeba;margin-top:18px">Controlled test video · Real player chip and measured buffered bytes</figcaption><img style="width:280px;margin-top:30px" src="${image('player-chip.png')}" alt="Chip detail"></figure>`), path.join(directory, 'screenshot-3-player-pill-1280x800.png'), 1280, 800);
  await render(page, `<!doctype html><meta charset="utf-8">${style}<div style="padding:30px 32px"><div style="display:flex;align-items:center;gap:10px;font-size:22px;font-weight:600"><img src="${icon}" width="29" height="29">QuotaGuard</div><h1 style="font-size:38px;margin:25px 0 18px">Less data.<br>More control.</h1><p style="font-size:14px">Facebook · X · TikTok · YouTube</p></div>`, path.join(directory, 'promo-tile-small-440x280.png'), 440, 280);
  await render(page, `<!doctype html><meta charset="utf-8">${style}<article style="top:75px;width:790px"><div class="eyebrow">QuotaGuard / ${version}</div><h1 style="font-size:80px">Less data.<br>More control.</h1><p>Choose video quality. Control playback.</p><p style="font-size:17px;margin-top:38px">Facebook · X · TikTok · YouTube</p></article><img style="position:absolute;right:112px;top:116px;width:300px;height:300px" src="${icon}" alt="QuotaGuard">`, path.join(directory, 'marquee-banner-1400x560.png'), 1400, 560);
  console.log('Generated four 1280×800 screenshots, 440×280 promo tile, and 1400×560 marquee.');
} finally {await browser.close();}
