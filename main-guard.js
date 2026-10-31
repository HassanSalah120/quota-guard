/* Early, page-context autoplay prevention with seamless native click support.
 * Distinguishes programmatic autoplay from trusted user gestures.
 * No network snooping, cookies, credential access, or external requests.
 */
(() => {
  'use strict';
  if (window.__quotaGuardPatched) return;
  window.__quotaGuardPatched = true;

  // Measure bytes the actual MSE player accepts. This never reads/clones a
  // response, fetches extra data, or infers a file size from resolution.
  const mediaSources = new WeakMap();
  const sourceBuffers = new WeakMap();
  function mediaState(source) {
    if (!mediaSources.has(source)) mediaSources.set(source, {urls: new Set(), bytes: 0, timer: 0});
    return mediaSources.get(source);
  }
  const createObjectURL = URL.createObjectURL;
  URL.createObjectURL = function (object) {
    const url = Reflect.apply(createObjectURL, this, [object]);
    if (typeof MediaSource !== 'undefined' && object instanceof MediaSource) mediaState(object).urls.add(url);
    return url;
  };
  if (typeof MediaSource !== 'undefined' && typeof SourceBuffer !== 'undefined') {
    const addSourceBuffer = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function (...args) {
      const buffer = Reflect.apply(addSourceBuffer, this, args);
      sourceBuffers.set(buffer, mediaState(this));
      return buffer;
    };
    const appendBuffer = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function (bytes) {
      const result = Reflect.apply(appendBuffer, this, [bytes]);
      const state = sourceBuffers.get(this);
      if (state && Number.isSafeInteger(bytes?.byteLength)) {
        state.bytes += bytes.byteLength;
        if (!state.timer) state.timer = setTimeout(() => {
          state.timer = 0;
          for (const url of state.urls) document.dispatchEvent(new CustomEvent('qg-media-bytes', {detail: {url, bytes: state.bytes}}));
        }, 250);
      }
      return result;
    };
  }

  function findVideo(target) {
    if (!target) return null;
    if (target instanceof HTMLVideoElement) return target;
    // Look within player containers across Facebook, X, TikTok, and YouTube
    const container = target.closest?.(
      '[data-testid*="video" i], [role="region"], [aria-label*="video" i], [data-video-id], .x1yztbdb, ' +
      'ytd-player, #movie_player, ytd-reel-video-renderer, ytd-inline-preview-renderer, ytd-shorts, ' +
      '[data-e2e="feed-video"], .xgplayer-container, [class*="DivVideoContainer"], .html5-video-player'
    );
    if (container) {
      const v = container.querySelector('video');
      if (v) return v;
    }
    // Search nearby parent nodes
    let cur = target;
    for (let depth = 0; depth < 5 && cur?.parentElement; depth++) {
      cur = cur.parentElement;
      if (cur === document.body || cur === document.documentElement) break;
      const v = cur.querySelector?.('video');
      if (v) return v;
    }
    return null;
  }

  // --- Dynamic Media Element Preload Hardening ---
  const origCreateElement = document.createElement.bind(document);
  document.createElement = function(tagName, ...args) {
    const el = Reflect.apply(origCreateElement, document, [tagName, ...args]);
    if (typeof tagName === 'string' && tagName.toLowerCase() === 'video') {
      const host = location.hostname.toLowerCase();
      if (!host.includes('youtube.com') && !host.endsWith('youtu.be')) {
        if (document.documentElement?.getAttribute('data-qg-preload') === 'block') {
          try {
            el.setAttribute('data-qg-original-preload', el.getAttribute('preload') || '');
            el.preload = 'none';
          } catch (_) {}
        }
      }
    }
    return el;
  };

  // Prevent background feed videos from buffering chunks prior to interaction
  document.addEventListener('loadstart', (e) => {
    const host = location.hostname.toLowerCase();
    if (host.includes('youtube.com') || host.endsWith('youtu.be')) return;
    const v = e.target;
    if (v instanceof HTMLVideoElement && document.documentElement?.getAttribute('data-qg-preload') === 'block') {
      if (v.getAttribute('data-qg-manual-play') !== 'yes' && v.paused) {
        try { v.preload = 'none'; } catch (_) {}
      }
    }
  }, true);

  let reelIntent = null;
  function rememberReelIntent(target) {
    if (!/(^|\.)facebook\.com$/.test(location.hostname)) return;
    const link = target?.closest?.('a[href]');
    if (!link) return;
    try {
      const url = new URL(link.href, location.href);
      if (url.origin === location.origin && /^\/reels?\/[^/]+/.test(url.pathname)) {
        reelIntent = {path: url.pathname.replace(/\/$/, ''), time: Date.now()};
      }
    } catch (_) {}
  }
  function authorizeOpenedReel(video) {
    if (!reelIntent || Date.now() - reelIntent.time > 2500 ||
        location.pathname.replace(/\/$/, '') !== reelIntent.path ||
        !video.isConnected || !video.closest('[role="dialog"], [aria-modal="true"]')) return;
    reelIntent = null;
    video.setAttribute('data-qg-manual-play', 'yes');
    video.__qgUserTime = Date.now();
  }
  document.addEventListener('play', event => {
    if (event.target instanceof HTMLVideoElement) authorizeOpenedReel(event.target);
  }, true);

  function handleUserGesture(event) {
    // Only genuine user actions grant manual playback permission
    if (!event.isTrusted) return;
    rememberReelIntent(event.target);
    let video = findVideo(event.target);
    if (!video && event.clientX && event.clientY) {
      try {
        video = document.elementsFromPoint(event.clientX, event.clientY).find(el => el instanceof HTMLVideoElement);
      } catch (_) {}
    }
    if (video) {
      video.setAttribute('data-qg-manual-play', 'yes');
      video.__qgUserTime = Date.now();
    }
  }

  // Intercept before page scripts handle the click
  document.addEventListener('pointerdown', handleUserGesture, true);
  document.addEventListener('click', handleUserGesture, true);
  document.addEventListener('keydown', event => {
    if (!event.isTrusted) return;
    if (event.code === 'Space' || event.code === 'Enter') {
      if (event.code === 'Enter') rememberReelIntent(event.target);
      const video = findVideo(event.target) || findVideo(document.activeElement);
      if (video) {
        video.setAttribute('data-qg-manual-play', 'yes');
        video.__qgUserTime = Date.now();
      }
    }
  }, true);

  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    // Leave YouTube's own playback lifecycle intact; only quality is managed.
    const host = location.hostname.toLowerCase();
    if (host.includes('youtube.com') || host.endsWith('youtu.be')) {
      return Reflect.apply(originalPlay, this, args);
    }

    if (this instanceof HTMLVideoElement &&
        document.documentElement?.getAttribute('data-qg-autoplay') !== 'allow') {
      if (this.getAttribute('data-qg-manual-play') !== 'yes') authorizeOpenedReel(this);
      const isManual = this.getAttribute('data-qg-manual-play') === 'yes' ||
                       (this.__qgUserTime && (Date.now() - this.__qgUserTime < 2500));
      if (!isManual) {
        try {
          this.autoplay = false;
          if (document.documentElement?.getAttribute('data-qg-preload') === 'block') this.preload = 'none';
        } catch (_) {}
        try {
          this.dispatchEvent(new CustomEvent('qg-autoplay-blocked', {bubbles: true}));
        } catch (_) {}
        // Match browser autoplay refusal so page scripts can gracefully handle it
        return Promise.reject(new DOMException('QuotaGuard: click Play to allow this video', 'NotAllowedError'));
      }
    }
    return Reflect.apply(originalPlay, this, args);
  };

  // --- YouTube HTML5 Player Quality Enforcer ---
  function enforceYouTubeQuality() {
    try {
      const q = document.documentElement?.getAttribute('data-qg-quality') || '360';
      if (q === 'auto') return;

      const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (!player || typeof player.setPlaybackQualityRange !== 'function') return;

      const available = typeof player.getAvailableQualityLevels === 'function'
        ? player.getAvailableQualityLevels()
        : null;

      const bestLevel = window.QuotaGuardYouTube?.pickBestQualityLevel
        ? window.QuotaGuardYouTube.pickBestQualityLevel(available, q)
        : (window.QuotaGuardYouTube?.getQualityString ? window.QuotaGuardYouTube.getQualityString(q) : 'medium');

      player.setPlaybackQualityRange(bestLevel, bestLevel);
      if (typeof player.setPlaybackQuality === 'function') {
        player.setPlaybackQuality(bestLevel);
      }

      // Update badge attribute and notify
      const numericTarget = window.QuotaGuardYouTube?.QUALITY_MAP?.[bestLevel] || q;
      const status = q === 'audio' ? 'Audio only requested' : `${numericTarget}p target requested`;
      if (document.documentElement?.getAttribute('data-qg-quality-applied') !== status) {
        document.documentElement?.setAttribute('data-qg-quality-applied', status);
        try {
          document.dispatchEvent(new CustomEvent('qg-cap-applied', {
            detail: { type: 'youtube', quality: q === 'audio' ? 'audio' : numericTarget, time: Date.now() }
          }));
        } catch (_) {}
      }

      if (!player.__qgQualityHooked && typeof player.addEventListener === 'function') {
        player.__qgQualityHooked = true;
        player.addEventListener('onPlaybackQualityChange', (newQuality) => {
          const currentTarget = document.documentElement?.getAttribute('data-qg-quality') || '360';
          if (currentTarget === 'auto') return;
          const desired = window.QuotaGuardYouTube?.pickBestQualityLevel
            ? window.QuotaGuardYouTube.pickBestQualityLevel(player.getAvailableQualityLevels?.(), currentTarget)
            : 'medium';
          if (newQuality !== desired) {
            player.setPlaybackQualityRange(desired, desired);
            if (typeof player.setPlaybackQuality === 'function') player.setPlaybackQuality(desired);
          }
        });
      }
    } catch (_) {}
  }

  window.addEventListener('yt-navigate-finish', enforceYouTubeQuality);
  window.addEventListener('yt-player-updated', enforceYouTubeQuality);
  window.addEventListener('yt-navigate-start', () => {
    enforceYouTubeQuality();
  });
  setInterval(enforceYouTubeQuality, 2000);
})();
