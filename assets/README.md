# QuotaGuard media — v1.3.1

All images match the current charcoal/mint interface. No personal browsing screenshots are included.

- `branding/`: transparent SVG shield and logo, PNG icons at 16/32/48/128/256/512 px, 800×200 logo, and 1280×640 repository banner.
- `screenshots/`: actual popup HTML/CSS captured at 2× (800×1014), using explicitly controlled example playback states. The 360p and 540p readings illustrate the UI; they are not evidence from authenticated platform feeds. Audio only is shown as requested, not verified.
- `screenshots/on-video-pill.png`: real 640×360 test recording displayed by Chromium, captured at 2×. The chip shows bytes appended to that video's MediaSource buffers. `player-chip.png` is a close-up. A tiny synthetic recording explains the KB reading; it is not a typical video-size claim. Exact bytes may vary between recordings.
- `cws/`: four 1280×800 feature screenshots, a 440×280 promotional tile, and a 1400×560 marquee. These are prepared listing assets; they do not imply a store listing or endorsement.

Reproduce from the repository root with Node.js 22+ and a compatible Chromium browser (Microsoft Edge on Windows by default):

```powershell
node scripts/generate_branding.mjs
node scripts/capture_screenshots.mjs
node scripts/generate_cws_assets.mjs
```

`QG_BROWSER_PATH` can select another Chromium executable. Capture uses an isolated temporary browser profile and controlled status fixtures. The player capture runs the existing 22 browser integration checks. Native toolbar sizing is checked separately by `node tests/popup_smoke_test.mjs`.

Assets are covered by the repository's MIT license.
