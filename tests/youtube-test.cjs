'use strict';
const assert = require('assert');
const path = require('path');
const YT = require(path.join(__dirname, '..', 'youtube-quality.js'));

// 1. Quality Label & Height Parsing
assert.equal(YT.parseQualityLabel('360p', null), 360);
assert.equal(YT.parseQualityLabel('720p60 HD', null), 720);
assert.equal(YT.parseQualityLabel('1080p Premium', null), 1080);
assert.equal(YT.parseQualityLabel(null, 480), 480);
assert.equal(YT.parseQualityLabel(null, null, 'small'), 240);
assert.equal(YT.parseQualityLabel(null, null, 'medium'), 360);
assert.equal(YT.parseQualityLabel(null, null, 'hd720'), 720);

// 2. YouTube Quality String Mappings
assert.equal(YT.getQualityString(144), 'tiny');
assert.equal(YT.getQualityString(240), 'small');
assert.equal(YT.getQualityString(360), 'medium');
assert.equal(YT.getQualityString(480), 'large');
assert.equal(YT.getQualityString(720), 'hd720');
assert.equal(YT.getQualityString(1080), 'hd1080');

// 3. pickBestQualityLevel
const sampleLevels = ['hd1080', 'hd720', 'large', 'medium', 'small', 'tiny', 'auto'];
assert.equal(YT.pickBestQualityLevel(sampleLevels, '360'), 'medium');
assert.equal(YT.pickBestQualityLevel(sampleLevels, '240'), 'small');
assert.equal(YT.pickBestQualityLevel(sampleLevels, '480'), 'large');
assert.equal(YT.pickBestQualityLevel(['hd1080', 'hd720'], '360'), 'hd720', 'Should fallback to lowest available');

// 4. limitYouTubeStreamingData
const mockPayload = {
  responseContext: {},
  streamingData: {
    formats: [
      { itag: 18, width: 640, height: 360, qualityLabel: '360p' },
      { itag: 22, width: 1280, height: 720, qualityLabel: '720p' }
    ],
    adaptiveFormats: [
      { itag: 134, width: 640, height: 360, qualityLabel: '360p', mimeType: 'video/mp4; codecs="avc1.4d401e"' },
      { itag: 136, width: 1280, height: 720, qualityLabel: '720p', mimeType: 'video/mp4; codecs="avc1.4d401f"' },
      { itag: 137, width: 1920, height: 1080, qualityLabel: '1080p', mimeType: 'video/mp4; codecs="avc1.640028"' },
      { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', audioQuality: 'AUDIO_QUALITY_MEDIUM' },
      { itag: 251, mimeType: 'audio/webm; codecs="opus"', audioQuality: 'AUDIO_QUALITY_MEDIUM' }
    ]
  }
};

// Capping to 360p
const result360 = YT.limitYouTubeStreamingData(JSON.stringify(mockPayload), '360');
assert.equal(result360.changed, true);
assert.equal(result360.selected, 360);
const parsed360 = JSON.parse(result360.text);
assert.equal(parsed360.streamingData.formats.length, 1);
assert.equal(parsed360.streamingData.formats[0].qualityLabel, '360p');

// Verify video formats in adaptiveFormats: only 360p kept, 720p & 1080p stripped
const adaptiveVideos = parsed360.streamingData.adaptiveFormats.filter(f => f.mimeType.startsWith('video/'));
assert.equal(adaptiveVideos.length, 1);
assert.equal(adaptiveVideos[0].qualityLabel, '360p');

// Verify audio formats are fully preserved
const adaptiveAudios = parsed360.streamingData.adaptiveFormats.filter(f => f.mimeType.startsWith('audio/'));
assert.equal(adaptiveAudios.length, 2);

// Auto setting (no-op)
const autoResult = YT.limitYouTubeStreamingData(JSON.stringify(mockPayload), 'auto');
assert.equal(autoResult.changed, false);

// Fallback to lowest when all streams are above cap
const highOnlyPayload = {
  streamingData: {
    adaptiveFormats: [
      { itag: 136, width: 1280, height: 720, qualityLabel: '720p', mimeType: 'video/mp4' },
      { itag: 137, width: 1920, height: 1080, qualityLabel: '1080p', mimeType: 'video/mp4' },
      { itag: 140, mimeType: 'audio/mp4' }
    ]
  }
};
const fallbackResult = YT.limitYouTubeStreamingData(JSON.stringify(highOnlyPayload), '360');
assert.equal(fallbackResult.changed, true);
assert.equal(fallbackResult.fallbackLowest, true);
assert.equal(fallbackResult.selected, 720);
const parsedFallback = JSON.parse(fallbackResult.text);
const keptVideos = parsedFallback.streamingData.adaptiveFormats.filter(f => f.mimeType.startsWith('video/'));
assert.equal(keptVideos.length, 1);
assert.equal(keptVideos[0].qualityLabel, '720p');

// Radio Mode (Sound only)
const radioResult = YT.limitYouTubeStreamingData(JSON.stringify(mockPayload), 'audio');
assert.equal(radioResult.changed, true);
assert.equal(radioResult.selected, 'audio');
const parsedRadio = JSON.parse(radioResult.text);
assert.equal(parsedRadio.streamingData.formats.length, 0, 'Must strip all progressive formats');
const radioVideos = parsedRadio.streamingData.adaptiveFormats.filter(f => f.mimeType.startsWith('video/'));
assert.equal(radioVideos.length, 0, 'Must strip all video formats in radio mode');
const radioAudios = parsedRadio.streamingData.adaptiveFormats.filter(f => f.mimeType.startsWith('audio/'));
assert.equal(radioAudios.length, 2, 'Must keep all audio formats');

console.log('PASS: YouTube adaptiveFormats pruning, resolution parsing, audio preservation, Radio Mode, and quality mappings');
