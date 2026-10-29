/* Pure reducer for YouTube InnerTube streamingData & Player Quality API.
 * Intercepts /youtubei/v1/player JSON responses, prunes high-resolution
 * video formats from streamingData (adaptiveFormats & formats), and preserves audio.
 * Provides helper mappings for the HTML5 Player API (setPlaybackQualityRange).
 */
(() => {
  'use strict';

  const QUALITY_MAP = {
    tiny: 144,
    small: 240,
    medium: 360,
    large: 480,
    hd720: 720,
    hd1080: 1080,
    hd1440: 1440,
    hd2160: 2160,
    highres: 4320
  };

  const REVERSE_MAP = [
    { max: 144, label: 'tiny' },
    { max: 240, label: 'small' },
    { max: 360, label: 'medium' },
    { max: 480, label: 'large' },
    { max: 720, label: 'hd720' },
    { max: 1080, label: 'hd1080' },
    { max: 1440, label: 'hd1440' },
    { max: 2160, label: 'hd2160' }
  ];

  function parseQualityLabel(label, height, qualityName) {
    if (typeof height === 'number' && height > 0) return height;
    if (typeof label === 'string') {
      const m = label.match(/(\d+)p?/i);
      if (m) return parseInt(m[1], 10);
    }
    if (typeof qualityName === 'string' && QUALITY_MAP[qualityName]) {
      return QUALITY_MAP[qualityName];
    }
    return null;
  }

  function getQualityString(numericQuality) {
    const num = typeof numericQuality === 'number' ? numericQuality : parseInt(numericQuality, 10);
    if (!num || isNaN(num)) return 'medium';
    for (const entry of REVERSE_MAP) {
      if (num <= entry.max) return entry.label;
    }
    return 'hd1080';
  }

  function pickBestQualityLevel(availableLevels, targetQuality) {
    if (!Array.isArray(availableLevels) || availableLevels.length === 0) return 'medium';
    const maxNum = typeof targetQuality === 'number' ? targetQuality : parseInt(targetQuality, 10) || 360;

    // Filter out 'auto'
    const validLevels = availableLevels.filter(lvl => lvl !== 'auto' && QUALITY_MAP[lvl]);
    if (validLevels.length === 0) return availableLevels[0] || 'medium';

    // Sort by resolution descending
    validLevels.sort((a, b) => QUALITY_MAP[b] - QUALITY_MAP[a]);

    // Find the highest available that is <= target
    for (const lvl of validLevels) {
      if (QUALITY_MAP[lvl] <= maxNum) return lvl;
    }

    // Fallback to lowest available on server
    return validLevels[validLevels.length - 1];
  }

  function limitYouTubeStreamingData(dataOrJson, targetQuality) {
    const isString = typeof dataOrJson === 'string';
    if (!dataOrJson || (targetQuality === 'auto')) {
      return { text: isString ? dataOrJson : JSON.stringify(dataOrJson), changed: false, selected: null };
    }

    let payload;
    if (isString) {
      try {
        payload = JSON.parse(dataOrJson);
      } catch (_) {
        return { text: dataOrJson, changed: false, selected: null };
      }
    } else {
      payload = dataOrJson;
    }

    if (!payload || typeof payload !== 'object') {
      return { text: isString ? dataOrJson : JSON.stringify(dataOrJson), changed: false, selected: null };
    }

    const streaming = payload.streamingData;
    if (!streaming || typeof streaming !== 'object') {
      return { text: isString ? dataOrJson : JSON.stringify(payload), data: payload, changed: false, selected: null };
    }

    const isAudioOnly = targetQuality === 'audio';
    const maxResolution = isAudioOnly ? 0 : (parseInt(targetQuality, 10) || 360);
    let changed = false;
    let selectedRes = null;
    let fallbackLowest = false;

    // 1. Process adaptiveFormats (Separate DASH Video & Audio streams)
    if (Array.isArray(streaming.adaptiveFormats) && streaming.adaptiveFormats.length > 0) {
      const audioStreams = [];
      const videoStreams = [];

      for (const fmt of streaming.adaptiveFormats) {
        const mime = (fmt.mimeType || '').toLowerCase();
        const isAudio = mime.startsWith('audio/') || (fmt.audioQuality && !fmt.width && !fmt.height);
        if (isAudio) {
          audioStreams.push(fmt);
        } else {
          const res = parseQualityLabel(fmt.qualityLabel, fmt.height, fmt.quality);
          videoStreams.push({ fmt, res: res || 9999 });
        }
      }

      if (isAudioOnly && audioStreams.length > 0) {
        // Radio Mode: Strip all video streams, keeping ONLY audio streams
        streaming.adaptiveFormats = audioStreams;
        selectedRes = 'audio';
        changed = true;
      } else if (videoStreams.length > 0) {
        // Filter video streams <= maxResolution
        let allowedVideos = videoStreams.filter(v => v.res <= maxResolution);

        if (allowedVideos.length === 0) {
          // If all streams are above target, keep the lowest available
          videoStreams.sort((a, b) => a.res - b.res);
          allowedVideos = [videoStreams[0]];
          selectedRes = videoStreams[0].res;
          fallbackLowest = true;
          changed = true;
        } else {
          if (allowedVideos.length < videoStreams.length) {
            changed = true;
          }
          allowedVideos.sort((a, b) => b.res - a.res);
          selectedRes = allowedVideos[0].res;
        }

        streaming.adaptiveFormats = allowedVideos.map(v => v.fmt).concat(audioStreams);
      }
    }

    // 2. Process combined progressive formats
    if (Array.isArray(streaming.formats) && streaming.formats.length > 0) {
      if (isAudioOnly) {
        // Radio Mode: Remove all progressive video formats
        streaming.formats = [];
        changed = true;
      } else {
        const origCount = streaming.formats.length;
        const allowedProg = streaming.formats.filter(fmt => {
          const res = parseQualityLabel(fmt.qualityLabel, fmt.height, fmt.quality);
          return res ? res <= maxResolution : true;
        });

        if (allowedProg.length < origCount) {
          streaming.formats = allowedProg;
          changed = true;
        }
      }
    }

    return {
      text: isString ? JSON.stringify(payload) : JSON.stringify(payload),
      data: payload,
      changed,
      selected: selectedRes || maxResolution,
      fallbackLowest
    };
  }

  const api = {
    QUALITY_MAP,
    REVERSE_MAP,
    parseQualityLabel,
    getQualityString,
    pickBestQualityLevel,
    limitYouTubeStreamingData
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.QuotaGuardYouTube = api;
  }
})();
