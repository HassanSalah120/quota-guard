/* Early, page-context autoplay prevention with seamless native click support.
 * Distinguishes programmatic autoplay from trusted user gestures.
 * No network snooping, cookies, credential access, or external requests.
 */
(() => {
  'use strict';
  if (window.__quotaGuardPatched) return;
  window.__quotaGuardPatched = true;

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
      const v = cur.querySelector?.('video');
      if (v) return v;
    }
    return null;
  }

  // --- Dynamic Media Element Preload Hardening ---
  const origCreateElement = document.createElement;
  document.createElement = function(tagName, ...args) {
    const el = Reflect.apply(origCreateElement, this, [tagName, ...args]);
    if (typeof tagName === 'string' && tagName.toLowerCase() === 'video') {
      if (document.documentElement?.getAttribute('data-qg-autoplay') === 'block') {
        try {
          el.autoplay = false;
          el.preload = 'none';
        } catch (_) {}
      }
    }
    return el;
  };

  // Prevent background feed videos from buffering chunks prior to interaction
  document.addEventListener('loadstart', (e) => {
    const v = e.target;
    if (v instanceof HTMLVideoElement && document.documentElement?.getAttribute('data-qg-autoplay') === 'block') {
      if (v.getAttribute('data-qg-manual-play') !== 'yes' && v.paused) {
        try { v.preload = 'none'; } catch (_) {}
      }
    }
  }, true);

  function handleUserGesture(event) {
    // Only genuine user actions grant manual playback permission
    if (!event.isTrusted) return;
    let video = findVideo(event.target);
    if (!video && event.clientX && event.clientY) {
      try {
        video = document.elementsFromPoint(event.clientX, event.clientY).find(el => el instanceof HTMLVideoElement);
      } catch (_) {}
    }
    if (!video) {
      const visible = [...document.querySelectorAll('video')].find(v => v.isConnected && v.getClientRects().length > 0);
      if (visible) video = visible;
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
      const video = findVideo(event.target) || findVideo(document.activeElement);
      if (video) {
        video.setAttribute('data-qg-manual-play', 'yes');
        video.__qgUserTime = Date.now();
      }
    }
  }, true);

  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    if (this instanceof HTMLVideoElement &&
        document.documentElement?.getAttribute('data-qg-autoplay') !== 'allow') {
      const isManual = this.getAttribute('data-qg-manual-play') === 'yes' ||
                       (this.__qgUserTime && (Date.now() - this.__qgUserTime < 2500));
      if (!isManual) {
        try { this.autoplay = false; this.preload = 'none'; } catch (_) {}
        try {
          document.dispatchEvent(new CustomEvent('qg-autoplay-blocked'));
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
    // When navigating to another YouTube video, clear prior manual play flag so autoplay block is enforced
    try {
      const videos = document.querySelectorAll('video');
      videos.forEach(v => {
        v.removeAttribute('data-qg-manual-play');
        delete v.__qgUserTime;
      });
    } catch (_) {}
  });
  setInterval(enforceYouTubeQuality, 2000);
})();
