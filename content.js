(() => {
  'use strict';
  const SITE = QuotaGuard.siteForHost(location.hostname);
  if (!SITE) return;

  let settings = QuotaGuard.DEFAULTS[SITE];
  const videos = new Map();
  let mutationTimer = 0;
  let activeVideo = null;
  const verifiedSources = new WeakMap();
  const blockedSources = new WeakMap();
  const mediaSizes = new Map();
  function rememberMediaSize(url, kind, bytes) {
    if (typeof url !== 'string' || !Number.isSafeInteger(bytes) || bytes < 0) return;
    mediaSizes.set(url.split('#')[0], {kind, bytes, label: QuotaGuardQuality.formatMediaBytes(bytes) + (kind === 'total' ? ' total' : ' buffered')});
    if (mediaSizes.size > 60) mediaSizes.delete(mediaSizes.keys().next().value);
  }
  document.addEventListener('qg-media-bytes', event => {
    rememberMediaSize(event.detail?.url, 'buffered', event.detail?.bytes);
  });
  const supportsPlaybackControls = QuotaGuard.CAPABILITIES[SITE].playbackControls;

  function isVideoElement(el) {
    return (typeof HTMLVideoElement !== 'undefined' && el instanceof HTMLVideoElement) ||
           el?.tagName === 'VIDEO';
  }

  function protect() { return supportsPlaybackControls && settings.enabled && settings.stopAutoplay && !settings.strictBlock; }
  function setRootFlag() {
    const root = document.documentElement;
    if (root) {
      root.setAttribute('data-qg-site', SITE);
      root.setAttribute('data-qg-autoplay', protect() ? 'block' : 'allow');
      root.setAttribute('data-qg-preload', supportsPlaybackControls && settings.enabled && settings.preventPreload ? 'block' : 'allow');
      root.setAttribute('data-qg-enabled', settings.enabled && !settings.strictBlock ? 'yes' : 'no');
      root.setAttribute('data-qg-quality', settings.enabled && !settings.strictBlock ? settings.quality : 'auto');
    }
  }

  // Count a source once per video element, rather than once per DOM sweep.
  function sourceKey(video) { return video.currentSrc || video.getAttribute('src') || ''; }
  function recordOnce(video, seen, field) {
    const key = sourceKey(video);
    if (seen.has(video) && seen.get(video) === key) return;
    seen.set(video, key);
    chrome.runtime.sendMessage({type: 'qg-stat', field}).catch(() => {});
  }
  function recordBlocked(video) {
    if (isVideoElement(video) && protect()) recordOnce(video, blockedSources, 'autoplaysBlocked');
  }

  document.addEventListener('qg-cap-applied', event => {
    if (!settings.enabled || settings.strictBlock) return;
    const q = event.detail?.quality || settings.quality;
    const video = activeVideo || [...document.querySelectorAll('video')].find(v => QuotaGuardPlayer.visible(v));
    if (video && !video.paused && video.videoWidth > 0) verifyStreamResolution(video);
    else if (video) showPillBadge(video, q === 'audio' ? 'Audio requested' : `${q}p offered`);
  });
  document.addEventListener('qg-autoplay-blocked', event => recordBlocked(event.target), true);

  // --- On-player quality control ---
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

  function showPillBadge(video, text, status = {}) {
    const container = getPlayerContainer(video);
    if (!container || !video.isConnected) return;

    if (getComputedStyle(container).position === 'static') {
      const state = videos.get(video);
      if (state && !state.modifiedParent) {
        state.modifiedParent = container;
        state.oldPosition = container.style.position;
      }
      container.style.position = 'relative';
    }
    container.classList.add('qg-player');

    let badge = container.querySelector('.qg-pill-badge');
    if (!badge) {
      badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'qg-pill-badge';
      const label = document.createElement('span');
      label.className = 'qg-badge-quality';
      const warning = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const [name, value] of Object.entries({class: 'qg-badge-warning', viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'aria-hidden': 'true', hidden: ''})) warning.setAttribute(name, value);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M8 3v6m0 2v2M8 1.5 15 14H1L8 1.5Z');
      warning.appendChild(path);
      const size = document.createElement('span');
      size.className = 'qg-badge-size';
      size.hidden = true;
      badge.append(label, warning, size);
      if (SITE === 'tiktok') badge.classList.add('qg-tiktok');
      badge.title = 'Change QuotaGuard quality (Alt+Q)';
      badge.addEventListener('click', e => {
        e.stopPropagation();
        e.preventDefault();
        if (e.isTrusted) cycleQuality();
      });
      container.appendChild(badge);
    }
    const state = videos.get(video);
    if (state) state.badge = badge;

    // A modal/container can be much wider than its portrait video. Anchor to
    // the video itself, and account for transforms on the containing element.
    const frame = video.getBoundingClientRect();
    const parent = container.getBoundingClientRect();
    const scaleX = (parent.width / container.offsetWidth) || 1;
    const scaleY = (parent.height / container.offsetHeight) || 1;
    const clearance = SITE === 'youtube' ? 50 : SITE === 'tiktok' ? 86 : 64;
    const bottom = Math.min(clearance, Math.max(8, frame.height / scaleY / 3));
    badge.style.setProperty('--qg-chip-right', `${Math.max(0, (parent.right - frame.right) / scaleX) + 12}px`);
    badge.style.setProperty('--qg-chip-bottom', `${Math.max(0, (parent.bottom - frame.bottom) / scaleY) + bottom}px`);
    badge.style.setProperty('--qg-chip-max', `${Math.max(24, frame.width / scaleX - 24)}px`);

    const label = status.actualResolution ? `${status.actualResolution}p` : (text.match(/^(\d+p|SD|Audio)/)?.[1] || 'Quality');
    const qualityLabel = badge.querySelector('.qg-badge-quality');
    if (qualityLabel.textContent !== label) qualityLabel.textContent = label;
    const above = status.state === 'above';
    badge.querySelector('.qg-badge-warning').toggleAttribute('hidden', !above);
    const size = badge.querySelector('.qg-badge-size');
    const sizeLabel = above && status.mediaSize ? status.mediaSize.label : '';
    if (size.textContent !== sizeLabel) size.textContent = sizeLabel;
    size.hidden = !sizeLabel;
    badge.setAttribute('aria-label', `${text}. Change QuotaGuard quality`);
    if (above) {
      badge.classList.add('qg-pill-server-min');
    } else {
      badge.classList.remove('qg-pill-server-min');
    }
  }

  // --- Quick Keyboard Shortcut (Alt + Q) ---
  const QUALITY_CYCLE = QuotaGuard.QUALITY_OPTIONS[SITE];
  async function cycleQuality() {
    if (!settings.enabled || settings.strictBlock) return;
    const next = QUALITY_CYCLE[(QUALITY_CYCLE.indexOf(settings.quality) + 1) % QUALITY_CYCLE.length];
    try {
      const result = await chrome.runtime.sendMessage({type: 'qg-setting', site: SITE, key: 'quality', value: next});
      if (!result?.ok) throw new Error('Not saved');
      const label = next === 'audio' ? 'Audio only requested' : next === 'auto' ? 'Site default' : `${next}p target`;
      showToast(`QuotaGuard: ${label}`);
    } catch (_) { showToast('Quality could not be saved. Reload this tab and try again.'); }
  }
  document.addEventListener('keydown', event => {
    if (event.isTrusted && event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'q') {
      event.preventDefault();
      cycleQuality();
    }
  });

  function showToast(msg) {
    const existing = document.querySelector('.qg-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'qg-toast';
    toast.textContent = msg;
    toast.setAttribute('role', 'status');
    document.body?.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('qg-fade');
      setTimeout(() => toast.remove(), 400);
    }, 2000);
  }

  const io = new IntersectionObserver(entries => {
    // YouTube handles its own miniplayer/picture-in-picture when scrolling to comments; do not force-pause on YouTube
    if (!settings.enabled || !settings.pauseOffscreen || settings.quality === 'audio' || !supportsPlaybackControls) return;
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
        if (!state.badge && state.modifiedParent && state.oldPosition !== null) {
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
    chip.textContent = 'Play video';
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
      const hardened = video.hasAttribute('data-qg-original-preload');
      videos.set(video, {chip: null, badge: null, modifiedParent: null, oldPosition: null,
        originalPreload: hardened ? (video.getAttribute('data-qg-original-preload') || null) : video.getAttribute('preload'), preloadChanged: hardened});
      io.observe(video);
    }
    const state = videos.get(video);
    if ((!settings.enabled || !settings.preventPreload) && state.preloadChanged) {
      state.preloadChanged = false;
      if (state.originalPreload === null) video.removeAttribute('preload');
      else video.setAttribute('preload', state.originalPreload);
    }
    if (!settings.enabled || settings.strictBlock) {
      state.badge?.remove();
      state.badge = null;
      getPlayerContainer(video)?.classList.remove('qg-player');
      if (!state.chip && state.modifiedParent) {
        state.modifiedParent.style.position = state.oldPosition;
        state.modifiedParent = null;
      }
    }
    // YouTube owns its playback lifecycle; only its quality cap is managed here.
    if (supportsPlaybackControls) {
      if (settings.enabled && settings.preventPreload &&
          video.getAttribute('data-qg-manual-play') !== 'yes') {
        if (video.preload !== 'none') { state.preloadChanged = true; video.preload = 'none'; }
      }
      if (protect() && video.getAttribute('data-qg-manual-play') !== 'yes') {
        if (video.autoplay) video.autoplay = false;
        if (!video.paused) video.pause();
      }
      if (settings.enabled && settings.strictBlock && !video.paused) video.pause();
    }
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
      video = target.closest?.('[data-testid*="video" i], [role="region"], [data-video-id], .x1yztbdb')?.querySelector('video');
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
    // YouTube anti-adblock compliance: allow YouTube's player and ads to play unpaused
    if (SITE === 'youtube') {
      renderChip(video);
      return;
    }
    if (settings.enabled && (settings.strictBlock ||
        (settings.stopAutoplay && video.getAttribute('data-qg-manual-play') !== 'yes'))) {
      video.pause();
      recordBlocked(video);
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
  }

  // Quality is applied through stream responses. Never drive the site's
  // menus: a Reel dialog and its Close button are navigation controls.
  function playbackStatus(video) {
    const base = {site: SITE, enabled: settings.enabled, strictBlock: settings.strictBlock, requestedQuality: settings.quality};
    if (!settings.enabled) return {...base, state: 'off', quality: 'Data saving is off'};
    if (settings.strictBlock) return {...base, state: 'blocked', quality: 'Video requests are blocked'};
    if (!video || !video.isConnected || video.paused) return {...base, state: 'ready', quality: 'Play a video to check its quality'};
    const resolution = Math.min(video.videoWidth || 0, video.videoHeight || 0);
    if (settings.quality === 'audio') {
      return {...base, state: 'requested', actualResolution: resolution || null,
        quality: resolution ? `Audio requested; video is still ${resolution}p` : 'Audio requested; video transfer is not measured'};
    }
    if (!resolution) return {...base, state: 'ready', quality: 'Waiting for video details'};
    if (settings.quality === 'auto') return {...base, state: 'default', actualResolution: resolution, quality: `${resolution}p · Site default`};
    const withinTarget = resolution <= Number(settings.quality);
    return {...base, state: withinTarget ? 'verified' : 'above', actualResolution: resolution,
      mediaSize: mediaSizes.get(sourceKey(video).split('#')[0]) || null,
      quality: withinTarget ? `${resolution}p · Within target` : `${resolution}p · Above target`};
  }

  function verifyStreamResolution(video) {
    if (!video || !video.isConnected || !settings.enabled || settings.strictBlock) return;
    const status = playbackStatus(video);
    if (status.state === 'verified') recordOnce(video, verifiedSources, 'videosCapped');
    if (!video.paused) {
      const size = status.state === 'above' ? (status.mediaSize?.label || 'Size unavailable') : '';
      showPillBadge(video, status.quality + (size ? ` · ${size}` : ''), status);
      const badge = videos.get(video)?.badge;
      if (badge) badge.title = status.state === 'above'
        ? (status.mediaSize ? `${status.mediaSize.bytes.toLocaleString()} bytes. ${status.mediaSize.kind === 'total' ? 'Full media resource size reported by the server; not bytes downloaded.' : 'Cumulative audio/video bytes accepted by this player’s media buffers, including reused data; not total file size or network usage.'} Click to change quality (Alt+Q).` : 'The server has not provided a total size for this video. No estimate is shown. Click to change quality (Alt+Q).')
        : 'Change QuotaGuard quality (Alt+Q)';
    }
  }

  document.addEventListener('playing', event => {
    if (isVideoElement(event.target)) {
      const video = event.target;
      activeVideo = video;
      renderChip(video);
      verifyStreamResolution(video);
    }
  }, true);

  for (const name of ['loadeddata', 'resize', 'timeupdate']) {
    document.addEventListener(name, event => {
      if (isVideoElement(event.target)) verifyStreamResolution(event.target);
    }, true);
  }

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
    let needsSweep = false;
    for (const rec of records) {
      if (rec.type === 'attributes') {
        if (isVideoElement(rec.target)) applyVideo(rec.target);
        continue;
      }
      for (const node of rec.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (isVideoElement(node)) applyVideo(node);
        else if (node.querySelector('video')) scan(node);
        else needsSweep = true;
      }
    }
    if (!mutationTimer && needsSweep) {
      mutationTimer = setTimeout(() => {
        mutationTimer = 0;
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
      document.documentElement?.removeAttribute('data-qg-quality-applied');
      refreshAll();
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'qg-media-size') {
      rememberMediaSize(message.url, 'total', message.bytes);
      return;
    }
    if (message?.type === 'qg-status') {
      const current = activeVideo?.isConnected && !activeVideo.paused ? activeVideo :
        [...document.querySelectorAll('video')].find(video => QuotaGuardPlayer.visible(video) && !video.paused);
      sendResponse(playbackStatus(current));
    }
  });

  if (document.documentElement) begin();
  else document.addEventListener('readystatechange', () => {
    if (document.documentElement && !observer.takeRecords().length) begin();
  }, {once: true});
  reloadSettings();
})();
