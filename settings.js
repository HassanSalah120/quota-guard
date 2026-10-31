/* Shared configuration and statistics for popup, worker and content scripts. */
(function (root) {
  'use strict';
  const DEFAULT_SITE = Object.freeze({
    enabled: true,
    stopAutoplay: true,
    preventPreload: true,
    pauseOffscreen: true,
    quality: '360',
    strictBlock: false
  });

  const DEFAULT_STATS = Object.freeze({
    videosCapped: 0,
    autoplaysBlocked: 0
  });

  const DEFAULTS = Object.freeze({
    facebook: {...DEFAULT_SITE},
    x: {...DEFAULT_SITE},
    tiktok: {...DEFAULT_SITE, quality: '540'},
    youtube: {...DEFAULT_SITE}
  });

  const SITE_NAMES = { facebook: 'Facebook', x: 'X (Twitter)', tiktok: 'TikTok', youtube: 'YouTube' };
  const QUALITY_OPTIONS = {
    facebook: ['240', '360', '480', 'audio', 'auto'],
    x: ['240', '360', '480', 'auto'],
    tiktok: ['540', '720', 'auto'],
    youtube: ['240', '360', '480', 'audio', 'auto']
  };
  const CAPABILITIES = {
    facebook: {playbackControls: true},
    x: {playbackControls: true},
    tiktok: {playbackControls: true},
    youtube: {playbackControls: false}
  };

  function normalize(raw) {
    return Object.fromEntries(Object.keys(DEFAULTS).map(site => {
      const input = raw?.[site] || {};
      const value = {...DEFAULTS[site]};
      for (const key of ['enabled', 'stopAutoplay', 'preventPreload', 'pauseOffscreen', 'strictBlock']) {
        if (typeof input[key] === 'boolean') value[key] = input[key];
      }
      let quality = String(input.quality ?? value.quality);
      // Repair the previous popup's mislabeled TikTok option values.
      if (site === 'tiktok') {
        if (quality === '480') quality = '720';
        if (quality === '240' || quality === '360') quality = '540';
      }
      if (QUALITY_OPTIONS[site].includes(quality)) value.quality = quality;
      return [site, value];
    }));
  }

  function normalizeStats(raw) {
    const out = {};
    for (const site of Object.keys(DEFAULTS)) {
      out[site] = {};
      for (const field of Object.keys(DEFAULT_STATS)) {
        const value = raw?.[site]?.[field];
        out[site][field] = Number.isSafeInteger(value) && value >= 0 ? value : 0;
      }
    }
    return out;
  }

  function siteForHost(hostname) {
    const h = String(hostname || '').toLowerCase();
    if (h === 'facebook.com' || h.endsWith('.facebook.com')) return 'facebook';
    if (h === 'x.com' || h.endsWith('.x.com') || h === 'twitter.com' || h.endsWith('.twitter.com')) return 'x';
    if (h === 'tiktok.com' || h.endsWith('.tiktok.com')) return 'tiktok';
    if (h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be') return 'youtube';
    return null;
  }

  root.QuotaGuard = { DEFAULTS, DEFAULT_STATS, SITE_NAMES, QUALITY_OPTIONS, CAPABILITIES, normalize, normalizeStats, siteForHost };
})(globalThis);
