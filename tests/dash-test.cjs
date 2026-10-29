'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const dir = path.join(__dirname, '..');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(dir, 'dash-quality.js'), 'utf8'), context);

const { parseRepresentations, limitDash } = context.QuotaGuardDash;

const sampleMpd = `
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" minBufferTime="PT1.5S">
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
      <Representation id="a1" bandwidth="64000">
        <BaseURL>audio.mp4</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>
`;

// Test 360p limit
let res = limitDash(sampleMpd, '360');
assert.equal(res.changed, true);
assert.equal(res.selected, 360);
assert.equal(res.fallbackLowest, false);
assert.ok(res.text.includes('id="v180"'), 'Should keep 180p');
assert.ok(res.text.includes('id="v360"'), 'Should keep 360p');
assert.ok(!res.text.includes('id="v720"'), 'Should remove 720p');
assert.ok(res.text.includes('id="a1"'), 'Audio must remain untouched');

// Test 240p limit
res = limitDash(sampleMpd, '240');
assert.equal(res.changed, true);
assert.equal(res.selected, 180);
assert.ok(res.text.includes('id="v180"'), 'Should keep 180p');
assert.ok(!res.text.includes('id="v360"'), 'Should remove 360p');
assert.ok(!res.text.includes('id="v720"'), 'Should remove 720p');

// Test Portrait DASH (e.g. 360x640 mobile video)
const portraitMpd = sampleMpd
  .replace('320" height="180', '180" height="320')
  .replace('640" height="360', '360" height="640')
  .replace('1280" height="720', '720" height="1280');
res = limitDash(portraitMpd, '360');
assert.equal(res.selected, 360);
assert.ok(res.text.includes('id="v360"'));
assert.ok(!res.text.includes('id="v720"'));

// Test fallback to lowest when all streams exceed target (e.g. only 720p/1080p exist)
const highOnlyMpd = sampleMpd
  .replace('width="320" height="180"', 'width="1280" height="720"')
  .replace('id="v180"', 'id="v720"')
  .replace('width="640" height="360"', 'width="1920" height="1080"')
  .replace('id="v360"', 'id="v1080"')
  .replace('width="1280" height="720"', 'width="2560" height="1440"')
  .replace('id="v720"', 'id="v1440"');
res = limitDash(highOnlyMpd, '360');
assert.equal(res.changed, true);
assert.equal(res.selected, 720);
assert.equal(res.fallbackLowest, true);
assert.ok(res.text.includes('id="v720"'));
assert.ok(!res.text.includes('id="v1080"'));
assert.ok(!res.text.includes('id="v1440"'));

// Test Facebook FBQualityLabel attributes without width/height
const fbLabelMpd = `
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
  <Period>
    <AdaptationSet contentType="video">
      <Representation id="fb_sd" FBQualityLabel="360p" FBQualityClass="sd" bandwidth="500000">
        <BaseURL>360.mp4</BaseURL>
      </Representation>
      <Representation id="fb_hd" FBQualityLabel="720w" FBQualityClass="hd" bandwidth="2000000">
        <BaseURL>720.mp4</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;
res = limitDash(fbLabelMpd, '360');
assert.equal(res.changed, true);
assert.equal(res.selected, 360);
assert.ok(res.text.includes('id="fb_sd"'));
assert.ok(!res.text.includes('id="fb_hd"'));

// Test Single Representation Stream (e.g. video only encoded in 720p)
const singleMpd = `
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
  <Period>
    <AdaptationSet contentType="video">
      <Representation id="only720" width="720" height="1280" bandwidth="1500000">
        <BaseURL>720.mp4</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;
res = limitDash(singleMpd, '240');
assert.equal(res.changed, false);
assert.equal(res.singleStream, true);
assert.equal(res.selected, 720);

// Test embedded Facebook GraphQL JSON
const fbGraphqlJson = JSON.stringify({
  data: {
    video: {
      id: "9988776655",
      dash_manifest: sampleMpd
    }
  }
});
res = limitDash(fbGraphqlJson, '360');
assert.equal(res.changed, true);
assert.ok(res.text.includes('id=\\"v180\\"'));
assert.ok(res.text.includes('id=\\"v360\\"'));
assert.ok(!res.text.includes('id=\\"v720\\"'));
assert.ok(res.text.includes('id=\\"a1\\"'));

// Test auto quality returns unchanged
res = limitDash(sampleMpd, 'auto');
assert.equal(res.changed, false);
assert.equal(res.text, sampleMpd);

// Test Radio Mode (audio only)
res = limitDash(sampleMpd, 'audio');
assert.equal(res.changed, true);
assert.equal(res.selected, 'audio');
assert.ok(!res.text.includes('id="v180"'), 'Should remove all video representations');
assert.ok(!res.text.includes('id="v360"'), 'Should remove all video representations');
assert.ok(!res.text.includes('id="v720"'), 'Should remove all video representations');
assert.ok(res.text.includes('id="a1"'), 'Audio representation must remain intact');

console.log('PASS: DASH master filtering, portrait/landscape, lowest fallback, Radio Mode, FBQualityLabel, single stream, audio preservation, GraphQL JSON');
