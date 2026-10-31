'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const dir = path.join(__dirname, '..');
const event = () => ({listeners: [], addListener(fn, filter) { this.listeners.push(fn); this.filter = filter; }});
const data = {};
const messages = [];
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const chrome = {
  runtime: {onInstalled: event(), onStartup: event(), onMessage: event(), getURL: p => 'chrome-extension://test/' + p, getManifest: () => manifest},
  storage: {onChanged: event(), local: {
    get: async key => ({[key]: structuredClone(data[key])}),
    set: async values => { for (const [key, value] of Object.entries(values)) data[key] = structuredClone(value); }
  }},
  declarativeNetRequest: {updateDynamicRules: async () => {}},
  action: {setBadgeText() {}, setTitle() {}},
  tabs: {sendMessage: async (tab, message) => messages.push({tab, ...message})},
  webRequest: Object.fromEntries(['onBeforeRequest', 'onResponseStarted', 'onCompleted', 'onErrorOccurred'].map(key => [key, event()]))
};
const context = vm.createContext({chrome, console, URL});
context.importScripts = file => vm.runInContext(fs.readFileSync(path.join(dir, file), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(dir, 'background.js'), 'utf8'), context);
function send(message, sender) { return new Promise(resolve => chrome.runtime.onMessage.listeners[0](message, sender, resolve)); }
const sender = {url: 'https://x.com/video', tab: {id: 1}};

(async () => {
  await Promise.all(Array.from({length: 40}, () => send({type: 'qg-stat', field: 'videosCapped'}, sender)));
  assert.equal(data.activity.x.videosCapped, 40, 'Concurrent tabs must not lose increments');
  await Promise.all([
    send({type: 'qg-setting', site: 'x', key: 'quality', value: '240'}, sender),
    send({type: 'qg-setting', site: 'x', key: 'preventPreload', value: false}, sender)
  ]);
  assert.equal(data.settings.x.quality, '240');
  assert.equal(data.settings.x.preventPreload, false);
  assert.equal((await send({type: 'qg-setting', site: 'facebook', key: 'enabled', value: false}, sender)).ok, false);
  assert.equal((await send({type: 'qg-stat', field: 'mbSavedEst'}, sender)).ok, false);
  assert.equal((await send({type: 'qg-stat', field: 'videosCapped'}, {url: 'https://unrelated.example'})).ok, false);
  assert.equal((await send({type: 'qg-setting', site: 'x', key: 'quality', value: 'garbage'}, sender)).ok, false);

  const before = chrome.webRequest.onBeforeRequest.listeners[0];
  const response = chrome.webRequest.onResponseStarted.listeners[0];
  function headers(id, url, statusCode, values) {
    before({requestId: id, tabId: 1, url});
    response({requestId: id, tabId: 1, url, statusCode, type: 'media', responseHeaders: Object.entries(values).map(([name, value]) => ({name, value}))});
  }
  headers('a', 'https://video.twimg.com/full.mp4', 200, {'Content-Type': 'video/mp4', 'Content-Length': '5000000'});
  assert.equal(messages.at(-1).bytes, 5000000);
  headers('b', 'https://video.twimg.com/range.mp4', 206, {'Content-Range': 'bytes 0-1023/9000000', 'Content-Length': '1024'});
  assert.equal(messages.at(-1).bytes, 9000000, 'Partial responses report full resource size, not chunk length');
  const known = messages.length;
  headers('c', 'https://video.twimg.com/unknown.mp4', 206, {'Content-Length': '1024'});
  headers('d', 'https://video.twimg.com/chunk.mp4?range=0-1023', 200, {'Content-Length': '1024'});
  headers('e', 'https://video.twimg.com/unknown.mp4', 200, {});
  assert.equal(messages.length, known, 'Missing sizes and partial lengths must never become guessed totals');
  assert.ok(!chrome.webRequest.onResponseStarted.filter.urls.includes('*://*/*'));
  console.log('PASS: Concurrent activity/settings, sender validation, exact full/range sizes, unknown-size handling, scoped requests');
})().catch(error => { console.error(error); process.exitCode = 1; });
