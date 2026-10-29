/* Best-effort, site-owned player controls. Never chooses a resolution absent
 * from the player. Never clicks arbitrary 'Settings' page-navigation controls.
 */
(function (root) {
  'use strict';
  const CLICKABLE = 'button, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="option"]';
  function visible(el) {
    if (!el?.isConnected || !el.getClientRects().length) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden';
  }
  function label(el) { return [el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent].filter(Boolean).join(' ').trim(); }
  function videoRoot(video) {
    const named = video.closest('[data-testid="videoPlayer"], [data-testid="videoComponent"], [data-testid="videoPlayerControls"], [data-testid="videoPlayerOverlay"]');
    if (named) return named;
    let parent = video;
    for (let depth = 0; depth < 5 && parent?.parentElement; depth++) parent = parent.parentElement;
    return parent || video.parentElement;
  }
  function gear(video) {
    const container = videoRoot(video);
    if (!container) return null;
    const buttons = [...container.querySelectorAll(CLICKABLE)];
    const hits = buttons.filter(el => {
      const a = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('data-testid') || ''}`;
      return /(?:video\s*)?(?:settings|quality|playback settings|الإعدادات|الجودة)/i.test(a) && visible(el);
    });
    return hits[0] || null;
  }
  function menus() {
    return [...document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"], [data-testid*="quality" i]')].filter(visible);
  }
  function menuActions() {
    const seen = new Set();
    const out = [];
    for (const menu of menus()) {
      for (const el of menu.querySelectorAll(CLICKABLE)) {
        if (!seen.has(el) && visible(el)) { seen.add(el); out.push(el); }
      }
      if (menu.matches(CLICKABLE) && !seen.has(menu)) { seen.add(menu); out.push(menu); }
    }
    return out;
  }
  function qualitySubmenuAction() {
    return menuActions().find(el => /^(?:quality|video quality|الجودة|جودة الفيديو)\s*(?:[:›>]|$)/i.test(label(el)));
  }
  function resolutionAction(target) {
    return root.QuotaGuardQuality.choose(
      menuActions().map(el => ({el, label: label(el)})), target
    )?.el || null;
  }
  root.QuotaGuardPlayer = {gear, menuActions, qualitySubmenuAction, resolutionAction, visible};
})(globalThis);
