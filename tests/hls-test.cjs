'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const dir = path.join(__dirname, '..');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(dir, 'hls-quality.js'), 'utf8'),context);
const {limit} = context.QuotaGuardHls;
const manifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=256000,RESOLUTION=180x320,CODECS="avc1"
/pu/pl/180x320.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=360x640,CODECS="avc1"
/pu/pl/360x640.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=720x1280,CODECS="avc1"
/pu/pl/720x1280.m3u8
`;
function present(result, paths) {
  for(const path of ['/pu/pl/180x320.m3u8','/pu/pl/360x640.m3u8','/pu/pl/720x1280.m3u8'])
    assert.equal(result.text.includes(path), paths.includes(path), `${path} included unexpectedly`);
  assert.equal((result.text.match(/#EXT-X-STREAM-INF/g)||[]).length,paths.length);
}
let result=limit(manifest,'360');
assert.equal(result.selected,360);
present(result, ['/pu/pl/360x640.m3u8']);
result=limit(manifest,'240'); assert.equal(result.selected,180); present(result,['/pu/pl/180x320.m3u8']);
result=limit(manifest,'480'); assert.equal(result.selected,360); present(result,['/pu/pl/360x640.m3u8']);
result=limit(manifest,'540'); assert.equal(result.selected,360); present(result,['/pu/pl/360x640.m3u8']);
result=limit(manifest,'720'); assert.equal(result.selected,720); present(result,['/pu/pl/720x1280.m3u8']);
result=limit(manifest,'auto'); assert.equal(result.changed,false); assert.equal(result.text,manifest);
result=limit('#EXTM3U\n#EXTINF:3,\nsegment.ts\n','360'); assert.equal(result.changed,false);
const landscape=manifest.replaceAll('180x320','320x180').replaceAll('360x640','640x360').replaceAll('720x1280','1280x720');
assert.equal(limit(landscape,'360').selected,360);
const noLow = manifest.replaceAll('180x320','480x854').replaceAll('360x640','720x1280').replaceAll('720x1280.m3u8','900x1600.m3u8');
assert.equal(limit(noLow,'240').selected,480); // fallback lowest quality, not highest
const lines=manifest.replaceAll('\n','\r\n');
assert.ok(limit(lines,'360').text.includes('\r\n'));
const unlabelledM3u8 = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=320000
/low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000
/high.m3u8
`;
const unlabelledRes = limit(unlabelledM3u8, '360');
assert.equal(unlabelledRes.changed, true);
assert.equal(unlabelledRes.selected, 240);
assert.ok(unlabelledRes.text.includes('/low.m3u8'));
assert.ok(!unlabelledRes.text.includes('/high.m3u8'));

console.log('PASS: HLS master filtering, portrait/landscape, low fallback, unlabelled bandwidth fallback, unchanged media playlist');
