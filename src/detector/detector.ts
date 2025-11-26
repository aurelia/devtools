import { applyDevtoolsOptOutState } from '../shared/devtools-optout';

const devtoolsDisabled =
  applyDevtoolsOptOutState(window) ||
  (window as any).__AURELIA_DEVTOOLS_DISABLED__ === true ||
  (window as any).__AURELIA_DEVTOOLS_DISABLE__ === true ||
  (window as any).AURELIA_DEVTOOLS_DISABLE === true;

if (devtoolsDisabled) {
  (window as any).__AURELIA_DEVTOOLS_DETECTION_STATE__ = 'disabled';
  (window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__ = null;
  (window as any).__AURELIA_DEVTOOLS_VERSION__ = null;
} else {
  // Helper to set detection flags consistently
  function setDetected(version: 1 | 2) {
    if (applyDevtoolsOptOutState(window)) {
      return;
    }
    (window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__ = version;
    (window as any).__AURELIA_DEVTOOLS_VERSION__ = version;
    (window as any).__AURELIA_DEVTOOLS_DETECTION_STATE__ = 'detected';
    try { chrome.runtime.sendMessage({ aureliaDetected: true, version }); } catch {}
  }

  // detects V1
  window.addEventListener(
    'aurelia-composed',
    () => setDetected(1),
    { once: true }
  );

  // detects V2
  window.addEventListener(
    'au-started',
    () => setDetected(2),
    { once: true }
  );

  // Fallback: if events fired before our listener, probe the DOM after load
  function probeAfterLoad() {
    try {
      if (document.querySelector('[aurelia-app]') || (window as any).aurelia) return setDetected(1);
      if (document.querySelector('[au-started]') || (window as any).Aurelia) return setDetected(2);
      // Deep scan for $au (v2) or .au (v1)
      const elements = document.querySelectorAll('*');
      for (const el of Array.from(elements) as any[]) {
        if (el.$au) return setDetected(2);
        if (el.au && (el.au.controller || Object.keys(el.au).some(k => el.au[k]?.behavior))) return setDetected(1);
      }
    } catch {}
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(probeAfterLoad, 0);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(probeAfterLoad, 0), { once: true });
  }
}
