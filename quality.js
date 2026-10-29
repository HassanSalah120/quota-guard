/* Quality selection only works when the website actually exposes choices. */
(function (root) {
  'use strict';
  function parseResolution(label) {
    const clean = String(label || '').replace(/\s+/g, ' ').trim();
    // Accept "360p", "360p (recommended)", "360p • ..." but not random UI text.
    const match = clean.match(/^(?:quality\s*[:=-]\s*)?(\d{3,4})\s*p\b/i);
    return match ? Number(match[1]) : null;
  }
  function choose(options, preference) {
    if (preference === 'auto') return null;
    const target = Number(preference);
    if (![240, 360, 480].includes(target)) return null;
    const available = options.map(option => ({...option, resolution: parseResolution(option.label)}))
      .filter(option => option.resolution !== null);
    if (available.length >= 2) {
      const lowerOrEqual = available.filter(opt => opt.resolution <= target)
        .sort((a, b) => b.resolution - a.resolution);
      return lowerOrEqual[0] || [...available].sort((a, b) => a.resolution - b.resolution)[0];
    }
    if (available.length === 1) return available[0];
    // Some Facebook menus only offer SD / HD instead of numbered variants.
    return options.find(option => /^(?:SD(?: only)?|low(?: quality)?|data saver|standard definition)(?:\s*[✓✔])?$/i.test(
      String(option.label || '').trim()
    )) || null;
  }
  root.QuotaGuardQuality = { parseResolution, choose };
})(globalThis);
