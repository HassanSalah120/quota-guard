(() => {
  'use strict';
  let active = 'facebook';
  let config = QuotaGuard.normalize();
  let stats = QuotaGuard.normalizeStats();

  const controls = [...document.querySelectorAll('[data-setting]')];
  const tabs = {
    facebook: document.getElementById('tab-facebook'),
    x: document.getElementById('tab-x'),
    tiktok: document.getElementById('tab-tiktok'),
    youtube: document.getElementById('tab-youtube')
  };
  const status = document.getElementById('site-status');
  const tip = document.getElementById('native-tip');
  const saved = document.getElementById('saved');
  const verifier = document.getElementById('quality-verification');
  const sparklineCanvas = document.getElementById('speed-sparkline');
  let localSpeedHistory = [];

  function renderStats() {
    const s = stats[active] || QuotaGuard.DEFAULT_STATS;
    const vEl = document.getElementById('stat-videos');
    const aEl = document.getElementById('stat-autoplays');
    const sEl = document.getElementById('stat-saved');
    if (vEl) vEl.textContent = s.videosCapped || 0;
    if (aEl) aEl.textContent = s.autoplaysBlocked || 0;
    if (sEl) {
      const mb = Math.round(s.mbSavedEst || 0);
      sEl.textContent = mb >= 1024 ? `~${(mb / 1024).toFixed(1)} GB` : `~${mb} MB`;
    }
  }

  function drawSparkline(canvas, history) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!history || history.length < 2) {
      ctx.strokeStyle = 'rgba(78, 211, 166, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, h - 3);
      ctx.lineTo(w, h - 3);
      ctx.stroke();
      return;
    }

    const maxVal = Math.max(...history.map(pt => pt.dl || 0), 1024 * 60);
    const step = w / (history.length - 1);

    ctx.beginPath();
    history.forEach((pt, idx) => {
      const val = pt.dl || 0;
      const x = idx * step;
      const y = h - 3 - Math.min(h - 6, (val / maxVal) * (h - 6));
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.strokeStyle = '#4ed3a6';
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(78, 211, 166, 0.35)');
    grad.addColorStop(1, 'rgba(78, 211, 166, 0.0)');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  function render() {
    const data = config[active];
    const siteTitleEl = document.getElementById('site-title');
    if (siteTitleEl) siteTitleEl.textContent = QuotaGuard.SITE_NAMES[active];

    const supportsRadio = active === 'youtube' || active === 'facebook';
    const optRadio = document.getElementById('opt-radio');
    if (optRadio) {
      optRadio.hidden = !supportsRadio;
      optRadio.disabled = !supportsRadio;
    }
    if (!supportsRadio && data.quality === 'audio') {
      data.quality = '360';
    }

    // TikTok-specific stream labeling: TikTok only encodes down to 540p on its servers
    const opt240 = document.querySelector('#quality option[value="240"]');
    const opt360 = document.querySelector('#quality option[value="360"]');
    const opt480 = document.querySelector('#quality option[value="480"]');
    const tiktokTip = document.getElementById('tiktok-tip');
    if (tiktokTip) tiktokTip.style.display = active === 'tiktok' ? 'block' : 'none';

    if (active === 'tiktok') {
      if (opt240) opt240.hidden = true;
      if (opt360) opt360.textContent = '540p • Lowest available on TikTok (~75% less data)';
      if (opt480) opt480.textContent = '720p • Balanced HD (~40% less data)';
    } else {
      if (opt240) {
        opt240.hidden = false;
        opt240.textContent = '240p • Maximum saving (~75% less data)';
      }
      if (opt360) opt360.textContent = '360p • Recommended (~50% less data)';
      if (opt480) opt480.textContent = '480p • Balanced (~30% less data)';
    }

    async function updateQualityVerification() {
      if (!verifier) return;
      verifier.textContent = 'Stream status: checking active tab...';
      const currentSite = active;
      try {
        const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
        if (!tab || !tab.url || QuotaGuard.siteForHost(new URL(tab.url).hostname) !== currentSite) {
          verifier.textContent = `Open a ${QuotaGuard.SITE_NAMES[active]} tab to verify live resolution.`;
          return;
        }
        const result = await chrome.tabs.sendMessage(tab.id, {type:'qg-status'});
        if (active === currentSite) {
          const capSetting = data.quality === 'audio'
            ? 'Radio Mode'
            : (data.quality === 'auto' ? 'Default' : data.quality + 'p');
          verifier.textContent = result?.quality
            ? 'Stream status: ' + result.quality
            : `Active: ${capSetting} Cap Armed. Play any video to verify.`;
        }
      } catch (_) {
        if (active === currentSite) verifier.textContent = 'Stream status: reload tab to verify active stream.';
      }
    }

    for (const [site, button] of Object.entries(tabs)) {
      if (button) {
        button.classList.toggle('selected', site === active);
        button.setAttribute('aria-selected', String(site === active));
      }
    }

    for (const input of controls) {
      const key = input.dataset.setting;
      if (input.type === 'checkbox') input.checked = Boolean(data[key]);
      else input.value = data[key];
    }

    const regControls = document.getElementById('regular-controls');
    if (regControls) regControls.classList.toggle('disabled', !data.enabled);

    if (status) {
      status.className = `status-pill${!data.enabled ? ' off' : data.strictBlock ? ' strict' : ''}`;
      status.textContent = !data.enabled ? 'Off' : data.strictBlock ? 'Strict block' : 'Protected';
    }

    renderStats();
    updateQualityVerification();

    if (tip) {
      if (active === 'facebook') {
        tip.innerHTML = 'For Facebook Reels: set <b>Video Default Quality → SD Only</b> in settings. Supports <b>Radio Mode</b> (sound only).';
      } else if (active === 'x') {
        tip.innerHTML = 'X HLS streams are capped to low-bitrate variants. Press <b>Alt + Q</b> on the page to cycle quality anytime.';
      } else if (active === 'tiktok') {
        tip.innerHTML = 'TikTok feeds are capped via XGPlayer bitrate adaptation. Offscreen videos pause automatically to save bandwidth.';
      } else {
        tip.innerHTML = 'YouTube supports <b>Radio Mode</b> (sound only, zero video chunks) and resolution caps. Press <b>Alt + Q</b> to cycle.';
      }
    }
  }

  for (const [site, button] of Object.entries(tabs)) {
    if (button) {
      button.addEventListener('click', () => { active = site; render(); });
    }
  }

  for (const input of controls) {
    input.addEventListener('change', async () => {
      const key = input.dataset.setting;
      config[active][key] = input.type === 'checkbox' ? input.checked : input.value;
      render();
      try {
        await chrome.storage.local.set({settings: config});
        if (saved) saved.textContent = '✓ Saved — refresh site if needed';
      } catch (error) {
        if (saved) saved.textContent = 'Could not save settings: ' + error.message;
      }
    });
  }

  const nativeSettingsBtn = document.getElementById('native-settings');
  if (nativeSettingsBtn) {
    nativeSettingsBtn.addEventListener('click', () => {
      let url = 'https://www.facebook.com/settings/?tab=videos';
      if (active === 'x') url = 'https://x.com/settings/data';
      else if (active === 'tiktok') url = 'https://www.tiktok.com/setting';
      else if (active === 'youtube') url = 'https://www.youtube.com/account_playback';
      chrome.tabs.create({url});
    });
  }

  chrome.storage.local.get(['settings', 'stats']).then(async data => {
    config = QuotaGuard.normalize(data.settings);
    stats = QuotaGuard.normalizeStats(data.stats);
    try {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      if (tab?.url) {
        const detected = QuotaGuard.siteForHost(new URL(tab.url).hostname);
        if (detected) active = detected;
      }
    } catch (_) {}
    render();
  }).catch(error => {
    if (saved) saved.textContent = error.message;
  });

  function formatBytesPerSec(bytes) {
    if (!bytes || bytes < 1024) return `${Math.round(bytes || 0)} B/s`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB/s`;
    const mb = kb / 1024;
    return `${mb.toFixed(2)} MB/s`;
  }

  function updateLiveSpeed() {
    chrome.storage.local.get('liveSpeed').then(data => {
      const s = data.liveSpeed;
      const dlEl = document.getElementById('meter-dl');
      const ulEl = document.getElementById('meter-ul');
      if (dlEl && s) dlEl.textContent = formatBytesPerSec(s.dl);
      if (ulEl && s) ulEl.textContent = formatBytesPerSec(s.ul);

      if (s?.history && Array.isArray(s.history) && s.history.length > 0) {
        drawSparkline(sparklineCanvas, s.history);
      } else if (s) {
        localSpeedHistory.push({ dl: s.dl || 0, ul: s.ul || 0 });
        if (localSpeedHistory.length > 20) localSpeedHistory.shift();
        drawSparkline(sparklineCanvas, localSpeedHistory);
      }
    }).catch(() => {});
  }

  updateLiveSpeed();
  const speedInterval = setInterval(updateLiveSpeed, 1000);
  window.addEventListener('unload', () => clearInterval(speedInterval));
})();
