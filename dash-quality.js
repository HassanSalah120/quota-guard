/* DASH MPD manifest reducer. Pure code; no I/O.
 * Supports standalone MPD XML and embedded JSON DASH manifests (e.g. Facebook GraphQL).
 * Handles standard dimensions, Facebook FBQualityLabel (e.g. 360p, 720w), FBQualityClass (sd/hd),
 * and bandwidth-based variant pruning.
 */
(function (root) {
  'use strict';

  function parseRepresentations(src) {
    if (typeof src !== 'string' || (!src.includes('<MPD') && !src.includes('dash_manifest'))) return [];
    // Match <Representation ...>...</Representation> or self-closing <Representation .../>
    // Works on both standard XML and JSON-escaped XML.
    const repRegex = /<Representation\b([\s\S]*?)(?:>([\s\S]*?)<\/Representation>|\/>)/gi;
    const reps = [];
    let match;
    while ((match = repRegex.exec(src)) !== null) {
      const rawAttrs = match[1];

      // Audio representations never have video dimensions or video quality tags
      const isAudio = /(?:audio|mimeType\s*=\s*(?:["']|\\")audio|codecs\s*=\s*(?:["']|\\")mp4a|audioSamplingRate)/i.test(rawAttrs);
      if (isAudio) continue;

      const widthMatch = rawAttrs.match(/(?:width|\\\"width\\\")\s*=\s*(?:["']|\\")(\d+)(?:["']|\\")/i);
      const heightMatch = rawAttrs.match(/(?:height|\\\"height\\\")\s*=\s*(?:["']|\\")(\d+)(?:["']|\\")/i);
      const bwMatch = rawAttrs.match(/(?:bandwidth|\\\"bandwidth\\\")\s*=\s*(?:["']|\\")(\d+)(?:["']|\\")/i);
      const idMatch = rawAttrs.match(/(?:id|\\\"id\\\")\s*=\s*(?:["']|\\")([^"'\\]+)(?:["']|\\")/i);

      // Facebook-specific quality tags
      const labelMatch = rawAttrs.match(/(?:FBQualityLabel|fb_quality_label|\\\"FBQualityLabel\\\"|\\\"fb_quality_label\\\")\s*=\s*(?:["']|\\")(\d+)[pw](?:["']|\\")/i);
      const classMatch = rawAttrs.match(/(?:FBQualityClass|fb_quality_class|\\\"FBQualityClass\\\"|\\\"fb_quality_class\\\")\s*=\s*(?:["']|\\")([a-z]+)(?:["']|\\")/i);

      const width = widthMatch ? Number(widthMatch[1]) : null;
      const height = heightMatch ? Number(heightMatch[1]) : null;
      const bandwidth = bwMatch ? Number(bwMatch[1]) : null;
      const id = idMatch ? idMatch[1] : `rep_${match.index}`;

      let pixels = null;
      if (width && height) {
        pixels = Math.min(width, height);
      } else if (labelMatch) {
        pixels = Number(labelMatch[1]);
      } else if (classMatch) {
        pixels = classMatch[1].toLowerCase() === 'hd' ? 720 : 360;
      } else if (bandwidth && /(?:video|codecs\s*=\s*(?:["']|\\")(?:avc|vp|hev)|frameRate|sar|par)/i.test(rawAttrs)) {
        // Fallback resolution estimation from bandwidth for unlabelled video tracks
        pixels = bandwidth <= 450000 ? 240 : (bandwidth <= 1100000 ? 360 : (bandwidth <= 2200000 ? 480 : 720));
      }

      // Only video representations have dimensions or video quality tags
      if (pixels !== null) {
        reps.push({
          start: match.index,
          end: match.index + match[0].length,
          full: match[0],
          id,
          width,
          height,
          pixels,
          bandwidth
        });
      }
    }
    return reps;
  }

  function limitDash(src, quality) {
    const isAudioOnly = quality === 'audio';
    const target = Number(quality);
    if (!isAudioOnly && ![240, 360, 480].includes(target)) return { text: src, changed: false };
    if (typeof src !== 'string' || (!src.includes('<MPD') && !src.includes('dash_manifest'))) {
      return { text: src, changed: false };
    }

    const reps = parseRepresentations(src);
    if (isAudioOnly) {
      if (reps.length === 0) return { text: src, changed: false, selected: 'audio' };
      let result = src;
      const toRemove = [...reps].sort((a, b) => b.start - a.start);
      for (const item of toRemove) {
        result = result.slice(0, item.start) + result.slice(item.end);
      }
      return { text: result, changed: true, selected: 'audio' };
    }
    if (reps.length < 2) {
      // Single representation stream (e.g. video only encoded in 720p by Facebook)
      const singleRes = reps[0]?.pixels || null;
      return { text: src, changed: false, singleStream: true, selected: singleRes };
    }

    // Sort by resolution ascending, then bandwidth ascending
    const sorted = [...reps].sort((a, b) => a.pixels - b.pixels || (a.bandwidth ?? 0) - (b.bandwidth ?? 0));
    const eligible = sorted.filter(r => r.pixels <= target);

    const keepIds = new Set();
    let selected = null;
    let fallbackLowest = false;

    if (eligible.length > 0) {
      // Keep all representations at or below target resolution
      eligible.forEach(r => keepIds.add(r.id));
      selected = eligible[eligible.length - 1].pixels;
    } else {
      // If none match target, keep the single lowest available representation to prevent HD streaming
      keepIds.add(sorted[0].id);
      selected = sorted[0].pixels;
      fallbackLowest = true;
    }

    const toRemove = reps.filter(r => !keepIds.has(r.id));
    if (toRemove.length === 0) return { text: src, changed: false, selected, fallbackLowest };

    // Remove high-resolution representations from back to front to preserve string indices
    let result = src;
    toRemove.sort((a, b) => b.start - a.start);
    for (const item of toRemove) {
      result = result.slice(0, item.start) + result.slice(item.end);
    }

    return {
      text: result,
      changed: true,
      selected,
      fallbackLowest,
      available: reps.length,
      kept: keepIds.size
    };
  }

  root.QuotaGuardDash = { parseRepresentations, limitDash };
})(globalThis);
