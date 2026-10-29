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
    autoplaysBlocked: 0,
    mbSavedEst: 0
  });

  const DEFAULTS = Object.freeze({
    facebook: {...DEFAULT_SITE},
    x: {...DEFAULT_SITE},
    tiktok: {...DEFAULT_SITE},
    youtube: {...DEFAULT_SITE}
  });

  const SITE_NAMES = { facebook: 'Facebook', x: 'X (Twitter)', tiktok: 'TikTok', youtube: 'YouTube' };

  function normalize(raw) {
    return Object.fromEntries(Object.keys(DEFAULTS).map(site => [site, {
      ...DEFAULTS[site],
      ...(raw && typeof raw[site] === 'object' && raw[site] !== null ? raw[site] : {})
    }]));
  }

  function normalizeStats(raw) {
    const out = {};
    for (const site of Object.keys(DEFAULTS)) {
      out[site] = {
        ...DEFAULT_STATS,
        ...(raw && typeof raw[site] === 'object' && raw[site] !== null ? raw[site] : {})
      };
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

  root.QuotaGuard = { DEFAULTS, DEFAULT_STATS, SITE_NAMES, normalize, normalizeStats, siteForHost };
})(globalThis);
