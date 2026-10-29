/* TikTok video payload reducer. Pure code; no I/O.
 * Prunes high-bitrate variants in ByteDance XGPlayer bitrateInfo/bit_rate arrays
 * and redirects playAddr to the user's chosen stream resolution.
 */
(function (root) {
  'use strict';

  function parseGearResolution(gearName) {
    if (typeof gearName !== 'string') return null;
    const m = gearName.match(/(\d+)/);
    return m ? Number(m[1]) : null;
  }

  function parseResolution(item) {
    if (!item || typeof item !== 'object') return null;
    // 1. Direct width / height from PlayAddr or play_addr
    const addr = item.PlayAddr || item.play_addr || item.playAddr;
    if (addr && typeof addr === 'object') {
      const h = Number(addr.Height || addr.height);
      const w = Number(addr.Width || addr.width);
      if (h > 0 && w > 0) return Math.min(h, w);
    }
    // 2. Direct width / height on item
    const h = Number(item.Height || item.height);
    const w = Number(item.Width || item.width);
    if (h > 0 && w > 0) return Math.min(h, w);
    // 3. Gear name parsing (e.g. normal_1080_0, lower_540_0, 720p)
    const gear = String(item.GearName || item.gear_name || item.gearName || '');
    const m = parseGearResolution(gear);
    if (m) return m;
    // 4. QualityType mapping (TikTok internal: 10/12 -> 540p, 20 -> 720p, 30/32 -> 1080p)
    const qt = item.QualityType || item.quality_type;
    if (qt === 10 || qt === 12) return 540;
    if (qt === 20) return 720;
    if (qt === 30 || qt === 32) return 1080;
    // 5. Bitrate fallback estimation
    const bitrate = Number(item.Bitrate || item.bit_rate || item.bitrate) || 0;
    if (bitrate > 0) {
      if (bitrate <= 550000) return 360;
      if (bitrate <= 1300000) return 540;
      if (bitrate <= 2800000) return 720;
      return 1080;
    }
    return null;
  }

  function pruneVideoObject(videoObj, targetQuality) {
    if (!videoObj || typeof videoObj !== 'object') return { changed: false, selected: null };
    const target = Number(targetQuality) || 360;

    // Check bitrateInfo / bit_rate array
    const infoKey = Array.isArray(videoObj.bitrateInfo) ? 'bitrateInfo' :
                    (Array.isArray(videoObj.bit_rate) ? 'bit_rate' : null);

    if (infoKey) {
      const list = videoObj[infoKey];
      if (list.length > 1) {
        // Map representations
        const mapped = list.map(item => {
          const res = parseResolution(item) || 720;
          const bitrate = Number(item.Bitrate || item.bit_rate || item.bitrate) || 0;
          return { item, res, bitrate };
        });

        // Sort ascending by resolution then bitrate
        mapped.sort((a, b) => a.res - b.res || a.bitrate - b.bitrate);

        const eligible = mapped.filter(m => m.res <= target);
        let selected = null;
        let chosenItem = null;

        if (eligible.length > 0) {
          chosenItem = eligible[eligible.length - 1].item;
          selected = eligible[eligible.length - 1].res;
          const eligibleSet = new Set(eligible.map(e => e.item));
          videoObj[infoKey] = list.filter(item => eligibleSet.has(item));
        } else {
          // If all streams exceed target (e.g. target is 360p or 480p, but TikTok's lowest server
          // encode is 540p), lock to the absolute lowest stream variant available on ByteDance CDN.
          chosenItem = mapped[0].item;
          selected = mapped[0].res;
          videoObj[infoKey] = [mapped[0].item];
        }

        // Full metadata synchronization for ByteDance XGPlayer
        const chosenAddr = chosenItem.PlayAddr || chosenItem.play_addr || chosenItem.playAddr;
        const chosenUrls = chosenAddr?.UrlList || chosenAddr?.url_list || [];
        const chosenUrl = chosenUrls[0] || (typeof chosenAddr === 'string' ? chosenAddr : null);

        if (chosenUrl) {
          const addrKeys = [
            'playAddr', 'play_addr',
            'playAddrH264', 'play_addr_h264',
            'playAddrBytevc1', 'play_addr_bytevc1',
            'downloadAddr', 'download_addr'
          ];
          for (const key of addrKeys) {
            if (videoObj[key]) {
              if (typeof videoObj[key] === 'string') {
                videoObj[key] = chosenUrl;
              } else if (typeof videoObj[key] === 'object' && videoObj[key] !== null) {
                if (Array.isArray(videoObj[key].UrlList)) videoObj[key].UrlList = [...chosenUrls];
                if (Array.isArray(videoObj[key].url_list)) videoObj[key].url_list = [...chosenUrls];
                if (chosenAddr?.Uri) videoObj[key].Uri = chosenAddr.Uri;
                if (chosenAddr?.uri) videoObj[key].uri = chosenAddr.uri;
                if (chosenAddr?.UrlKey) videoObj[key].UrlKey = chosenAddr.UrlKey;
                if (chosenAddr?.FileHash) videoObj[key].FileHash = chosenAddr.FileHash;
                if (chosenAddr?.DataSize) videoObj[key].DataSize = chosenAddr.DataSize;
                if (chosenAddr?.Height) videoObj[key].Height = chosenAddr.Height;
                if (chosenAddr?.Width) videoObj[key].Width = chosenAddr.Width;
              }
            }
          }
        }

        // Update definition and bitrate headers on root video object
        if (chosenItem.GearName) videoObj.definition = chosenItem.GearName;
        else if (selected) videoObj.definition = `${selected}p`;
        if (selected) videoObj.ratio = `${selected}p`;
        if (chosenItem.Bitrate) videoObj.bitrate = chosenItem.Bitrate;

        return { changed: true, selected };
      }
    }
    return { changed: false, selected: null };
  }

  function pruneRecursive(node, targetQuality, depth = 0, seen = new WeakSet()) {
    if (!node || typeof node !== 'object' || depth > 25 || seen.has(node)) {
      return { changed: false, selected: null };
    }
    seen.add(node);
    let anyChanged = false;
    let lastSelected = null;

    if (node.video && typeof node.video === 'object') {
      const res = pruneVideoObject(node.video, targetQuality);
      if (res.changed) { anyChanged = true; lastSelected = res.selected; }
    } else if (node.bitrateInfo || node.bit_rate) {
      const res = pruneVideoObject(node, targetQuality);
      if (res.changed) { anyChanged = true; lastSelected = res.selected; }
    }

    // Traverse arrays and child objects with bounded depth 25
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (child && typeof child === 'object') {
        const sub = pruneRecursive(child, targetQuality, depth + 1, seen);
        if (sub.changed) {
          anyChanged = true;
          if (sub.selected) lastSelected = sub.selected;
        }
      }
    }

    return { changed: anyChanged, selected: lastSelected };
  }

  function limitTikTok(src, quality) {
    const target = Number(quality);
    if (![240, 360, 480, 540, 720].includes(target)) return { text: src, changed: false };

    let isJson = false;
    let data = null;

    if (typeof src === 'string') {
      if (!src.includes('bitrateInfo') && !src.includes('bit_rate') && !src.includes('playAddr') && !src.includes('play_addr')) {
        return { text: src, changed: false };
      }
      try {
        data = JSON.parse(src);
        isJson = true;
      } catch (_) {
        return { text: src, changed: false };
      }
    } else if (typeof src === 'object' && src !== null) {
      data = src;
    } else {
      return { text: src, changed: false };
    }

    const { changed, selected } = pruneRecursive(data, target);
    return {
      text: isJson ? JSON.stringify(data) : data,
      changed,
      selected
    };
  }

  const api = { parseGearResolution, parseResolution, pruneVideoObject, limitTikTok };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.QuotaGuardTikTok = api;
})(globalThis);
