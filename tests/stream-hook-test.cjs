'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const dir = path.join(__dirname, '..');
const playlist = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=640x360\n360.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720\n720.m3u8\n';

function hook({enabled = 'yes', quality = '360', text = playlist, chunkSize = 7} = {}) {
  const attrs = new Map([['data-qg-enabled', enabled], ['data-qg-quality', quality]]);
  const context = vm.createContext({
    location: {hostname: 'x.com', href: 'https://x.com/'}, navigator: {},
    document: {documentElement: {getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value)}, dispatchEvent() {}},
    URL, TextEncoder, TextDecoder, TransformStream, Response, Headers, Uint8Array,
    setTimeout() {}, CustomEvent: class {},
    fetch: async () => {
      const bytes = new TextEncoder().encode(text);
      let offset = 0;
      return new Response(new ReadableStream({
        pull(controller) {
          if (offset === bytes.length) return controller.close();
          controller.enqueue(bytes.slice(offset, offset += Math.min(chunkSize, bytes.length - offset)));
        }
      }), {headers: {'Content-Type': 'application/json', 'Content-Length': String(bytes.length)}});
    }
  });
  vm.runInContext('window = globalThis', context);
  for (const file of ['hls-quality.js', 'youtube-quality.js', 'stream-hook.js']) {
    vm.runInContext(fs.readFileSync(path.join(dir, file), 'utf8'), context);
  }
  return {context, attrs};
}

(async () => {
  const disabled = hook({enabled: 'no', quality: 'auto'});
  assert.equal(await (await disabled.context.fetch('https://video.twimg.com/a.m3u8')).text(), playlist, 'Off must preserve all variants');
  const automatic = hook({quality: 'auto'});
  assert.equal(await (await automatic.context.fetch('https://video.twimg.com/a.m3u8')).text(), playlist);

  for (const method of ['text', 'arrayBuffer', 'blob', 'body']) {
    const {context} = hook();
    const response = await context.fetch('https://video.twimg.com/a.m3u8');
    assert.equal(response.body, response.body, 'Repeated body access must return the same stream');
    const text = method === 'body' ? await new Response(response.body).text()
      : method === 'arrayBuffer' ? new TextDecoder().decode(await response.arrayBuffer())
      : method === 'blob' ? await (await response.blob()).text() : await response.text();
    assert.equal((text.match(/#EXTM3U/g) || []).length, 1, method + ': exactly one playlist');
    assert.ok(!text.includes('720.m3u8'), method + ': HD variant removed');
    assert.ok(text.includes('360.m3u8'), method + ': allowed variant preserved');
    assert.equal(response.bodyUsed, true, method + ': consumption reflected in bodyUsed');
  }

  const payload = JSON.stringify({title: 'موسيقى 🎵', streamingData: {adaptiveFormats: [
    {mimeType: 'video/mp4', height: 360}, {mimeType: 'video/mp4', height: 1080}, {mimeType: 'audio/mp4'}
  ]}});
  const {context} = hook({text: payload, chunkSize: 1});
  const response = await context.fetch('https://www.youtube.com/youtubei/v1/player');
  const clone = response.clone();
  const result = await response.json();
  assert.equal(result.title, 'موسيقى 🎵', 'Split UTF-8 must survive adaptation');
  assert.equal(result.streamingData.adaptiveFormats.length, 2);
  assert.deepEqual(await clone.json(), result, 'Clones return the same adapted content');
  const inFlight = hook();
  const pending = await inFlight.context.fetch('https://video.twimg.com/a.m3u8');
  inFlight.attrs.set('data-qg-enabled', 'no');
  assert.equal(await pending.text(), playlist, 'Turning off also bypasses in-flight adaptation');
  const oversize = playlist + '#' + 'x'.repeat(8 * 1024 * 1024);
  const bounded = hook({text: oversize, chunkSize: 65536});
  assert.equal(await (await bounded.context.fetch('https://video.twimg.com/large.m3u8')).text(), oversize, 'Oversize responses pass through intact');
  console.log('PASS: Off/default bypass, chunked HLS and UTF-8 JSON, all body readers, clones, bodyUsed, in-flight settings');
})().catch(error => { console.error(error); process.exitCode = 1; });
