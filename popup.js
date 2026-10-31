(() => {
  'use strict';
  let active = 'facebook';
  let config = QuotaGuard.normalize();
  let stats = QuotaGuard.normalizeStats();
  let verificationRequest = 0;
  let loaded = false;
  const $ = id => document.getElementById(id);
  const controls = [...document.querySelectorAll('[data-setting]')];
  const sites = Object.keys(QuotaGuard.SITE_NAMES);
  const tabs = sites.map(site => $('tab-' + site));
  const qualityLabels = {
    240: '240p · Maximum saving', 360: '360p · Recommended', 480: '480p · Balanced',
    540: '540p · Lower quality', 720: '720p · Balanced',
    audio: 'Audio only · Radio mode', auto: 'Site default · No cap'
  };
  const tips = {
    facebook: 'For Reels, the site’s SD preference can help. Available streams vary by video.',
    x: 'The cap filters stream choices. Some videos offer only one quality.',
    tiktok: 'Available qualities vary by video. When none meets your target, the lowest offered stream is kept.',
    youtube: 'Audio only applies to intercepted player responses. Reload the video after changing this mode.'
  };
  function text(id, value) { if ($(id).textContent !== String(value)) $(id).textContent = value; }
  function setStatus(state, title, detail, reading = {}) {
    $('site-status').dataset.state = state;
    text('site-status', ({off: 'Off', blocked: 'Blocked', verified: 'Verified', above: 'Above cap', requested: 'Requested', default: 'Site default', reload: 'Reconnect'})[state] || 'Ready');
    $('stream-state').dataset.state = state;
    const headlines = {verified: 'Playing within your limit', above: 'Playing above your limit', requested: 'Audio only requested', default: 'Site controls the quality'};
    const summaries = {verified: 'The current stream meets your setting.', above: 'A reload may help. Lower qualities depend on the video.', requested: 'Reload the video to apply audio only.', default: 'Your other enabled controls still apply.'};
    text('quality-verification', headlines[state] || title);
    text('stream-detail', summaries[state] || detail);
    text('stream-explanation', detail);
    text('actual-quality', reading.actualResolution ? reading.actualResolution + 'p' : '—');
    const target = config[active].quality;
    text('target-quality', target === 'audio' ? 'Audio' : target === 'auto' ? 'Auto' : target + 'p');
    const media = reading.mediaSize;
    text('media-label', media?.kind === 'buffered' ? 'Buffered media' : 'Video size');
    text('media-value', media ? QuotaGuardQuality.formatMediaBytes(media.bytes) : 'Not reported');
    $('media-value').title = detail;
  }
  function saveStatus(message, error = false) {
    text('saved', message);
    $('saved').dataset.error = String(error);
  }
  function renderStats() {
    text('stat-videos', stats[active].videosCapped);
    text('stat-autoplays', stats[active].autoplaysBlocked);
  }
  async function verify() {
    const request = ++verificationRequest;
    const site = active;
    const setting = {...config[site]};
    if (!loaded) return;
    if (!setting.enabled) { setStatus('off', 'Data saving is off', 'This site uses its own playback settings.'); return; }
    if (setting.strictBlock) { setStatus('blocked', 'All video requests blocked', 'Turn off “Block all video” to watch again.'); return; }
    try {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      if (request !== verificationRequest) return;
      if (!tab?.url || QuotaGuard.siteForHost(new URL(tab.url).hostname) !== site) {
        setStatus('ready', 'Ready for ' + QuotaGuard.SITE_NAMES[site], 'Open this site to verify playback.');
        return;
      }
      const result = await chrome.tabs.sendMessage(tab.id, {type: 'qg-status'});
      if (request !== verificationRequest) return;
      if (!result || result.requestedQuality !== setting.quality || result.enabled !== setting.enabled) {
        setStatus('ready', 'Applying your settings', 'Playback already buffered may need a reload.');
        return;
      }
      let detail = result.state === 'verified' ? 'The playing video is at or below your selected ceiling.'
        : result.state === 'above' ? 'This video is above your ceiling. A lower stream may be unavailable, or already buffered.'
        : result.state === 'requested' ? 'Audio only is requested. Reload the video to apply it; audio-only transfer is not verified.'
        : result.state === 'default' ? 'The website chooses playback quality. Other enabled controls still apply.'
        : 'Your settings are ready. Start a video to verify its quality.';
      if (result.state === 'above') {
        detail += result.mediaSize ? ` ${result.mediaSize.label}. ` + (result.mediaSize.kind === 'total' ? 'Server-reported resource size, not bytes downloaded.' : 'Bytes supplied to this player’s audio/video buffers, including reused data. Not network usage or a full file size.') : ' The full media size is unavailable. No estimate is shown.';
      }
      setStatus(result.state, result.quality, detail, result);
    } catch (_) {
      if (request === verificationRequest) setStatus('reload', 'Reload this tab to connect', 'Settings are saved. Refresh the website to activate this extension.');
    }
  }
  function render() {
    const setting = config[active];
    const capability = QuotaGuard.CAPABILITIES[active];
    tabs.forEach((tab, index) => {
      const selected = sites[index] === active;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    $('site-panel').setAttribute('aria-labelledby', 'tab-' + active);
    text('site-title', QuotaGuard.SITE_NAMES[active]);
    text('site-description', setting.enabled ? 'Data saving enabled' : 'Data saving paused');
    $('quality').replaceChildren(...QuotaGuard.QUALITY_OPTIONS[active].map(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = qualityLabels[value];
      return option;
    }));
    for (const input of controls) {
      const key = input.dataset.setting;
      const unsupported = !capability.playbackControls && ['stopAutoplay', 'preventPreload', 'pauseOffscreen'].includes(key);
      if (input.type === 'checkbox') input.checked = unsupported ? false : setting[key];
      else input.value = setting[key];
      input.disabled = !loaded || unsupported || (key !== 'enabled' && (!setting.enabled || (setting.strictBlock && key !== 'strictBlock')));
      input.title = unsupported ? 'Managed by YouTube' : '';
    }
    $('regular-controls').disabled = !loaded || !setting.enabled;
    $('capability-note').hidden = capability.playbackControls;
    text('quality-help', setting.quality === 'audio' ? 'Audio only where supported. Reload the video to apply.' : 'A ceiling when a lower stream is available.');
    text('native-tip', tips[active]);
    renderStats();
    verify();
  }
  function selectSite(index, focus = false) {
    active = sites[index];
    render();
    if (focus) tabs[index].focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectSite(index));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % sites.length;
      else if (event.key === 'ArrowLeft') next = (index - 1 + sites.length) % sites.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = sites.length - 1;
      else return;
      event.preventDefault();
      selectSite(next, true);
    });
  });
  for (const input of controls) {
    input.addEventListener('change', async () => {
      const site = active;
      const key = input.dataset.setting;
      const value = input.type === 'checkbox' ? input.checked : input.value;
      config[site][key] = value;
      saveStatus('Saving…');
      render();
      try {
        const result = await chrome.runtime.sendMessage({type: 'qg-setting', site, key, value});
        if (!result?.ok) throw new Error('Save failed');
        saveStatus('Saved · Applies to new playback');
        verify();
      } catch (_) {
        const stored = await chrome.storage.local.get('settings').catch(() => ({}));
        config = QuotaGuard.normalize(stored.settings);
        render();
        saveStatus('Could not save. Try again.', true);
      }
    });
  }
  $('native-settings').addEventListener('click', () => {
    const urls = {
      facebook: 'https://www.facebook.com/settings/?tab=videos',
      x: 'https://x.com/settings/data', tiktok: 'https://www.tiktok.com/setting',
      youtube: 'https://www.youtube.com/account_playback'
    };
    chrome.tabs.create({url: urls[active]});
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) { config = QuotaGuard.normalize(changes.settings.newValue); render(); }
    if (changes.activity) { stats = QuotaGuard.normalizeStats(changes.activity.newValue); renderStats(); }
  });
  render();
  chrome.storage.local.get(['settings', 'activity']).then(async stored => {
    config = QuotaGuard.normalize(stored.settings);
    stats = QuotaGuard.normalizeStats(stored.activity);
    try {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      const detected = tab?.url && QuotaGuard.siteForHost(new URL(tab.url).hostname);
      if (detected) active = detected;
    } catch (_) {}
    loaded = true;
    render();
  }).catch(() => saveStatus('Could not load settings. Reopen this popup.', true));
  const timer = setInterval(verify, 2000);
  window.addEventListener('pagehide', () => clearInterval(timer), {once: true});
})();
