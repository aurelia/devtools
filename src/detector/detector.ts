// detects V1
window.addEventListener(
  'aurelia-composed',
  () => {
    (window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__ = 1;
    chrome.runtime.sendMessage({ aureliaDetected: true, version: 1 });
  },
  { once: true }
);

// detects V2
window.addEventListener(
  'au-started',
  () => {
    (window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__ = 2;
    chrome.runtime.sendMessage({ aureliaDetected: true, version: 2 });
  },
  { once: true }
);
