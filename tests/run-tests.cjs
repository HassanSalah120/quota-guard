'use strict';
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const tests = ['test.cjs', 'youtube-test.cjs', 'tiktok-test.cjs', 'hls-test.cjs', 'dash-test.cjs',
  'stream-hook-test.cjs', 'background-test.cjs', 'media-bytes-test.cjs', 'popup_smoke_test.mjs', 'real_browser_test.mjs'];
for (const test of tests) {
  console.log('\nnode tests/' + test);
  const result = spawnSync(process.execPath, [path.join(__dirname, test)], {cwd: path.join(__dirname, '..'), stdio: 'inherit'});
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('\nPASS: All 10 test scripts');
