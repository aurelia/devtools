chrome.runtime.connect({ name: 'content-connection' });

// Version-aware function to get Aurelia instance
export function getAureliaInstance(win): any | undefined {
  // First try to detect which version we're dealing with
  const detectedVersion =
    (window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__ ||
    (window as any).__AURELIA_DEVTOOLS_VERSION__ ||
    detectAureliaVersion();

  if (detectedVersion === 1) {
    return getAureliaV1Instance();
  } else if (detectedVersion === 2) {
    return getAureliaV2Instance();
  }

  // Fallback: try both
  return getAureliaV2Instance() || getAureliaV1Instance();
}

export function detectAureliaVersion(): number | null {
  // Try to detect version based on DOM patterns
  if (document.querySelector('[aurelia-app]') || (window as any).aurelia) {
    return 1;
  }
  if (document.querySelector('[au-started]') || (window as any).Aurelia) {
    return 2;
  }
  return null;
}

export function getAureliaV2Instance(): any | undefined {
  const all = document.querySelectorAll('*');
  for (let i = 0; i < all.length; i++) {
    const aurelia = (all[i] as any).$aurelia;
    if (aurelia) {
      return aurelia;
    }
  }
  return undefined;
}

export function getAureliaV1Instance(): any | undefined {
  // For Aurelia v1, there's no single global instance like v2
  // Instead, we look for any element with .au property
  const all = document.querySelectorAll('*');
  for (let i = 0; i < all.length; i++) {
    const au = (all[i] as any).au;
    if (au) {
      // Return the first controller we find as a representative
      if (au.controller) {
        return au.controller;
      }
    }
  }

  // Fallback: check for global aurelia instance
  return (window as any).aurelia;
}

// Make functions available globally to prevent tree-shaking
(window as any).getAureliaInstance = getAureliaInstance;
(window as any).getAureliaV1Instance = getAureliaV1Instance;
(window as any).getAureliaV2Instance = getAureliaV2Instance;
