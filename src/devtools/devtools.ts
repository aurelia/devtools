let elementsSidebarPane = null;
let sidebarCreated = false;

const optOutCheckExpression = `
  (function() {
    try {
      const w = window;
      const doc = w.document;
      const meta = doc && doc.querySelector('meta[name="aurelia-devtools"]');
      const metaContent = (meta && meta.getAttribute('content') || '').toLowerCase();
      const rootAttr = (doc && doc.documentElement && doc.documentElement.getAttribute('data-aurelia-devtools') || '').toLowerCase();
      const disabled =
        w.__AURELIA_DEVTOOLS_DISABLED__ === true ||
        w.__AURELIA_DEVTOOLS_DISABLE__ === true ||
        w.AURELIA_DEVTOOLS_DISABLE === true ||
        metaContent.includes('disable') ||
        metaContent.includes('off') ||
        rootAttr === 'disable' ||
        rootAttr === 'disabled' ||
        rootAttr === 'off';
      if (disabled) {
        w.__AURELIA_DEVTOOLS_DETECTION_STATE__ = 'disabled';
        w.__AURELIA_DEVTOOLS_DETECTED_VERSION__ = null;
        w.__AURELIA_DEVTOOLS_VERSION__ = null;
      }
      return disabled;
    } catch (e) {
      return false;
    }
  })()
`;

const HOOK_PRESENCE_CHECK = `!!(window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__ && window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__.__au_devtools_installed__)`;

let hookSourcePromise: Promise<string> | null = null;

function getHookSource(): Promise<string> {
  if (!hookSourcePromise) {
    hookSourcePromise = fetch(chrome.runtime.getURL('build/hook.js')).then((response) => response.text());
  }
  return hookSourcePromise;
}

function installHooksIfAllowed() {
  // The hook bundle contains its own opt-out and already-installed guards;
  // the presence check just avoids re-evaluating the full script on every call
  chrome.devtools.inspectedWindow.eval<boolean>(HOOK_PRESENCE_CHECK, (installed) => {
    if (installed === true) return;
    getHookSource()
      .then((source) => {
        chrome.devtools.inspectedWindow.eval(source);
      })
      .catch(() => {});
  });
}

// Set initial detection state
function initializeDetectionState() {
  chrome.devtools.inspectedWindow.eval(`
    if (!(${optOutCheckExpression})) {
      window.__AURELIA_DEVTOOLS_DETECTION_STATE__ = 'checking';
    }
  `);
  installHooksIfAllowed();
}

// Create an enhanced Elements sidebar - this is now the primary UI
function createElementsSidebar() {
  if (!chrome?.devtools?.panels?.elements?.createSidebarPane) return;
  if (elementsSidebarPane) return;

  chrome.devtools.panels.elements.createSidebarPane('Aurelia', function(pane) {
    elementsSidebarPane = pane;
    sidebarCreated = true;

    let pageSet = false;
    try {
      // Use the new sidebar-specific HTML page
      // Path is relative to extension root, not devtools folder
      pane.setPage('../sidebar.html');
      pageSet = true;
    } catch (error) {
      console.error('Failed to set sidebar page:', error);
      pageSet = false;
    }

    // Ensure hooks are installed when sidebar opens
    installHooksIfAllowed();

    if (pageSet) {
      try {
        pane.onShown.addListener(() => installHooksIfAllowed());
      } catch {}
    } else {
      // Fallback to setExpression if setPage fails
      const updateSidebar = () => {
        if (!elementsSidebarPane) return;
        const expr = `(() => {
          try {
            const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
            if (!hook) {
              return { status: 'no-hook', message: 'Aurelia DevTools hook not available' };
            }

            const result = {
              status: 'ok',
              selectedNode: {
                nodeType: $0 ? $0.nodeType : null,
                nodeName: $0 ? $0.nodeName : null,
              },
            };

            // Get binding info for the selected node
            if (hook.getNodeBindingInfo) {
              const bindingInfo = hook.getNodeBindingInfo($0);
              if (bindingInfo) {
                if (bindingInfo.interpolations && bindingInfo.interpolations.length) {
                  result.interpolations = bindingInfo.interpolations.map(i => i.expression);
                }
                if (bindingInfo.bindings && bindingInfo.bindings.length) {
                  result.bindings = bindingInfo.bindings.map(b => ({
                    expression: b.expression,
                    target: b.targetProperty,
                    mode: b.mode,
                  }));
                }
                if (bindingInfo.nearestComponent) {
                  result.nearestComponent = bindingInfo.nearestComponent.name;
                }
              }
            }

            // Get component info if available
            if (hook.getCustomElementInfo) {
              const info = hook.getCustomElementInfo($0, true);
              if (info && (info.customElementInfo || (info.customAttributesInfo && info.customAttributesInfo.length))) {
                if (info.customElementInfo) {
                  result.component = info.customElementInfo.name;
                  result.componentBindables = (info.customElementInfo.bindables || []).map(b => b.name + ': ' + b.value);
                }
                if (info.customAttributesInfo && info.customAttributesInfo.length) {
                  result.customAttributes = info.customAttributesInfo.map(a => a.name);
                }
              }
            }

            // Check if we have any useful info
            const hasInfo = result.interpolations || result.bindings || result.component || result.customAttributes;
            if (!hasInfo) {
              return { status: 'no-aurelia', message: 'No Aurelia bindings found for this node' };
            }

            return result;
          } catch (e) { return { status: 'error', message: String(e && e.message || e) }; }
        })()`;
        try {
          elementsSidebarPane.setExpression(expr, 'Aurelia');
        } catch {
          elementsSidebarPane.setObject({ message: 'Unable to evaluate Aurelia info' }, 'Aurelia');
        }
      };

      try { pane.onShown.addListener(updateSidebar); } catch {}
      chrome.devtools.panels.elements.onSelectionChanged.addListener(updateSidebar);
      updateSidebar();
    }
  });
}

// Update detection state when version is detected
function updateDetectionState(version) {
  chrome.devtools.inspectedWindow.eval(`
    window.__AURELIA_DEVTOOLS_DETECTED_VERSION__ = ${version};
    window.__AURELIA_DEVTOOLS_VERSION__ = ${version};
    window.__AURELIA_DEVTOOLS_DETECTION_STATE__ = 'detected';
  `);
}

// Listen for Aurelia detection messages
chrome.runtime.onMessage.addListener((req, sender) => {
  if (sender.tab && req.aureliaDetected && req.version) {
    chrome.devtools.inspectedWindow.eval(optOutCheckExpression, (disabled, isException) => {
      if (isException || disabled) return;
      updateDetectionState(req.version);
    });
  }
});

// Also try to detect immediately when devtools opens
// This handles the case where Aurelia was already detected before devtools opened
chrome.devtools.inspectedWindow.eval(
  `
  // Return the detected version if available, or try to detect
  (function() {
    if (${optOutCheckExpression}) {
      return { status: 'disabled', version: null };
    }

    if (window.__AURELIA_DEVTOOLS_DETECTED_VERSION__) {
      return { status: 'detected', version: window.__AURELIA_DEVTOOLS_DETECTED_VERSION__ };
    }

    // Try to detect Aurelia directly
    let version = null;

    // Check for Aurelia v1 indicators
    if (document.querySelector('[aurelia-app]') || window.aurelia) {
      version = 1;
    }
    // Check for Aurelia v2 indicators
    else if (document.querySelector('*[au-started]') || window.Aurelia) {
      version = 2;
    }
    // Additional v2 check - look for elements with $au property
    else {
      const elements = document.querySelectorAll('*');
      for (let el of elements) {
        if (el.$au) {
          version = 2;
          break;
        }
      }
    }
    // Additional v1 check - look for elements with .au property
    if (!version) {
      const elements = document.querySelectorAll('*');
      for (let el of elements) {
        if (el.au && (el.au.controller || Object.keys(el.au).some(key => el.au[key] && el.au[key].behavior))) {
          version = 1;
          break;
        }
      }
    }

    if (version) {
      window.__AURELIA_DEVTOOLS_DETECTED_VERSION__ = version;
      window.__AURELIA_DEVTOOLS_VERSION__ = version;
      window.__AURELIA_DEVTOOLS_DETECTION_STATE__ = 'detected';
      return { status: 'detected', version };
    }

    window.__AURELIA_DEVTOOLS_DETECTION_STATE__ = 'not-found';
    return { status: 'not-found', version: null };
  })();
`,
  (result: any, isException) => {
    if (isException || !result || result.status === 'disabled') {
      return;
    }
    if (result.status === 'detected' && result.version) {
      updateDetectionState(result.version);
    } else if (sidebarCreated && result.status === 'not-found') {
      chrome.devtools.inspectedWindow.eval(`
        window.__AURELIA_DEVTOOLS_DETECTION_STATE__ = 'not-found';
      `);
    }
  }
);
chrome.runtime.onConnect.addListener(() => {
  installHooksIfAllowed();
});

// Also re-install hooks on navigation to handle SPA reloads and page loads
chrome.devtools.network.onNavigated.addListener(() => {
  installHooksIfAllowed();
});

// Initialize: create sidebar only (no top-level panel)
// Must be at the end of the file after hooksAsStringv2 is defined
initializeDetectionState();
createElementsSidebar();
