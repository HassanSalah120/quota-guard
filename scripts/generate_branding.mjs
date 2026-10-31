import fs from 'node:fs';
import path from 'node:path';
import {launch, render, root} from './lib/browser.mjs';

const directory = path.join(root, 'assets/branding');
fs.mkdirSync(directory, {recursive: true});
const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))).version;
const emblem = `<path d="M256 36C356 36 444 68 452 112C460 265 368 405 256 480C144 405 52 265 60 112C68 68 156 36 256 36Z" fill="#17191f" stroke="#8ce3c1" stroke-width="20" stroke-linejoin="round"/><path d="M278 110 182 252H248L216 402 336 226H266Z" fill="#8ce3c1"/>`;
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${emblem}</svg>`;
const logo = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200" viewBox="0 0 800 200"><g transform="translate(20 18) scale(.32)">${emblem}</g><text x="210" y="105" fill="#f2f4f7" font-family="Segoe UI,Arial,sans-serif" font-size="65" font-weight="600" letter-spacing="-2">QuotaGuard</text><text x="213" y="147" fill="#a6aeba" font-family="Segoe UI,Arial,sans-serif" font-size="21">Video quality. Under your control.</text></svg>`;
const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640"><rect width="1280" height="640" fill="#17191f"/><path d="M72 72H1208" stroke="#343944"/><text x="72" y="117" fill="#8ce3c1" font-family="Segoe UI,Arial,sans-serif" font-size="18" letter-spacing="3">QUOTAGUARD / ${version}</text><text x="72" y="245" fill="#f2f4f7" font-family="Segoe UI,Arial,sans-serif" font-size="77" font-weight="600" letter-spacing="-3">Less data.</text><text x="72" y="335" fill="#f2f4f7" font-family="Segoe UI,Arial,sans-serif" font-size="77" font-weight="600" letter-spacing="-3">More control.</text><text x="76" y="401" fill="#a6aeba" font-family="Segoe UI,Arial,sans-serif" font-size="25">Choose video quality. Control playback.</text><g transform="translate(900 170) scale(.5)">${emblem}</g><path d="M72 488H1208" stroke="#343944"/><text x="76" y="550" fill="#c7d0db" font-family="Segoe UI,Arial,sans-serif" font-size="21">Facebook     X     TikTok     YouTube</text><text x="1208" y="550" text-anchor="end" fill="#8ce3c1" font-family="Segoe UI,Arial,sans-serif" font-size="18">Open source · Manifest V3</text></svg>`;

const browser = await launch();
try {
  const page = await browser.page();
  for (const [name, svg, width, height] of [['icon', icon, 512, 512], ['logo', logo, 800, 200], ['banner', banner, 1280, 640]]) {
    fs.writeFileSync(path.join(directory, `quotaguard-${name}.svg`), svg + '\n');
    if (name !== 'icon') await render(page, `<style>html,body{margin:0;background:transparent}</style>${svg}`, path.join(directory, `quotaguard-${name}.png`), width, height, {transparent: true});
  }
  for (const size of [16, 32, 48, 128, 256, 512]) {
    const sized = icon.replace('width="512" height="512"', `width="${size}" height="${size}"`);
    const file = path.join(directory, `icon-${size}.png`);
    await render(page, `<style>html,body{margin:0;background:transparent}</style>${sized}`, file, size, size, {transparent: true});
    const transparent = await page.eval(`(async()=>{const image=new Image();image.src='data:image/png;base64,${fs.readFileSync(file).toString('base64')}';await image.decode();const canvas=document.createElement('canvas');canvas.width=${size};canvas.height=${size};const context=canvas.getContext('2d');context.drawImage(image,0,0);return [[0,0],[${size - 1},0],[0,${size - 1}],[${size - 1},${size - 1}]].every(([x,y])=>context.getImageData(x,y,1,1).data[3]===0);})()`);
    if (!transparent) throw new Error(`Icon ${size}px has opaque corners`);
    if (size <= 128) fs.copyFileSync(file, path.join(root, `icons/icon${size}.png`));
  }
  console.log('Generated charcoal/mint SVG branding, banner, logo, and all six transparent icon sizes.');
} finally {await browser.close();}
