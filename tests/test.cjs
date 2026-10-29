'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');
const dir = path.join(__dirname, '..');
const ctx = vm.createContext({});
for (const file of ['settings.js', 'quality.js']) {
  vm.runInContext(fs.readFileSync(path.join(dir, file), 'utf8'), ctx);
}
const {QuotaGuard: Q, QuotaGuardQuality: V} = ctx;
assert.equal(Q.siteForHost('facebook.com'), 'facebook');
assert.equal(Q.siteForHost('www.facebook.com'), 'facebook');
assert.equal(Q.siteForHost('m.facebook.com'), 'facebook');
assert.equal(Q.siteForHost('x.com'), 'x');
assert.equal(Q.siteForHost('www.twitter.com'), 'x');
assert.equal(Q.siteForHost('tiktok.com'), 'tiktok');
assert.equal(Q.siteForHost('www.tiktok.com'), 'tiktok');
assert.equal(Q.siteForHost('m.tiktok.com'), 'tiktok');
assert.equal(Q.siteForHost('youtube.com'), 'youtube');
assert.equal(Q.siteForHost('www.youtube.com'), 'youtube');
assert.equal(Q.siteForHost('m.youtube.com'), 'youtube');
assert.equal(Q.siteForHost('youtu.be'), 'youtube');
assert.equal(Q.siteForHost('fakex.com'), null);
assert.equal(Q.siteForHost('x.com.evil.org'), null);
assert.equal(Q.normalize().facebook.stopAutoplay, true);
assert.equal(Q.normalize().tiktok.stopAutoplay, true);
assert.equal(Q.normalize().youtube.stopAutoplay, true);
assert.equal(Q.normalize({youtube: {quality: '240'}}).youtube.quality, '240');
assert.equal(Q.normalize({tiktok: {quality: '240'}}).tiktok.quality, '240');
assert.equal(Q.normalize({facebook: {quality: '240'}}).facebook.quality, '240');
assert.equal(Q.normalizeStats().facebook.videosCapped, 0);
assert.equal(Q.normalizeStats({x: {videosCapped: 5, mbSavedEst: 90}}).x.videosCapped, 5);
assert.equal(Q.normalizeStats({x: {videosCapped: 5, mbSavedEst: 90}}).x.mbSavedEst, 90);
assert.equal(V.parseResolution('360p'), 360);
assert.equal(V.parseResolution('360 pixels'), null);
assert.equal(V.choose([{label: '240p'}, {label: '360p'}, {label: '720p'}], '360').resolution, 360);
assert.equal(V.choose([{label: '240p'}, {label: '720p'}], '360').resolution, 240);
assert.equal(V.choose([{label: '480p'}, {label: '720p'}], '360').resolution, 480);
assert.equal(V.choose([{label: '480p'}], '360').resolution, 480);
assert.equal(V.choose([{label: 'SD only'}, {label: 'HD'}], '360').label, 'SD only');
assert.equal(V.choose([{label: '240p'}, {label: '360p'}], 'auto'), null);
const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
assert.equal(m.manifest_version, 3);
for (const rule of m.content_scripts) {
  for (const file of (rule.js || []).concat(rule.css || [])) {
    assert(fs.existsSync(path.join(dir, file)), `Missing file: ${file}`);
  }
}
for (const icon of Object.values(m.icons)) assert(fs.existsSync(path.join(dir, icon)));
console.log('PASS: domains, defaults, quality preference, manifest, assets');
