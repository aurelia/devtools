// Shared helpers to let applications disable Aurelia DevTools instrumentation
const DISABLE_GLOBAL_KEYS = [
  '__AURELIA_DEVTOOLS_DISABLED__',
  '__AURELIA_DEVTOOLS_DISABLE__',
  'AURELIA_DEVTOOLS_DISABLE',
];

const DISABLE_ATTRIBUTE_VALUES = ['disable', 'disabled', 'off'];

export function hasDevtoolsOptedOut(win: Window | any = typeof window !== 'undefined' ? window : undefined): boolean {
  try {
    const w = win as any;
    if (!w) {
      return false;
    }

    if (DISABLE_GLOBAL_KEYS.some((key) => w[key] === true)) {
      return true;
    }

    const doc: Document | undefined = w.document;
    if (!doc) {
      return false;
    }

    const meta = doc.querySelector('meta[name="aurelia-devtools"]');
    const metaContent = (meta?.getAttribute('content') || '').toLowerCase();
    if (DISABLE_ATTRIBUTE_VALUES.some((value) => metaContent.includes(value))) {
      return true;
    }

    const rootAttr = (doc.documentElement?.getAttribute('data-aurelia-devtools') || '').toLowerCase();
    if (DISABLE_ATTRIBUTE_VALUES.includes(rootAttr)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export function applyDevtoolsOptOutState(win: Window | any = typeof window !== 'undefined' ? window : undefined): boolean {
  const disabled = hasDevtoolsOptedOut(win);
  if (disabled && win) {
    try {
      (win as any).__AURELIA_DEVTOOLS_DETECTION_STATE__ = 'disabled';
      (win as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__ = null;
      (win as any).__AURELIA_DEVTOOLS_VERSION__ = null;
    } catch {
      // Ignore if we cannot write to the window object
    }
  }
  return disabled;
}
