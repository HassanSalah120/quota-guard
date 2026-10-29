'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const dir = path.join(__dirname, '..');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(dir, 'tiktok-quality.js'), 'utf8'), context);

const { parseGearResolution, limitTikTok } = context.QuotaGuardTikTok;

// Test GearName resolution extraction
assert.equal(parseGearResolution('normal_1080_0'), 1080);
assert.equal(parseGearResolution('normal_720_0'), 720);
assert.equal(parseGearResolution('lower_540_0'), 540);
assert.equal(parseGearResolution('lowest_360_0'), 360);
assert.equal(parseGearResolution('adapt_lower_720_1'), 720);
assert.equal(parseGearResolution(null), null);

// Sample TikTok API feed response with camelCase bitrateInfo
const sampleTikTokFeed = {
  itemList: [
    {
      id: "7123456789",
      video: {
        playAddr: "https://v16-webapp-prime.tiktok.com/video/tos/default_1080.mp4",
        bitrateInfo: [
          {
            GearName: "lowest_360_0",
            Bitrate: 450000,
            PlayAddr: { UrlList: ["https://v16.tiktok.com/video/360.mp4"] }
          },
          {
            GearName: "lower_540_0",
            Bitrate: 1100000,
            PlayAddr: { UrlList: ["https://v16.tiktok.com/video/540.mp4"] }
          },
          {
            GearName: "normal_720_0",
            Bitrate: 2500000,
            PlayAddr: { UrlList: ["https://v16.tiktok.com/video/720.mp4"] }
          },
          {
            GearName: "normal_1080_0",
            Bitrate: 8300000,
            PlayAddr: { UrlList: ["https://v16.tiktok.com/video/1080.mp4"] }
          }
        ]
      }
    }
  ]
};

// Test 360p limit on JSON string
const jsonString = JSON.stringify(sampleTikTokFeed);
let res = limitTikTok(jsonString, '360');
assert.equal(res.changed, true);
assert.equal(res.selected, 360);

const parsed = JSON.parse(res.text);
const vid = parsed.itemList[0].video;
assert.equal(vid.bitrateInfo.length, 1);
assert.equal(vid.bitrateInfo[0].GearName, 'lowest_360_0');
assert.equal(vid.playAddr, 'https://v16.tiktok.com/video/360.mp4');

// Test 480p limit (should keep 360p variant as highest <= 480)
res = limitTikTok(jsonString, '480');
assert.equal(res.changed, true);
assert.equal(res.selected, 360);

// Test snake_case bit_rate structure
const snakeCaseFeed = {
  aweme_list: [
    {
      aweme_id: "888",
      video: {
        play_addr: { url_list: ["https://v16.tiktok.com/default.mp4"] },
        bit_rate: [
          {
            gear_name: "normal_720_0",
            bit_rate: 2200000,
            play_addr: { url_list: ["https://v16.tiktok.com/720.mp4"] }
          },
          {
            gear_name: "lowest_360_0",
            bit_rate: 400000,
            play_addr: { url_list: ["https://v16.tiktok.com/360.mp4"] }
          }
        ]
      }
    }
  ]
};

res = limitTikTok(JSON.stringify(snakeCaseFeed), '360');
assert.equal(res.changed, true);
assert.equal(res.selected, 360);
const parsedSnake = JSON.parse(res.text);
assert.equal(parsedSnake.aweme_list[0].video.bit_rate.length, 1);
assert.equal(parsedSnake.aweme_list[0].video.play_addr.url_list[0], 'https://v16.tiktok.com/360.mp4');

// Test fallback to lowest when all streams exceed target (e.g. only 720p & 1080p exist)
const hdOnlyFeed = {
  video: {
    playAddr: "https://v16.tiktok.com/hd.mp4",
    bitrateInfo: [
      { GearName: "normal_720_0", Bitrate: 2000000, PlayAddr: { UrlList: ["https://v16.tiktok.com/720.mp4"] } },
      { GearName: "normal_1080_0", Bitrate: 8000000, PlayAddr: { UrlList: ["https://v16.tiktok.com/1080.mp4"] } }
    ]
  }
};
res = limitTikTok(JSON.stringify(hdOnlyFeed), '360');
assert.equal(res.changed, true);
assert.equal(res.selected, 720); // Fallback to lowest available (720)
const parsedHd = JSON.parse(res.text);
assert.equal(parsedHd.video.bitrateInfo.length, 1);
assert.equal(parsedHd.video.playAddr, 'https://v16.tiktok.com/720.mp4');

// Test TikTok real-world resolution ladder (540p lowest on ByteDance CDN) and metadata synchronization
const realTikTokLadder = {
  data: {
    userVideos: {
      items: [
        {
          itemStruct: {
            id: 'real_tiktok_1',
            video: {
              id: 'real_tiktok_1',
              playAddr: {
                Height: 1920, Width: 1080, Uri: 'uri_1080', UrlKey: 'urlkey_1080',
                UrlList: ['https://v16-web.tiktokcdn.com/1080p.mp4']
              },
              bitrateInfo: [
                {
                  GearName: 'normal_1080_0', Bitrate: 2200000,
                  PlayAddr: { Height: 1920, Width: 1080, Uri: 'uri_1080', UrlKey: 'urlkey_1080', UrlList: ['https://v16-web.tiktokcdn.com/1080p.mp4'] }
                },
                {
                  GearName: 'normal_720_0', Bitrate: 1400000,
                  PlayAddr: { Height: 1280, Width: 720, Uri: 'uri_720', UrlKey: 'urlkey_720', UrlList: ['https://v16-web.tiktokcdn.com/720p.mp4'] }
                },
                {
                  GearName: 'lower_540_0', Bitrate: 650000,
                  PlayAddr: { Height: 960, Width: 540, Uri: 'uri_540', UrlKey: 'urlkey_540', UrlList: ['https://v16-web.tiktokcdn.com/540p.mp4'] }
                }
              ]
            }
          }
        }
      ]
    }
  }
};

const ladderRes = limitTikTok(JSON.stringify(realTikTokLadder), '360');
assert.equal(ladderRes.changed, true);
assert.equal(ladderRes.selected, 540, 'Must lock to 540p as lowest available TikTok transcode');
const ladderParsed = JSON.parse(ladderRes.text);
const realVid = ladderParsed.data.userVideos.items[0].itemStruct.video;
assert.equal(realVid.bitrateInfo.length, 1, 'Must prune out 1080p and 720p');
assert.equal(realVid.bitrateInfo[0].GearName, 'lower_540_0');
assert.equal(realVid.playAddr.Uri, 'uri_540', 'Must sync Uri to 540p stream');
assert.equal(realVid.playAddr.UrlKey, 'urlkey_540', 'Must sync UrlKey to 540p stream');
assert.equal(realVid.playAddr.Height, 960, 'Must sync Height to 540p dimensions');
assert.equal(realVid.playAddr.UrlList[0], 'https://v16-web.tiktokcdn.com/540p.mp4');

console.log('PASS: TikTok bitrateInfo/bit_rate pruning, gear resolution parsing, playAddr redirection, and fallback');
