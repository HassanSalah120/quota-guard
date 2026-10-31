'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const events = [];
const timers = [];
class SourceBuffer {
  appendBuffer(bytes) { if (this.updating || !bytes) throw new Error('InvalidStateError'); }
}
class MediaSource { addSourceBuffer() { return new SourceBuffer(); } }
class HTMLMediaElement { play() { return Promise.resolve(); } }
class HTMLVideoElement extends HTMLMediaElement {}
let nextUrl = 0;
class MediaURL extends URL { static createObjectURL() { return 'blob:https://x.com/' + ++nextUrl; } }
const context = vm.createContext({
  URL: MediaURL, MediaSource, SourceBuffer, HTMLMediaElement, HTMLVideoElement,
  location: {hostname: 'x.com'},
  document: {createElement() {}, addEventListener() {}, dispatchEvent: e => events.push(e)},
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  setTimeout: fn => { timers.push(fn); return timers.length; }, setInterval() {}, addEventListener() {}
});
vm.runInContext('window=globalThis', context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'main-guard.js'), 'utf8'), context);
const source = new MediaSource();
const url = MediaURL.createObjectURL(source);
const video = source.addSourceBuffer('video/mp4');
const audio = source.addSourceBuffer('audio/mp4');
video.appendBuffer(new Uint8Array(600));
audio.appendBuffer(new Uint8Array(400));
video.updating = true;
assert.throws(() => video.appendBuffer(new Uint8Array(900)), /InvalidStateError/);
timers.shift()();
assert.equal(events.length, 1);
assert.equal(events[0].detail.url, url);
assert.equal(events[0].detail.bytes, 1000, 'Only successfully accepted video+audio payloads count');
const other = new MediaSource();
const otherUrl = MediaURL.createObjectURL(other);
other.addSourceBuffer('video/mp4').appendBuffer(new Uint8Array(123));
timers.shift()();
assert.equal(events[1].detail.url, otherUrl);
assert.equal(events[1].detail.bytes, 123, 'Separate videos must not share byte counts');
console.log('PASS: Exact MSE payload bytes, shared audio/video source, rejected appends excluded, separate video attribution');
