importScripts('settings.js');

const MANAGED_RULE_IDS = [1001, 1002, 1003, 1004, 1101, 1201, 1202, 1301, 1401, 1402, 1501, 1502];

function downlinkHint(quality) {
  return ({audio: '0.1', 240: '0.35', 360: '0.75', 480: '1.4', 540: '1.5', 720: '2.5'})[quality] || '0.75';
}

async function syncBlockingRules() {
  const stored = await chrome.storage.local.get('settings');
  const settings = QuotaGuard.normalize(stored.settings);
  const addRules = [];

  // Request reduced-data variants where the server supports these hints.
  if (settings.facebook.enabled && settings.facebook.quality !== 'auto') {
    addRules.push({
      id: 1001, priority: 2,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Save-Data', operation: 'set', value: 'on' },
          { header: 'Downlink', operation: 'set', value: downlinkHint(settings.facebook.quality) },
          { header: 'ECT', operation: 'set', value: '3g' }
        ]
      },
      condition: {
        initiatorDomains: ['facebook.com'],
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
          { header: 'Downlink', operation: 'set', value: downlinkHint(settings.x.quality) },
          { header: 'ECT', operation: 'set', value: '3g' }
        ]
      },
      condition: {
        initiatorDomains: ['x.com', 'twitter.com'],
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
          { header: 'Downlink', operation: 'set', value: downlinkHint(settings.tiktok.quality) },
          { header: 'ECT', operation: 'set', value: '3g' }
        ]
      },
      condition: {
        initiatorDomains: ['tiktok.com'],
        requestDomains: ['tiktok.com', 'tiktokv.com', 'tiktokcdn.com', 'byteoversea.com', 'ibytedtos.com'],
        resourceTypes: ['xmlhttprequest', 'media', 'sub_frame', 'other']
      }
    });
  }

  // Leave YouTube request headers intact; use stream filtering and player controls.

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

// One writer prevents lost counter updates when several tabs report together.
let storageQueue = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!['qg-stat', 'qg-setting'].includes(message?.type)) return;
  let senderSite = null;
  try { senderSite = QuotaGuard.siteForHost(new URL(sender.url || sender.tab?.url).hostname); } catch (_) {}
  const isPopup = sender.url === chrome.runtime.getURL('popup.html');
  const site = message.type === 'qg-stat' ? senderSite : message.site;
  const validStat = message.type === 'qg-stat' && senderSite && Object.hasOwn(QuotaGuard.DEFAULT_STATS, message.field);
  const validSetting = message.type === 'qg-setting' && Object.hasOwn(QuotaGuard.DEFAULTS, site || '') &&
    (isPopup || senderSite === site) && Object.hasOwn(QuotaGuard.DEFAULTS[site], message.key);
  if (!validStat && !validSetting) {
    sendResponse({ok: false});
    return;
  }
  storageQueue = storageQueue.catch(() => {}).then(async () => {
    if (validStat) {
      const stored = await chrome.storage.local.get('activity');
      const activity = QuotaGuard.normalizeStats(stored.activity);
      activity[site][message.field] += 1;
      await chrome.storage.local.set({activity});
    } else {
      const stored = await chrome.storage.local.get('settings');
      const settings = QuotaGuard.normalize(stored.settings);
      settings[site][message.key] = message.value;
      const normalized = QuotaGuard.normalize(settings);
      if (normalized[site][message.key] !== message.value) throw new Error('Invalid setting');
      await chrome.storage.local.set({settings: normalized});
    }
  });
  storageQueue.then(() => sendResponse({ok: true}), () => sendResponse({ok: false}));
  return true;
});

// Serialize reconciliations so rapid setting changes cannot restore stale rules.
let rulesQueue = Promise.resolve();
function reconcileRules() {
  rulesQueue = rulesQueue.catch(() => {}).then(syncBlockingRules);
  rulesQueue.catch(console.warn);
}
chrome.runtime.onInstalled.addListener(() => {
  reconcileRules();
  chrome.action.setBadgeText({text: ''});
  chrome.action.setTitle({title: 'QuotaGuard Data Saver'});
});
chrome.runtime.onStartup.addListener(reconcileRules);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) reconcileRules();
});
reconcileRules();

// Native <video src> requests bypass window.fetch. Read server size headers on
// the granted media hosts; never consume the body or invent missing lengths.
const mediaRequestUrls = new Map();
const mediaRequestFilter = {urls: chrome.runtime.getManifest().host_permissions, types: ['media', 'xmlhttprequest', 'other']};
chrome.webRequest.onBeforeRequest.addListener(details => {
  if (details.tabId >= 0 && !mediaRequestUrls.has(details.requestId)) {
    if (mediaRequestUrls.size >= 500) mediaRequestUrls.delete(mediaRequestUrls.keys().next().value);
    mediaRequestUrls.set(details.requestId, details.url);
  }
}, mediaRequestFilter);
chrome.webRequest.onResponseStarted.addListener(details => {
  if (details.tabId < 0 || details.statusCode < 200 || details.statusCode >= 300) return;
  const headers = Object.fromEntries((details.responseHeaders || []).map(header => [header.name.toLowerCase(), header.value || '']));
  if (!/^(video|audio)\//i.test(headers['content-type'] || '') && details.type !== 'media') return;
  const range = /^bytes\s+\d+-\d+\/(\d+)$/i.exec(headers['content-range'] || '');
  let bytes = range ? Number(range[1]) : null;
  const url = mediaRequestUrls.get(details.requestId) || details.url;
  if (bytes === null && details.statusCode === 200 && !/[?&](?:range|sq|part|segment)=/i.test(url) && /^\d+$/.test(headers['content-length'] || '')) {
    bytes = Number(headers['content-length']);
  }
  if (!Number.isSafeInteger(bytes) || bytes < 0) return;
  for (const sourceUrl of new Set([url, details.url])) {
    chrome.tabs.sendMessage(details.tabId, {type: 'qg-media-size', url: sourceUrl, bytes}).catch(() => {});
  }
}, mediaRequestFilter, ['responseHeaders']);
const forgetMediaRequest = details => mediaRequestUrls.delete(details.requestId);
chrome.webRequest.onCompleted.addListener(forgetMediaRequest, mediaRequestFilter);
chrome.webRequest.onErrorOccurred.addListener(forgetMediaRequest, mediaRequestFilter);
