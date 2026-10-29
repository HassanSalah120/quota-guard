(() => {
  'use strict';
  const SITE = QuotaGuard.siteForHost(location.hostname);
  if (!SITE) return;

  let settings = QuotaGuard.DEFAULTS[SITE];
  const videos = new Map();
  let mutationTimer = 0;
  let qualityTimer = 0;
  let activeVideo = null;
  const qualityAttempts = new WeakMap();

  function isVideoElement(el) {
    return (typeof HTMLVideoElement !== 'undefined' && el instanceof HTMLVideoElement) ||
           el?.tagName === 'VIDEO';
  }

  function protect() { return settings.enabled && settings.stopAutoplay && !settings.strictBlock; }
  function setRootFlag() {
    const root = document.documentElement;
    if (root) {
      root.setAttribute('data-qg-site', SITE);
      root.setAttribute('data-qg-autoplay', protect() ? 'block' : 'allow');
      root.setAttribute('data-qg-enabled', settings.enabled && !settings.strictBlock ? 'yes' : 'no');
      root.setAttribute('data-qg-quality', settings.enabled && !settings.strictBlock ? settings.quality : 'auto');
    }
  }

  // --- Statistics Recording ---
  async function incrementStat(field, mbDelta = 0) {
    try {
      const data = await chrome.storage.local.get('stats');
      const allStats = QuotaGuard.normalizeStats(data.stats);
      allStats[SITE][field] = (allStats[SITE][field] || 0) + 1;
      if (mbDelta > 0) {
        allStats[SITE].mbSavedEst = Math.round(((allStats[SITE].mbSavedEst || 0) + mbDelta) * 10) / 10;
      }
      await chrome.storage.local.set({ stats: allStats });
    } catch (_) {}
  }

  document.addEventListener('qg-cap-applied', event => {
    const q = event.detail?.quality || settings.quality;
    const isRadio = q === 'audio';
    // Radio mode saves ~35 MB per video compared to full HD streaming
    incrementStat('videosCapped', isRadio ? 35 : 18);
    const targetVideo = activeVideo ||
      [...document.querySelectorAll('video')].find(v => QuotaGuardPlayer.visible(v)) ||
      document.querySelector('video');
    if (targetVideo) {
      const text = isRadio ? 'Radio Mode (Sound Only)' : `${q}p Cap Active`;
      showPillBadge(targetVideo, text);
    }
  });

  document.addEventListener('qg-autoplay-blocked', () => {
    // Each unplayed background autoplay saves approx 8-12 MB of preloaded chunks
    incrementStat('autoplaysBlocked', 10);
  });

  // --- Visual Feedback Pill (Persistent Stream Indicator) ---
  function getPlayerContainer(video) {
    if (!video) return null;
    const named = video.closest(
      '[data-e2e="feed-video"], [class*="DivVideoPlayerContainer"], [class*="DivPlayerContainer"], .xgplayer, ' +
      '#movie_player, .html5-video-player, ytd-player, ' +
      '[data-testid*="video" i], [role="region"], .x1yztbdb, ' +
      '[data-testid="videoPlayer"], [data-testid="videoComponent"], [data-testid*="video"]'
    );
    return named || video.parentElement;
  }

  function showPillBadge(video, text) {
    const container = getPlayerContainer(video);
    if (!container || !video.isConnected) return;

    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    let badge = container.querySelector('.qg-pill-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'qg-pill-badge';
      if (SITE === 'tiktok') badge.classList.add('qg-tiktok');
      badge.title = 'QuotaGuard Stream Quality Monitor • Click to cycle quality (Alt+Q)';
      badge.addEventListener('click', e => {
        e.stopPropagation();
        e.preventDefault();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', altKey: true, bubbles: true }));
      });
      container.appendChild(badge);
    }
    const state = videos.get(video);
    if (state) state.badge = badge;

    badge.textContent = `⚡ QuotaGuard: ${text}`;
    if (text.includes('Server Min')) {
      badge.classList.add('qg-pill-server-min');
    } else {
      badge.classList.remove('qg-pill-server-min');
    }
  }

  // --- Quick Keyboard Shortcut (Alt + Q) ---
  const supportsRadio = SITE === 'youtube' || SITE === 'facebook';
  const QUALITY_CYCLE = supportsRadio
    ? ['360', '240', 'audio', '480', 'auto']
    : ['360', '240', '480', 'auto'];

  document.addEventListener('keydown', async event => {
    if (event.altKey && (event.key === 'q' || event.key === 'Q')) {
      const currentIdx = QUALITY_CYCLE.indexOf(settings.quality);
      const nextQuality = QUALITY_CYCLE[(currentIdx + 1) % QUALITY_CYCLE.length];
      settings.quality = nextQuality;
      setRootFlag();
      try {
        const stored = await chrome.storage.local.get('settings');
        const config = QuotaGuard.normalize(stored.settings);
        config[SITE].quality = nextQuality;
        await chrome.storage.local.set({ settings: config });
      } catch (_) {}
      const toastLabel = nextQuality === 'audio'
        ? 'Radio Mode (Sound Only)'
        : (nextQuality === 'auto' ? 'Default Quality' : nextQuality + 'p Cap');
      showToast(`QuotaGuard: ${toastLabel}`);
    }
  });

  function showToast(msg) {
    const existing = document.querySelector('.qg-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'qg-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('qg-fade');
      setTimeout(() => toast.remove(), 400);
    }, 2000);
  }

  const io = new IntersectionObserver(entries => {
    if (!settings.enabled || !settings.pauseOffscreen) return;
    for (const entry of entries) {
      const video = entry.target;
      if (entry.isIntersecting || video.paused) continue;
      video.pause();
      // Require another user click after scrolling away.
      if (protect()) {
        video.removeAttribute('data-qg-manual-play');
        renderChip(video);
      }
    }
  }, {threshold: 0.01});

  function renderChip(video) {
    const state = videos.get(video);
    if (!state || !video.isConnected) return;
    const blocked = protect() && video.getAttribute('data-qg-manual-play') !== 'yes';
    // TikTok and YouTube have native prominent center play buttons; do not overlay redundant chips
    if (!blocked || SITE === 'tiktok' || SITE === 'youtube') {
      if (state.chip) {
        state.chip.remove();
        state.chip = null;
        if (state.modifiedParent && state.oldPosition !== null) {
          state.modifiedParent.style.position = state.oldPosition;
          state.modifiedParent = null;
        }
      }
      return;
    }
    const container = getPlayerContainer(video) || video.parentElement;
    if (!container) return;
    if (state.chip && state.chip.parentElement !== container) {
      state.chip.remove();
      state.chip = null;
    }
    if (state.chip) return;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'qg-play-chip';
    chip.textContent = '▶ Play video';
    chip.title = 'Allow this video to play and use data';
    chip.setAttribute('aria-label', 'Play video — this will use internet data');
    chip.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      video.setAttribute('data-qg-manual-play', 'yes');
      renderChip(video);
      if (settings.enabled && settings.preventPreload) video.preload = 'metadata';
      try { await video.play(); }
      catch (_) {}
    });
    if (getComputedStyle(container).position === 'static') {
      state.modifiedParent = container;
      state.oldPosition = container.style.position;
      container.style.position = 'relative';
    }
    container.appendChild(chip);
    state.chip = chip;
  }

  function applyVideo(video) {
    if (!isVideoElement(video)) return;
    if (!videos.has(video)) {
      videos.set(video, {chip: null, badge: null, modifiedParent: null, oldPosition: null});
      io.observe(video);
    }
    if (settings.enabled && settings.preventPreload &&
        video.getAttribute('data-qg-manual-play') !== 'yes') {
      if (video.preload !== 'none') video.preload = 'none';
    }
    if (protect() && video.getAttribute('data-qg-manual-play') !== 'yes') {
      if (video.autoplay) video.autoplay = false;
      if (!video.paused) video.pause();
    }
    if (settings.enabled && settings.strictBlock && !video.paused) video.pause();
    renderChip(video);
  }

  // Trusted user clicks on the video or its player container authorize playback seamlessly
  document.addEventListener('click', event => {
    if (!event.isTrusted) return;
    const target = event.target;
    let video = isVideoElement(target) ? target : null;
    if (!video && event.clientX && event.clientY) {
      try {
        video = document.elementsFromPoint(event.clientX, event.clientY).find(el => isVideoElement(el));
      } catch (_) {}
    }
    if (!video) {
      video = target.closest?.('[data-testid*="video" i], [role="region"], [role="main"], [data-video-id], .x1yztbdb')?.querySelector('video');
    }
    if (!video) {
      const allVideos = [...document.querySelectorAll('video')];
      const visible = allVideos.find(v => QuotaGuardPlayer.visible(v));
      if (visible) video = visible;
    }
    if (video) {
      video.setAttribute('data-qg-manual-play', 'yes');
      renderChip(video);
    }
  }, true);

  function onPlay(event) {
    const video = event.target;
    if (!isVideoElement(video)) return;
    if (!videos.has(video)) applyVideo(video);
    if (settings.enabled && (settings.strictBlock ||
        (settings.stopAutoplay && video.getAttribute('data-qg-manual-play') !== 'yes'))) {
      video.pause();
      renderChip(video);
    } else {
      renderChip(video);
    }
  }
  document.addEventListener('play', onPlay, true);

  function scan(root) {
    if (!root) return;
    if (isVideoElement(root)) applyVideo(root);
    else if (root.querySelectorAll) root.querySelectorAll('video').forEach(applyVideo);
    checkQualityMenus();
  }

  // Open the player's own settings automatically during manual playback.
  // Twitter has no quality menu; its quality is capped directly at the HLS layer.
  function checkQualityMenus() {
    if (!settings.enabled || settings.quality === 'auto' || settings.strictBlock) return;
    if (SITE === 'x' || SITE === 'tiktok' || SITE === 'youtube') return; // X, TikTok, and YouTube handled via stream & player API

    const video = activeVideo;
    if (!video?.isConnected || video.paused || !QuotaGuardPlayer.visible(video)) return;
    const current = qualityAttempts.get(video) || {count: 0, phase: 'gear', preference: settings.quality};
    if (current.preference !== settings.quality) {
      current.count = 0; current.phase = 'gear'; current.preference = settings.quality;
    }
    if (++current.count > 12 || current.phase === 'done') return;
    qualityAttempts.set(video, current);
    try {
      const choice = QuotaGuardPlayer.resolutionAction(settings.quality);
      if (choice) {
        const match = QuotaGuardQuality.parseResolution(choice.textContent || choice.getAttribute('aria-label'));
        choice.click();
        current.phase = 'done';
        const applied = match ? `${match}p requested in player` : 'SD requested in player';
        document.documentElement?.setAttribute('data-qg-quality-applied', applied);
        // Dismiss menu so it does not linger over the video
        setTimeout(() => {
          const closeBtn = document.querySelector('[aria-label*="close" i], [aria-label*="إغلاق" i]');
          if (closeBtn && QuotaGuardPlayer.visible(closeBtn)) closeBtn.click();
          else if (video && QuotaGuardPlayer.visible(video)) video.focus?.();
        }, 300);
        return;
      }
      const quality = QuotaGuardPlayer.qualitySubmenuAction();
      if (quality && current.phase !== 'gear') {
        quality.click();
        current.phase = 'choice';
        return;
      }
      if (current.phase === 'gear' || current.phase === 'retry') {
        const control = QuotaGuardPlayer.gear(video);
        if (control) { control.click(); current.phase = 'quality'; return; }
      }
      if (current.count % 4 === 0 && current.phase === 'quality') current.phase = 'retry';
    } catch (_) { /* player UI changed */ }
  }

  function startQualityAttempt(video) {
    if (!settings.enabled || settings.quality === 'auto' || settings.strictBlock) return;
    activeVideo = video;
    qualityAttempts.delete(video);
    if (qualityTimer) clearInterval(qualityTimer);
    qualityTimer = setInterval(() => {
      checkQualityMenus();
      if (!activeVideo?.isConnected || activeVideo.paused ||
          (qualityAttempts.get(activeVideo)?.count || 0) >= 12 ||
          qualityAttempts.get(activeVideo)?.phase === 'done') {
        clearInterval(qualityTimer); qualityTimer = 0;
      }
    }, 500);
  }

  document.addEventListener('mouseenter', event => {
    if (SITE !== 'facebook') return;
    const target = event.target;
    if (target instanceof Element && target.closest?.('[data-testid*="video" i], [role="region"], .x1yztbdb')) {
      const v = target.querySelector?.('video') || activeVideo;
      if (v && !v.paused) checkQualityMenus();
    }
  }, true);

  function verifyStreamResolution(video, retryCount = 0) {
    if (!video || !video.isConnected || video.paused) return;
    if (settings.quality === 'audio') {
      document.documentElement?.setAttribute('data-qg-quality-applied', 'Radio mode (sound only) active');
      showPillBadge(video, 'Radio Mode (Sound Only)');
      return;
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0 || h === 0) {
      if (retryCount < 6) {
        setTimeout(() => verifyStreamResolution(video, retryCount + 1), 300);
      }
      return;
    }
    const res = Math.min(w, h);
    const target = Number(settings.quality) || 360;
    const isAuto = settings.quality === 'auto';

    if (isAuto) {
      const label = `${res}p (Auto)`;
      document.documentElement?.setAttribute('data-qg-quality-applied', `${res}p stream active`);
      showPillBadge(video, label);
      return;
    }

    if (res <= target) {
      const label = `${res}p stream active • Bandwidth saved`;
      document.documentElement?.setAttribute('data-qg-quality-applied', label);
      incrementStat('videosCapped', 18);
      showPillBadge(video, `${res}p Saved`);
    } else {
      // Video is playing at a higher resolution because the server provided no lower stream
      const label = `Playing ${res}p HD (Server single stream — no ${target}p available)`;
      document.documentElement?.setAttribute('data-qg-quality-applied', label);
      showPillBadge(video, `${res}p (Server Min)`);
    }
  }

  document.addEventListener('playing', event => {
    if (isVideoElement(event.target)) {
      const video = event.target;
      activeVideo = video;
      video.setAttribute('data-qg-manual-play', 'yes');
      renderChip(video);
      startQualityAttempt(video);
      const onReady = () => verifyStreamResolution(video);
      if (video.videoWidth > 0) {
        verifyStreamResolution(video);
      } else {
        video.addEventListener('loadeddata', onReady, { once: true });
        video.addEventListener('resize', onReady, { once: true });
        video.addEventListener('timeupdate', onReady, { once: true });
        verifyStreamResolution(video);
      }
    }
  }, true);

  document.addEventListener('pause', event => {
    if (event.target === activeVideo && qualityTimer) { clearInterval(qualityTimer); qualityTimer = 0; }
  }, true);

  function sweep() {
    for (const [video, state] of videos) {
      if (!video.isConnected) {
        io.unobserve(video);
        state.chip?.remove();
        state.badge?.remove();
        videos.delete(video);
      } else applyVideo(video);
    }
    // Ensure active playing video has verified resolution badge
    if (activeVideo && !activeVideo.paused && activeVideo.isConnected) {
      verifyStreamResolution(activeVideo);
    }
    // Memory cap: if more than 60 video entries remain, remove oldest paused non-active videos
    if (videos.size > 60) {
      for (const [video, state] of videos) {
        if (video !== activeVideo && (video.paused || !video.isConnected)) {
          io.unobserve(video);
          state.chip?.remove();
          state.badge?.remove();
          videos.delete(video);
          if (videos.size <= 40) break;
        }
      }
    }
  }

  function refreshAll() {
    setRootFlag();
    for (const video of videos.keys()) applyVideo(video);
    scan(document);
  }

  const observer = new MutationObserver(records => {
    let runQuality = false;
    for (const rec of records) {
      if (rec.type === 'attributes') {
        if (isVideoElement(rec.target)) applyVideo(rec.target);
        continue;
      }
      for (const node of rec.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (isVideoElement(node)) applyVideo(node);
        else if (node.querySelector('video')) scan(node);
        else runQuality = true;
      }
    }
    if (!mutationTimer && runQuality) {
      mutationTimer = setTimeout(() => {
        mutationTimer = 0;
        checkQualityMenus();
        sweep();
      }, 350);
    }
  });

  function begin() {
    setRootFlag();
    observer.observe(document.documentElement || document, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['autoplay', 'preload', 'src']
    });
    scan(document);
    window.addEventListener('pagehide', () => { observer.disconnect(); io.disconnect(); }, {once: true});
  }

  async function reloadSettings() {
    try {
      const data = await chrome.storage.local.get('settings');
      settings = QuotaGuard.normalize(data.settings)[SITE];
    } catch (error) { console.warn('QuotaGuard: settings unavailable', error); }
    refreshAll();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      settings = QuotaGuard.normalize(changes.settings.newValue)[SITE];
      if (activeVideo && !activeVideo.paused) startQualityAttempt(activeVideo);
      refreshAll();
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'qg-status') {
      let currentQuality = document.documentElement?.getAttribute('data-qg-quality-applied') || null;
      if (!currentQuality) {
        const v = activeVideo || [...document.querySelectorAll('video')].find(el => QuotaGuardPlayer.visible(el) && !el.paused);
        if (v && v.videoWidth > 0) {
          const res = Math.min(v.videoWidth, v.videoHeight);
          currentQuality = `${res}p stream active`;
        }
      }
      sendResponse({
        quality: currentQuality,
        site: SITE
      });
    }
  });

  if (document.documentElement) begin();
  else document.addEventListener('readystatechange', () => {
    if (document.documentElement && !observer.takeRecords().length) begin();
  }, {once: true});
  reloadSettings();
})();
