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
          const gear = item.GearName || item.gear_name || item.gearName || '';
          const bitrate = item.Bitrate || item.bit_rate || item.bitrate || 0;
          let res = parseGearResolution(gear);
          if (!res) {
            // Fallback resolution estimation from bitrate
            res = bitrate <= 550000 ? 360 : (bitrate <= 1300000 ? 540 : (bitrate <= 2800000 ? 720 : 1080));
          }
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
          // If all streams exceed target, keep the lowest available
          chosenItem = mapped[0].item;
          selected = mapped[0].res;
          videoObj[infoKey] = [mapped[0].item];
        }

        // Redirect primary playAddr / play_addr to the chosen stream variant's URL
        const chosenUrl = (chosenItem.PlayAddr?.UrlList?.[0] ||
                           chosenItem.play_addr?.url_list?.[0] ||
                           chosenItem.PlayAddr?.urlList?.[0] ||
                           chosenItem.play_addr?.UrlList?.[0]);

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
                if (Array.isArray(videoObj[key].UrlList)) videoObj[key].UrlList = [chosenUrl];
                if (Array.isArray(videoObj[key].url_list)) videoObj[key].url_list = [chosenUrl];
              }
            }
          }
        }

        return { changed: true, selected };
      }
    }
    return { changed: false, selected: null };
  }

  function pruneRecursive(node, targetQuality, depth = 0, seen = new WeakSet()) {
    if (!node || typeof node !== 'object' || depth > 8 || seen.has(node)) {
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

    // Traverse arrays and child objects with bounded depth
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
    if (![240, 360, 480].includes(target)) return { text: src, changed: false };

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

  root.QuotaGuardTikTok = { parseGearResolution, pruneVideoObject, limitTikTok };
})(globalThis);
