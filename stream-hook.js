/* Intercept HLS master playlists, MPEG-DASH manifests, and GraphQL payloads in page-world.
 * Restricts advertised variants to the user-chosen resolution before the player downloads chunks.
 * Spoofs connection speed to 3G/saveData to force Facebook's native ABR engine to low bitrate.
 * Hooks DOMParser, JSON.parse, Fetch (text, json, arrayBuffer, ReadableStream), and XMLHttpRequest.
 * Does not touch cookies, user credentials, account APIs, or video segments.
 */
(() => {
  'use strict';
  if (window.__qgStreamHook) return;
  window.__qgStreamHook = true;

  function quality() {
    const node = document.documentElement;
    if (node?.getAttribute('data-qg-enabled') !== 'yes') {
      // If content.js has not set attributes yet, use default 360p
      return '360';
    }
    return node?.getAttribute('data-qg-quality') || '360';
  }

  // --- Network Connection Spoofing (Only for Facebook where native ABR requires downlink hints) ---
  // Avoid touching navigator.connection on TikTok/YouTube/X where SDKs (like Slardar) bind to native slots.
  try {
    const host = location.hostname.toLowerCase();
    if (host.includes('facebook.com') && navigator.connection) {
      const origConn = navigator.connection;
      const getQualityDownlink = () => {
        const q = quality();
        if (q === '240' || q === 'audio') return 0.35;
        if (q === '360') return 0.75;
        if (q === '480') return 1.4;
        return origConn.downlink;
      };
      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        enumerable: true,
        get() {
          const q = quality();
          if (q === 'auto') return origConn;
          return new Proxy(origConn, {
            get(target, prop) {
              if (prop === 'downlink') return getQualityDownlink();
              if (prop === 'effectiveType') return (q === '240' || q === 'audio') ? '2g' : '3g';
              if (prop === 'rtt') return (q === '240' || q === 'audio') ? 600 : 350;
              if (prop === 'saveData') return true;
              const val = Reflect.get(target, prop, target);
              return typeof val === 'function' ? val.bind(target) : val;
            },
            set(target, prop, value) {
              try { target[prop] = value; } catch (_) {}
              return true;
            }
          });
        }
      });
    }
  } catch (_) {}

  // YouTube Anti-Adblock Compliance:
  // Do NOT define accessor properties (getter/setter) on window.ytInitialPlayerResponse.
  // YouTube's anti-adblock integrity checker specifically probes Object.getOwnPropertyDescriptor(window, 'ytInitialPlayerResponse').
  // Defining an accessor descriptor immediately triggers YouTube's "Ad blockers violate YouTube's Terms of Service" banner.
  // YouTube video quality is securely enforced via the official HTML5 Player API (#movie_player.setPlaybackQualityRange).

  function classifyUrl(raw) {
    try {
      const url = new URL(String(raw), location.href);
      const host = url.hostname.toLowerCase();
      const href = url.href.toLowerCase();

      // HLS Master Playlists (X / Twitter, TikTok Live, and video CDNs)
      if (/\.m3u8(?:$|[?#])/i.test(url.href)) {
        return 'hls';
      }

      // MPEG-DASH Manifests & GraphQL / Video delivery (Facebook / general DASH)
      if (/\.mpd(?:$|[?#])/i.test(url.href) || href.includes('/dash/') ||
          (host.endsWith('facebook.com') && (href.includes('graphql') || href.includes('/ajax/') || href.includes('video')))) {
        return 'dash';
      }

      // TikTok video API endpoints, feed items, and profile lists
      if ((host.endsWith('tiktok.com') || host.endsWith('tiktokv.com')) &&
          (href.includes('item_list') || href.includes('item/detail') || href.includes('/feed/') ||
           href.includes('recommend') || href.includes('/post/') || href.includes('/user/') ||
           href.includes('/explore/') || href.includes('/related/') || href.includes('/share/') ||
           href.includes('/aweme/'))) {
        return 'tiktok';
      }

      // YouTube InnerTube player API endpoints
      if ((host.endsWith('youtube.com') || host === 'youtu.be') &&
          (href.includes('/youtubei/v1/player') || href.includes('/player?') || href.includes('get_video_info'))) {
        return 'youtube';
      }

      return null;
    } catch (_) { return null; }
  }

  let lastNotifiedCap = null;
  function notifyCapApplied(type, selectedQuality) {
    const key = `${type}:${selectedQuality}`;
    if (lastNotifiedCap === key) return;
    lastNotifiedCap = key;
    // Dispatch asynchronously outside the current execution stack to prevent call-stack recursion
    setTimeout(() => {
      try {
        document.dispatchEvent(new CustomEvent('qg-cap-applied', {
          detail: { type, quality: selectedQuality, time: Date.now() }
        }));
      } catch (_) {}
    }, 0);
  }

  function adapt(text, type) {
    const q = quality();
    if (q === 'auto' || typeof text !== 'string') return text;

    try {
      // HLS stream cap
      if ((type === 'hls' || text.startsWith('#EXTM3U')) && window.QuotaGuardHls) {
        const result = window.QuotaGuardHls.limit(text, q);
        if (result.changed && result.selected) {
          const status = `${result.selected}p HLS cap applied`;
          if (document.documentElement?.getAttribute('data-qg-quality-applied') !== status) {
            document.documentElement?.setAttribute('data-qg-quality-applied', status);
            notifyCapApplied('hls', result.selected);
          }
        }
        return result.text;
      }

      // DASH stream cap & GraphQL HD progressive MP4 suppression
      if ((type === 'dash' || text.includes('<MPD') || text.includes('dash_manifest') || text.includes('playable_url')) && window.QuotaGuardDash) {
        const result = window.QuotaGuardDash.limitDash(text, q);
        let adapted = result.text;
        let applied = false;

        if (result.changed && result.selected) {
          applied = true;
          const status = result.selected === 'audio'
            ? 'Radio mode (sound only) applied'
            : (result.fallbackLowest
                ? `${result.selected}p stream active (Lowest on server)`
                : `${result.selected}p DASH cap applied`);
          if (document.documentElement?.getAttribute('data-qg-quality-applied') !== status) {
            document.documentElement?.setAttribute('data-qg-quality-applied', status);
            notifyCapApplied('dash', result.selected);
          }
        }

        // Neutralize all high-definition progressive MP4 fields, forcing player fallback to SD (playable_url)
        // If in Radio Mode, also strip playable_url so no progressive video is downloaded
        if (adapted.includes('playable_url_quality_hd') || adapted.includes('browser_native_hd_url') || adapted.includes('hd_src') || q === 'audio') {
          adapted = adapted.replace(/"playable_url_quality_hd"\s*:\s*"[^"]*"/g, '"playable_url_quality_hd":null');
          adapted = adapted.replace(/"browser_native_hd_url"\s*:\s*"[^"]*"/g, '"browser_native_hd_url":null');
          adapted = adapted.replace(/"hd_src"\s*:\s*"[^"]*"/g, '"hd_src":null');
          adapted = adapted.replace(/"hd_src_no_ratelimit"\s*:\s*"[^"]*"/g, '"hd_src_no_ratelimit":null');
          if (q === 'audio') {
            adapted = adapted.replace(/"playable_url"\s*:\s*"[^"]*"/g, '"playable_url":null');
          }
          if (!applied && document.documentElement?.getAttribute('data-qg-quality-applied') !== 'SD stream applied') {
            document.documentElement?.setAttribute('data-qg-quality-applied', 'SD stream applied');
            notifyCapApplied('mp4_sd', 'SD');
          }
        }

        return adapted;
      }

      // TikTok video payload reduction (prunes high-bitrate XGPlayer representations)
      if ((type === 'tiktok' || text.includes('bitrateInfo') || text.includes('bit_rate')) && window.QuotaGuardTikTok) {
        const result = window.QuotaGuardTikTok.limitTikTok(text, q);
        if (result.changed && result.selected) {
          const status = `${result.selected}p TikTok cap applied`;
          if (document.documentElement?.getAttribute('data-qg-quality-applied') !== status) {
            document.documentElement?.setAttribute('data-qg-quality-applied', status);
            notifyCapApplied('tiktok', result.selected);
          }
        }
        return result.text;
      }

      // YouTube video payload reduction (prunes high-resolution formats from streamingData or enables Radio Mode)
      if ((type === 'youtube' || text.includes('streamingData')) && window.QuotaGuardYouTube) {
        const result = window.QuotaGuardYouTube.limitYouTubeStreamingData(text, q);
        if (result.changed && result.selected) {
          const status = result.selected === 'audio'
            ? 'Radio mode (sound only) applied'
            : (result.fallbackLowest
                ? `${result.selected}p YouTube stream active (Lowest on server)`
                : `${result.selected}p YouTube cap applied`);
          if (document.documentElement?.getAttribute('data-qg-quality-applied') !== status) {
            document.documentElement?.setAttribute('data-qg-quality-applied', status);
            notifyCapApplied('youtube', result.selected);
          }
        }
        return result.text;
      }

      return text;
    } catch (_) {
      // Fail-open guarantee: never interrupt playback on parsing errors
      return text;
    }
  }

  // --- DOMParser Hook (Catches XML DASH manifests parsed by players regardless of transport) ---
  if (typeof DOMParser !== 'undefined' && DOMParser.prototype?.parseFromString) {
    const originalParseFromString = DOMParser.prototype.parseFromString;
    DOMParser.prototype.parseFromString = function(str, mime) {
      if (typeof str === 'string' && quality() !== 'auto' &&
          (str.includes('<MPD') || str.includes('dash_manifest'))) {
        str = adapt(str, 'dash');
      }
      return originalParseFromString.call(this, str, mime);
    };
  }

  // --- JSON.parse Hook (Catches SSR payloads and initial Relay cache) ---
  const originalJsonParse = JSON.parse;
  let isParsingJson = false;
  JSON.parse = function (text, reviver) {
    if (isParsingJson || typeof text !== 'string' || quality() === 'auto') {
      return originalJsonParse.call(this, text, reviver);
    }
    isParsingJson = true;
    try {
      if (text.includes('dash_manifest') || text.includes('playable_url') || text.includes('<MPD')) {
        text = adapt(text, 'dash');
      } else if (text.includes('bitrateInfo') || text.includes('bit_rate')) {
        text = adapt(text, 'tiktok');
      } else if (text.includes('streamingData')) {
        text = adapt(text, 'youtube');
      }
    } catch (_) {}
    finally {
      isParsingJson = false;
    }
    return originalJsonParse.call(this, text, reviver);
  };

  // --- Fetch Hook ---
  const nativeFetch = window.fetch;
  window.fetch = function (...args) {
    const rawUrl = typeof args[0] === 'string'
      ? args[0]
      : (args[0] instanceof URL ? args[0].href : args[0]?.url);

    const streamType = classifyUrl(rawUrl);
    if (!streamType || quality() === 'auto') return Reflect.apply(nativeFetch, window, args);

    return Reflect.apply(nativeFetch, window, args).then(response => {
      if (!response.ok) return response;
      return new Proxy(response, {
        get(target, prop) {
          if (prop === 'text') return async () => adapt(await target.text(), streamType);
          if (prop === 'json') return async () => {
            const raw = await target.text();
            const adapted = adapt(raw, streamType);
            try { return originalJsonParse(adapted); }
            catch (_) { return originalJsonParse(raw); }
          };
          if (prop === 'arrayBuffer') return async () => {
            const bytes = await target.arrayBuffer();
            return new TextEncoder().encode(adapt(new TextDecoder().decode(bytes), streamType)).buffer;
          };
          if (prop === 'body') {
            const origBody = target.body;
            if (!origBody || typeof TransformStream === 'undefined') return origBody;
            try {
              const decoder = new TextDecoder();
              const encoder = new TextEncoder();
              let buf = '';
              const transform = new TransformStream({
                transform(chunk, controller) {
                  const text = decoder.decode(chunk, { stream: true });
                  buf += text;
                  if (buf.includes('dash_manifest') || buf.includes('playable_url') || buf.includes('<MPD') ||
                      buf.includes('bitrateInfo') || buf.includes('bit_rate') || buf.includes('streamingData')) {
                    const adapted = adapt(buf, streamType);
                    controller.enqueue(encoder.encode(adapted));
                    buf = '';
                  } else {
                    controller.enqueue(chunk);
                  }
                },
                flush(controller) {
                  if (buf.length > 0) {
                    const finalStr = buf + decoder.decode();
                    const adapted = adapt(finalStr, streamType);
                    controller.enqueue(encoder.encode(adapted));
                    buf = '';
                  }
                }
              });
              return origBody.pipeThrough(transform);
            } catch (_) {
              return origBody;
            }
          }
          if (prop === 'clone') return () => new Proxy(target.clone(), this);
          const value = Reflect.get(target, prop, target);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
    });
  };

  // --- XMLHttpRequest Hook ---
  const XHR = window.XMLHttpRequest;
  if (!XHR) return;
  const originalOpen = XHR.prototype.open;
  XHR.prototype.open = function(method, url, ...args) {
    this.__qgStreamType = classifyUrl(url);
    this.__qgAdaptedResponse = null;
    this.__qgAdaptedText = null;
    this.__qgAdaptedJson = null;
    return Reflect.apply(originalOpen, this, [method, url, ...args]);
  };

  for (const prop of ['responseText', 'response']) {
    const descriptor = Object.getOwnPropertyDescriptor(XHR.prototype, prop);
    if (!descriptor?.get || !descriptor.configurable) continue;
    Object.defineProperty(XHR.prototype, prop, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        const value = descriptor.get.call(this);
        if (this.__qgStreamType && quality() !== 'auto' && this.readyState === 4) {
          if (prop === 'responseText' || typeof value === 'string') {
            if (this.__qgAdaptedText === null) {
              this.__qgAdaptedText = adapt(value, this.__qgStreamType);
            }
            return this.__qgAdaptedText;
          }
          if (prop === 'response' && value instanceof ArrayBuffer) {
            if (this.__qgAdaptedResponse === null) {
              const decoded = new TextDecoder().decode(value);
              const modified = adapt(decoded, this.__qgStreamType);
              this.__qgAdaptedResponse = new TextEncoder().encode(modified).buffer;
            }
            return this.__qgAdaptedResponse;
          }
          if (prop === 'response' && this.responseType === 'json' && typeof value === 'object' && value !== null) {
            if (this.__qgAdaptedJson === null) {
              const modified = adapt(JSON.stringify(value), this.__qgStreamType);
              try { this.__qgAdaptedJson = originalJsonParse(modified); }
              catch (_) { this.__qgAdaptedJson = value; }
            }
            return this.__qgAdaptedJson;
          }
        }
        return value;
      }
    });
  }
})();
