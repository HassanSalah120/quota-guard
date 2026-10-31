/* HLS master playlist reducer. Pure code; no I/O. */
(function (root) {
  'use strict';
  function parseVariants(src) {
    if (typeof src !== 'string' || !src.startsWith('#EXTM3U') || !src.includes('#EXT-X-STREAM-INF:')) return [];
    const lines = src.split(/\r?\n/);
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^#EXT-X-STREAM-INF:/i.test(lines[i])) continue;
      let next = i + 1;
      while (next < lines.length && lines[next].startsWith('#')) next++;
      if (next >= lines.length || !lines[next].trim()) continue;
      const attrs = lines[i];
      const dimensions = attrs.match(/(?:^|[:,])RESOLUTION=(\d+)x(\d+)/i);
      const bandwidth = attrs.match(/(?:^|[:,])BANDWIDTH=(\d+)/i);
      const bw = bandwidth ? Number(bandwidth[1]) : null;
      let pixels = dimensions ? Math.min(+dimensions[1], +dimensions[2]) : null;
      if (pixels === null && bw) {
        // Fallback resolution estimation from bandwidth for unlabelled streams
        pixels = bw <= 450000 ? 240 : (bw <= 1100000 ? 360 : (bw <= 2200000 ? 480 : 720));
      }
      out.push({
        start: i, end: next, uri: lines[next].trim(),
        // Portrait X video 360x640 is 360p for our bandwidth purpose.
        pixels,
        bandwidth: bw
      });
    }
    return out;
  }
  function limit(src, quality) {
    const target = Number(quality);
    if (![240, 360, 480, 540, 720].includes(target)) return {text: src, changed: false};
    const variants = parseVariants(src);
    // Only process playlists that contain at least 2 video variants with dimensions
    const videoVariants = variants.filter(v => v.uri && v.pixels !== null);
    if (videoVariants.length < 2) return {text: src, changed: false};

    const sorted = [...videoVariants].sort((a,b) => a.pixels - b.pixels || (a.bandwidth ?? Infinity) - (b.bandwidth ?? Infinity));
    const eligible = sorted.filter(v => v.pixels <= target);
    const bestSize = eligible.length ? eligible[eligible.length - 1].pixels : sorted[0].pixels;
    // At a given resolution choose its lowest-bandwidth version.
    const picked = sorted.filter(v => v.pixels === bestSize)
      .sort((a,b) => (a.bandwidth ?? Infinity) - (b.bandwidth ?? Infinity))[0];
    const remove = new Set();
    for (const v of videoVariants) {
      if (v === picked) continue;
      for (let i = v.start; i <= v.end; i++) remove.add(i);
    }
    const result = src.split(/\r?\n/).filter((_,i) => !remove.has(i)).join(src.includes('\r\n') ? '\r\n' : '\n');
    return {text: result, changed: true, selected: picked.pixels, available: videoVariants.length};
  }
  root.QuotaGuardHls = {parseVariants, limit};
})(globalThis);
