importScripts('settings.js');

const MANAGED_RULE_IDS = [1001, 1002, 1003, 1004, 1101, 1201, 1202, 1301, 1401, 1402, 1501, 1502];

async function syncBlockingRules() {
  const stored = await chrome.storage.local.get('settings');
  const settings = QuotaGuard.normalize(stored.settings);
  const addRules = [];

  // Network Layer Data Saving Headers (Save-Data: on, Downlink: 0.35, ECT: 3g)
  // Forces Facebook and X CDNs/backends to serve low-resolution streams natively.
  if (settings.facebook.enabled && settings.facebook.quality !== 'auto') {
    addRules.push({
      id: 1001, priority: 2,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Save-Data', operation: 'set', value: 'on' },
          { header: 'Downlink', operation: 'set', value: '0.35' },
          { header: 'ECT', operation: 'set', value: '3g' },
          { header: 'Sec-CH-Prefers-Reduced-Data', operation: 'set', value: '1' }
        ]
      },
      condition: {
        requestDomains: ['facebook.com', 'fbcdn.net'],
        resourceTypes: ['xmlhttprequest', 'media', 'sub_frame', 'other']
      }
    });
  }

  if (settings.x.enabled && settings.x.quality !== 'auto') {
    addRules.push({
      id: 1002, priority: 2,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Save-Data', operation: 'set', value: 'on' },
          { header: 'Downlink', operation: 'set', value: '0.35' },
          { header: 'ECT', operation: 'set', value: '3g' }
        ]
      },
      condition: {
        requestDomains: ['x.com', 'twitter.com', 'twimg.com'],
        resourceTypes: ['xmlhttprequest', 'media', 'sub_frame', 'other']
      }
    });
  }

  if (settings.tiktok.enabled && settings.tiktok.quality !== 'auto') {
    addRules.push({
      id: 1003, priority: 2,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Save-Data', operation: 'set', value: 'on' },
          { header: 'Downlink', operation: 'set', value: '0.35' },
          { header: 'ECT', operation: 'set', value: '3g' },
          { header: 'Sec-CH-Prefers-Reduced-Data', operation: 'set', value: '1' }
        ]
      },
      condition: {
        requestDomains: ['tiktok.com', 'tiktokv.com', 'tiktokcdn.com', 'byteoversea.com', 'ibytedtos.com'],
        resourceTypes: ['xmlhttprequest', 'media', 'sub_frame', 'other']
      }
    });
  }

  if (settings.youtube.enabled && settings.youtube.quality !== 'auto') {
    addRules.push({
      id: 1004, priority: 2,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Save-Data', operation: 'set', value: 'on' },
          { header: 'Downlink', operation: 'set', value: '0.35' },
          { header: 'ECT', operation: 'set', value: '3g' },
          { header: 'Sec-CH-Prefers-Reduced-Data', operation: 'set', value: '1' }
        ]
      },
      condition: {
        requestDomains: ['youtube.com', 'googlevideo.com', 'ytimg.com'],
        resourceTypes: ['xmlhttprequest', 'media', 'sub_frame', 'other']
      }
    });
  }

  if (settings.facebook.enabled && settings.facebook.strictBlock) {
    addRules.push({
      id: 1101, priority: 1, action: {type: 'block'},
      condition: {initiatorDomains: ['facebook.com'], resourceTypes: ['media']}
    });
    // Facebook sometimes loads video segments with fetch/XHR from video CDNs.
    addRules.push({
      id: 1301, priority: 1, action: {type: 'block'},
      condition: {
        initiatorDomains: ['facebook.com'],
        regexFilter: '^https?://[^/]*video[^/]*\\.fbcdn\\.net/',
        resourceTypes: ['xmlhttprequest', 'other']
      }
    });
  }

  if (settings.x.enabled && settings.x.strictBlock) {
    addRules.push({
      id: 1201, priority: 1, action: {type: 'block'},
      condition: {initiatorDomains: ['x.com', 'twitter.com'], resourceTypes: ['media']}
    });
    addRules.push({
      id: 1202, priority: 1, action: {type: 'block'},
      condition: {
        initiatorDomains: ['x.com', 'twitter.com'],
        requestDomains: ['video.twimg.com'],
        resourceTypes: ['xmlhttprequest', 'other']
      }
    });
  }

  if (settings.tiktok.enabled && settings.tiktok.strictBlock) {
    addRules.push({
      id: 1401, priority: 1, action: {type: 'block'},
      condition: {initiatorDomains: ['tiktok.com'], resourceTypes: ['media']}
    });
    addRules.push({
      id: 1402, priority: 1, action: {type: 'block'},
      condition: {
        initiatorDomains: ['tiktok.com'],
        requestDomains: ['tiktokcdn.com', 'byteoversea.com', 'ibytedtos.com'],
        resourceTypes: ['xmlhttprequest', 'other']
      }
    });
  }

  if (settings.youtube.enabled && settings.youtube.strictBlock) {
    addRules.push({
      id: 1501, priority: 1, action: {type: 'block'},
      condition: {initiatorDomains: ['youtube.com'], resourceTypes: ['media']}
    });
    addRules.push({
      id: 1502, priority: 1, action: {type: 'block'},
      condition: {
        initiatorDomains: ['youtube.com'],
        requestDomains: ['googlevideo.com'],
        resourceTypes: ['xmlhttprequest', 'other']
      }
    });
  }

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: MANAGED_RULE_IDS, addRules
  });
}

chrome.runtime.onInstalled.addListener(() => syncBlockingRules().catch(console.warn));
chrome.runtime.onStartup.addListener(() => syncBlockingRules().catch(console.warn));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) syncBlockingRules().catch(console.warn);
});
// Reconcile pre-existing settings when the service worker starts.
syncBlockingRules().catch(console.warn);

// --- Live Browser-Wide Network Speed Monitor ---
let currentIntervalDl = 0;
let currentIntervalUl = 0;
let lastDlSpeed = 0;
let lastUlSpeed = 0;
let speedHistory = [];
let monitorTimer = 0;

function formatBadgeSpeed(bytesPerSec, ulBytesPerSec) {
  if (bytesPerSec >= 1024) {
    const kb = bytesPerSec / 1024;
    if (kb < 999) return `${Math.round(kb)}K`;
    const mb = kb / 1024;
    return mb < 10 ? `${mb.toFixed(1)}M` : `${Math.round(mb)}M`;
  }
  if (ulBytesPerSec >= 1024) {
    const kb = ulBytesPerSec / 1024;
    if (kb < 999) return `↑${Math.round(kb)}K`;
    const mb = kb / 1024;
    return mb < 10 ? `↑${mb.toFixed(1)}M` : `↑${Math.round(mb)}M`;
  }
  return '';
}

function formatSpeedFull(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec < 1024) return `${Math.round(bytesPerSec || 0)} B/s`;
  const kb = bytesPerSec / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB/s`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB/s`;
}

function tickSpeedMonitor() {
  lastDlSpeed = currentIntervalDl;
  lastUlSpeed = currentIntervalUl;
  currentIntervalDl = 0;
  currentIntervalUl = 0;

  speedHistory.push({ dl: lastDlSpeed, ul: lastUlSpeed });
  if (speedHistory.length > 20) speedHistory.shift();

  // Update Toolbar Icon Badge
  const badgeText = formatBadgeSpeed(lastDlSpeed, lastUlSpeed);
  try {
    chrome.action.setBadgeText({ text: badgeText });
    chrome.action.setBadgeBackgroundColor({ color: '#102d2c' });
    if (chrome.action.setBadgeTextColor) {
      chrome.action.setBadgeTextColor({ color: '#7af8c3' });
    }
  } catch (_) {}

  // Update Toolbar Icon Hover Tooltip
  try {
    const tooltip = `QuotaGuard Network Usage:\n↓ ${formatSpeedFull(lastDlSpeed)} Download\n↑ ${formatSpeedFull(lastUlSpeed)} Upload`;
    chrome.action.setTitle({ title: tooltip });
  } catch (_) {}

  // Update local storage so popup can display real-time usage
  chrome.storage.local.set({
    liveSpeed: {
      dl: lastDlSpeed,
      ul: lastUlSpeed,
      history: speedHistory,
      time: Date.now()
    }
  }).catch(() => {});
}

// Track browser-wide downloads via webRequest response headers
if (chrome.webRequest?.onResponseStarted) {
  try {
    chrome.webRequest.onResponseStarted.addListener(
      details => {
        let bytes = 0;
        if (details.responseHeaders) {
          for (const h of details.responseHeaders) {
            const name = h.name.toLowerCase();
            if (name === 'content-length') {
              bytes = parseInt(h.value, 10) || 0;
              break;
            }
            if (name === 'content-range') {
              const m = h.value.match(/bytes\s+(\d+)-(\d+)/i);
              if (m) bytes = (parseInt(m[2], 10) - parseInt(m[1], 10) + 1) || 0;
              break;
            }
          }
        }
        currentIntervalDl += (bytes > 0 ? bytes : 1024);
      },
      { urls: ['<all_urls>'] },
      ['responseHeaders']
    );
  } catch (err) {
    console.warn('webRequest onResponseStarted init error:', err);
  }
}

// Track browser-wide uploads via webRequest request headers
if (chrome.webRequest?.onBeforeSendHeaders) {
  try {
    chrome.webRequest.onBeforeSendHeaders.addListener(
      details => {
        let bytes = 0;
        if (details.requestHeaders) {
          for (const h of details.requestHeaders) {
            if (h.name.toLowerCase() === 'content-length') {
              bytes = parseInt(h.value, 10) || 0;
              break;
            }
          }
        }
        currentIntervalUl += (bytes > 0 ? bytes : 512);
      },
      { urls: ['<all_urls>'] },
      ['requestHeaders']
    );
  } catch (err) {
    console.warn('webRequest onBeforeSendHeaders init error:', err);
  }
}

if (!monitorTimer) {
  monitorTimer = setInterval(tickSpeedMonitor, 1000);
}
