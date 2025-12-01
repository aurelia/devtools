let detectedVersion = null;
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

function installHooksIfAllowed() {
  // hooksAsStringv2 contains its own opt-out guard; a lightweight single eval keeps installation robust
  chrome.devtools.inspectedWindow.eval(hooksAsStringv2);
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
        } catch (e) {
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
      detectedVersion = req.version;
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
  (result, isException) => {
    if (isException) {
      return;
    } else if (result && result.status === 'disabled') {
      detectedVersion = null;
    } else if (result && result.status === 'detected' && result.version) {
      detectedVersion = result.version;
      updateDetectionState(result.version);
    } else if (sidebarCreated && result && result.status === 'not-found') {
      chrome.devtools.inspectedWindow.eval(`
        window.__AURELIA_DEVTOOLS_DETECTION_STATE__ = 'not-found';
      `);
    }
  }
);

function install(debugValueLookup) {
  const denyListProps = [
    "$controller",
    "$observers",
    "$element",
    "$bindingContext",
  ];
  let nextDebugId = 0;
  if (!debugValueLookup) {
    debugValueLookup = {};
  }

  const MAP_ENTRY_METADATA_KEY =
    typeof Symbol === "function"
      ? Symbol("au-devtools-map-entry")
      : "__au_devtools_map_entry__";
  const externalPanels = new Map();
  let externalPanelsVersion = 0;
  const interactionLog = [];
  let interactionSequence = 0;
  const MAX_INTERACTION_LOG = 200;
  let isRecordingInteractions = false;
  const activePropertyWatchers = new Map();
  installEventProxy();
  installNavigationListeners();
  installRouterEventTap();
  registerExternalPanelBridge();

  const hooks = {
    Aurelia: undefined,
    currentElement: undefined,
    currentAttributes: [],
    getExternalPanelsSnapshot: () => ({
      version: externalPanelsVersion,
      panels: Array.from(externalPanels.values()),
    }),
    emitDevtoolsEvent: (eventName, payload) => emitDevtoolsEvent(eventName, payload),
    getInteractionLog: () => getInteractionLog(),
    replayInteraction: (id) => replayInteraction(id),
    applyInteractionSnapshot: (id, phase) => applyInteractionSnapshot(id, phase),
    clearInteractionLog: () => clearInteractionLog(),
    startInteractionRecording: () => startInteractionRecording(),
    stopInteractionRecording: () => stopInteractionRecording(),
    getAllInfo: (root) => {
      root = root ?? document.body;
      return [
        hooks.getCustomElementInfo(root, false),
        ...Array.from(root.children).flatMap((y) => hooks.getAllInfo(y)),
      ].filter((x) => x);
    },
    getComponentTree: () => {
      try {
        const elementToNode = new Map();
        const roots = [];
        const elements = Array.from(document.querySelectorAll('*'));

        for (const element of elements) {
          const info = hooks.getCustomElementInfo(element, false);
          if (!info) continue;

          const hasElement = !!(info.customElementInfo && info.customElementInfo.name);
          const hasAttributes = !!(info.customAttributesInfo && info.customAttributesInfo.length);

          if (!hasElement && !hasAttributes) continue;

          const domPath = getDomPath(element);
          const nodeId = createNodeId(info, domPath);

          elementToNode.set(element, {
            id: nodeId,
            domPath,
            tagName: element.tagName ? element.tagName.toLowerCase() : null,
            customElementInfo: info.customElementInfo,
            customAttributesInfo: info.customAttributesInfo || [],
            children: [],
          });
        }

        for (const element of elements) {
          const node = elementToNode.get(element);
          if (!node) continue;

          let parent = element.parentElement;
          while (parent && !elementToNode.has(parent)) {
            parent = parent.parentElement;
          }

          if (parent && elementToNode.has(parent)) {
            elementToNode.get(parent).children.push(node);
          } else {
            roots.push(node);
          }
        }

        return roots;
      } catch (error) {
        return [];
      }
    },
    updateValues: (info, property) => {
      if (property && property.debugId && debugValueLookup[property.debugId]) {
        const debugItem = debugValueLookup[property.debugId];
        const instance = debugItem.instance;
        const propertyName = property.name;

        if (instance && propertyName) {
          try {
            instance[propertyName] = property.value;
            return true;
          } catch (error) {
            return false;
          }
        }
      }
      return false;
    },
    getCustomElementInfo: (element, traverse = true) => {
      let customElement;
      let customAttributes = [];

      try {
        while (!customElement && element !== document.body) {
          if (!element) return;

          // Try Aurelia v2 first
          const auV2 = element["$au"];
          if (auV2) {
            customElement = auV2["au:resource:custom-element"];

            // Look for custom attributes with various patterns
            const customAttributeKeys = Object.getOwnPropertyNames(auV2).filter(
              (key) => {
                // Standard custom attribute patterns
                if (key.includes("custom-attribute") || key.includes("au:resource:custom-attribute")) {
                  return true;
                }
                // Any au:resource that isn't a custom element
                if (key.startsWith("au:resource:") && key !== "au:resource:custom-element") {
                  return true;
                }
                // Check for specific attribute patterns like 'aut-sort'
                if (key.match(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)) {
                  const controller = auV2[key];
                  // Verify it looks like a controller with definition/viewModel
                  if (controller && typeof controller === 'object' &&
                      (controller.definition || controller.viewModel || controller.behavior)) {
                    return true;
                  }
                }
                return false;
              }
            );

            customAttributes = customAttributeKeys.map((x) => auV2[x]).filter(attr => attr != null);
          }
          // Try Aurelia v1
          else {
            const auV1 = element.au;
            if (auV1) {
              if (auV1.controller) {
                customElement = auV1.controller;
              }
              // Get v1 custom attributes
              const tagName = element.tagName ? element.tagName.toLowerCase() : null;
              Object.keys(auV1).forEach(key => {
                const controller = auV1[key];
                // Check for custom attribute controllers (they have behavior and viewModel)
                if (key !== 'controller' && key !== tagName && controller) {
                  // Look for behavior with attributeName or properties
                  if (controller.behavior && (controller.behavior.attributeName || controller.behavior.properties)) {
                    customAttributes.push(controller);
                  }
                  // Also check for viewModels without behavior (edge case)
                  else if (controller.viewModel && typeof controller.viewModel === 'object') {
                    customAttributes.push(controller);
                  }
                }
              });
            }
          }

          element = element.parentElement;
          if (!traverse) break;
        }
      } catch (e) {
        // Silent error handling
      }

      if (!customElement && !customAttributes.length) return;

      hooks.currentElement = customElement;
      hooks.currentAttributes = customAttributes;

      const customElementInfo = customElement ? extractControllerInfo(customElement) : null;
      const customAttributesInfo = customAttributes.length > 0 ?
        customAttributes.map(extractControllerInfo).filter((x) => x) : [];
      return {
        customElementInfo,
        customAttributesInfo,
      };
    },

    getExpandedDebugValueForId(id) {
      let value = debugValueLookup[id]?.expandableValue;

      if (Array.isArray(value)) {
        const arrayValue = {};
        value.forEach((item, index) => {
          arrayValue[index] = item;
        });
        return convertObjectToDebugInfo(arrayValue);
      }

      if (isMapLike(value)) {
        return convertMapToDebugInfo(value);
      }

      if (isSetLike(value)) {
        return convertSetToDebugInfo(value);
      }

      if (isMapEntryLike(value)) {
        return convertMapEntryToDebugInfo(value);
      }

      return convertObjectToDebugInfo(value);
    },

    evaluateInComponentContext(componentKey, expression) {
      try {
        // Find the component by key
        let viewModel = null;

        // Try Aurelia v2 first
        const allElements = document.querySelectorAll('*');
        for (const element of allElements) {
          const auV2 = element['$au'];
          if (auV2) {
            const ce = auV2['au:resource:custom-element'];
            if (ce) {
              const key = ce.definition?.key || ce.definition?.name;
              const name = ce.definition?.name;
              if (key === componentKey || name === componentKey) {
                viewModel = ce.viewModel || ce.instance;
                break;
              }
            }
          }

          // Try Aurelia v1
          const auV1 = element.au;
          if (auV1 && auV1.controller) {
            const ctrl = auV1.controller;
            const key = ctrl.behavior?.elementName || ctrl.behavior?.attributeName;
            if (key === componentKey) {
              viewModel = ctrl.viewModel || ctrl.bindingContext;
              break;
            }
          }
        }

        if (!viewModel) {
          return { success: false, error: 'Component not found: ' + componentKey };
        }

        // Create a function that executes in the viewmodel context
        const evalFn = new Function('return (' + expression + ')');
        const result = evalFn.call(viewModel);

        // Serialize the result
        let serializedValue;
        let resultType = typeof result;

        if (result === null) {
          serializedValue = null;
          resultType = 'null';
        } else if (result === undefined) {
          serializedValue = undefined;
          resultType = 'undefined';
        } else if (typeof result === 'function') {
          serializedValue = '[Function: ' + (result.name || 'anonymous') + ']';
          resultType = 'function';
        } else if (typeof result === 'object') {
          try {
            // Check for circular references and complex objects
            const seen = new WeakSet();
            serializedValue = JSON.parse(JSON.stringify(result, (key, value) => {
              if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) {
                  return '[Circular]';
                }
                seen.add(value);
              }
              if (typeof value === 'function') {
                return '[Function]';
              }
              if (value instanceof Element) {
                return '[Element: ' + value.tagName + ']';
              }
              return value;
            }));
            resultType = Array.isArray(result) ? 'array' : 'object';
          } catch (e) {
            serializedValue = String(result);
            resultType = 'object (non-serializable)';
          }
        } else {
          serializedValue = result;
        }

        return {
          success: true,
          value: serializedValue,
          type: resultType,
        };
      } catch (e) {
        return {
          success: false,
          error: e.message || String(e),
        };
      }
    },

    getNodeBindingInfo(node) {
      if (!node) return null;

      try {
        const result = {
          nodeType: node.nodeType,
          nodeName: node.nodeName,
          bindings: [],
          interpolations: [],
          nearestComponent: null,
        };

        // Find nearest Aurelia controller by walking up the DOM
        let element = node.nodeType === 3 ? node.parentElement : node;
        let controller = null;
        let view = null;

        while (element && !controller) {
          // Check Aurelia v2
          const auV2 = element['$au'];
          if (auV2) {
            const ce = auV2['au:resource:custom-element'];
            if (ce) {
              controller = ce;
              view = ce.view || ce.viewModel?.view || ce.viewModel?.$view;
              result.nearestComponent = {
                name: ce.definition?.name || element.tagName?.toLowerCase(),
                type: 'custom-element',
                version: 2,
              };
              break;
            }
          }

          // Check Aurelia v1
          const auV1 = element.au;
          if (auV1 && auV1.controller) {
            controller = auV1.controller;
            view = controller.view;
            result.nearestComponent = {
              name: controller.behavior?.elementName || controller.behavior?.attributeName || element.tagName?.toLowerCase(),
              type: 'custom-element',
              version: 1,
            };
            break;
          }

          element = element.parentElement;
        }

        if (!view || !view.bindings) return result;

        // Find bindings that target this node
        for (const binding of view.bindings) {
          if (!binding) continue;

          const bindingTarget = binding.target || binding.targetNode;
          const isTargetMatch = bindingTarget === node ||
            (node.nodeType === 3 && bindingTarget === node.parentElement) ||
            (bindingTarget && bindingTarget.contains && bindingTarget.contains(node));

          if (!isTargetMatch) continue;

          const ast = binding.ast || binding.sourceExpression || binding.expression;
          if (!ast) continue;

          const kind = ast.$kind || ast.kind || ast.type || (ast.constructor && ast.constructor.name);
          const expr = unparseExpression(ast);

          if (kind === 'Interpolation') {
            result.interpolations.push({
              expression: expr,
              targetProperty: binding.targetProperty || 'textContent',
            });
          } else {
            result.bindings.push({
              expression: expr,
              targetProperty: binding.targetProperty || binding.targetEvent || 'value',
              mode: binding.mode || (binding.updateSource ? 'two-way' : 'to-view'),
            });
          }
        }

        return result;
      } catch (e) {
        return { error: e.message };
      }
    },

    findElementByComponentInfo(componentInfo) {
      // Find DOM element that corresponds to the component info
      const allElements = document.querySelectorAll("*");

      for (const element of allElements) {
        // Try Aurelia v2 first
        const auV2 = element["$au"];
        if (auV2) {
          const customElement = auV2["au:resource:custom-element"];
          if (customElement) {
            // Check if this element matches the component info
            if (
              componentInfo.customElementInfo &&
              customElement.definition.name ===
                componentInfo.customElementInfo.name &&
              customElement.definition.key ===
                componentInfo.customElementInfo.key
            ) {
              return element;
            }
          }

          // Check custom attributes
          if (componentInfo.customAttributesInfo) {
            const customAttributeKeys = Object.getOwnPropertyNames(auV2).filter(
              (y) => y.includes("custom-attribute")
            );
            const customAttributes = customAttributeKeys.map((x) => auV2[x]);

            for (const attr of customAttributes) {
              if (
                componentInfo.customAttributesInfo.some(
                  (attrInfo) =>
                    attr.definition.name === attrInfo.name &&
                    attr.definition.key === attrInfo.key
                )
              ) {
                return element;
              }
            }
          }
        }
        // Try Aurelia v1
        else {
          const auV1 = element.au;
          if (auV1) {
            // Check custom element
            if (auV1.controller && componentInfo.customElementInfo) {
              const controller = auV1.controller;
              if (controller.behavior &&
                  ((controller.behavior.elementName === componentInfo.customElementInfo.name) ||
                   (controller.behavior.attributeName === componentInfo.customElementInfo.name))) {
                return element;
              }
            }

            // Check custom attributes
            if (componentInfo.customAttributesInfo) {
              const tagName = element.tagName ? element.tagName.toLowerCase() : null;
              for (const key in auV1) {
                if (key !== 'controller' && key !== tagName && auV1[key] && auV1[key].behavior) {
                  const attrController = auV1[key];
                  if (componentInfo.customAttributesInfo.some(
                    (attrInfo) => {
                      return (attrController.behavior.attributeName === attrInfo.name) ||
                             (attrController.behavior.elementName === attrInfo.name);
                    }
                  )) {
                    return element;
                  }
                }
              }
            }
          }
        }
      }

      return null;
    },

    getLifecycleHooks: (componentKey) => {
      const controller = findControllerByKey(componentKey);
      return extractLifecycleHooks(controller);
    },

    getComputedProperties: (componentKey) => {
      const controller = findControllerByKey(componentKey);
      return extractComputedProperties(controller);
    },

    getDependencies: (componentKey) => {
      const controller = findControllerByKey(componentKey);
      return extractDependencies(controller);
    },

    getEnhancedDISnapshot: (componentKey) => {
      const controller = findControllerByKey(componentKey);
      return extractEnhancedDISnapshot(controller);
    },

    getRouteInfo: (componentKey) => {
      const controller = findControllerByKey(componentKey);
      return extractRouteInfo(controller);
    },

    getSlotInfo: (componentKey) => {
      const controller = findControllerByKey(componentKey);
      return extractSlotInfo(controller);
    },

    getTemplateSnapshot: (componentKey) => {
      const controller = findControllerByKey(componentKey);
      return extractTemplateSnapshot(controller);
    },

    attachPropertyWatchers: (componentKey) => attachPropertyWatchers(componentKey),
    detachPropertyWatchers: (componentKey) => detachPropertyWatchers(componentKey),
    detachAllPropertyWatchers: () => detachAllPropertyWatchers(),

    getComponentByKey: (componentKey) => {
      const controller = findControllerByKey(componentKey);
      if (!controller) return null;
      return extractControllerInfo(controller);
    },

    getSimplifiedComponentTree: () => {
      try {
        const fullTree = hooks.getComponentTree();
        const simplifyNode = (node) => {
          const simplified = [];

          if (node.customElementInfo && node.customElementInfo.name) {
            simplified.push({
              key: node.customElementInfo.key || node.customElementInfo.name,
              name: node.customElementInfo.name,
              tagName: node.tagName || node.customElementInfo.name,
              type: 'custom-element',
              hasChildren: (node.children && node.children.length > 0) ||
                           (node.customAttributesInfo && node.customAttributesInfo.length > 0),
              childCount: (node.children ? node.children.length : 0) +
                          (node.customAttributesInfo ? node.customAttributesInfo.length : 0),
              children: [
                ...(node.customAttributesInfo || []).map(attr => ({
                  key: attr.key || attr.name,
                  name: attr.name,
                  tagName: node.tagName || '',
                  type: 'custom-attribute',
                  hasChildren: false,
                  childCount: 0,
                  children: []
                })),
                ...(node.children || []).flatMap(child => simplifyNode(child))
              ]
            });
          } else if (node.customAttributesInfo && node.customAttributesInfo.length > 0) {
            for (const attr of node.customAttributesInfo) {
              simplified.push({
                key: attr.key || attr.name,
                name: attr.name,
                tagName: node.tagName || '',
                type: 'custom-attribute',
                hasChildren: node.children && node.children.length > 0,
                childCount: node.children ? node.children.length : 0,
                children: (node.children || []).flatMap(child => simplifyNode(child))
              });
            }
          }

          return simplified;
        };

        return fullTree.flatMap(root => simplifyNode(root));
      } catch (error) {
        return [];
      }
    },
  };

  function installEventProxy() {
    try {
      tryPatchListenerBindingPrototype();
      tryPatchAureliaV1Listener();
      patchAddEventListener();
    } catch {}
  }

  function tryPatchListenerBindingPrototype() {
    const candidates = [
      globalThis && globalThis.ListenerBinding,
      globalThis && globalThis.au && globalThis.au.ListenerBinding,
      globalThis && globalThis.Aurelia && globalThis.Aurelia.ListenerBinding,
    ];

    for (const candidate of candidates) {
      if (candidate && candidate.prototype && !candidate.prototype.__auDevtoolsPatched) {
        const proto = candidate.prototype;
        const originalHandleEvent = proto.handleEvent;
        if (typeof originalHandleEvent !== 'function') {
          continue;
        }
        proto.__auDevtoolsPatched = true;
        proto.handleEvent = function(event) {
          return recordInteraction(this, event, originalHandleEvent);
        };
        break;
      }
    }
  }

  function tryPatchAureliaV1Listener() {
    let v1Patched = false;

    const patchCallSource = (proto) => {
      if (!proto || proto.__auDevtoolsV1Patched) return false;
      const originalCallSource = proto.callSource;
      if (typeof originalCallSource !== 'function') return false;
      proto.__auDevtoolsV1Patched = true;
      proto.callSource = function(event) {
        if (this.__auDevtoolsRecording) {
          return originalCallSource.call(this, event);
        }
        this.__auDevtoolsRecording = true;
        try {
          return recordInteraction(this, event, originalCallSource);
        } catch (err) {
          return originalCallSource.call(this, event);
        } finally {
          this.__auDevtoolsRecording = false;
        }
      };
      return true;
    };

    const findListenerFromElement = () => {
      const elements = document.querySelectorAll('*');
      for (const el of elements) {
        const au = el.au;
        if (!au) continue;

        const controller = au.controller;
        if (controller && controller.view && Array.isArray(controller.view.bindings)) {
          for (const binding of controller.view.bindings) {
            if (binding && binding.sourceExpression && typeof binding.callSource === 'function') {
              return binding.constructor;
            }
          }
        }

        for (const key in au) {
          if (key === 'controller') continue;
          const attr = au[key];
          if (attr && attr.view && Array.isArray(attr.view.bindings)) {
            for (const binding of attr.view.bindings) {
              if (binding && binding.sourceExpression && typeof binding.callSource === 'function') {
                return binding.constructor;
              }
            }
          }
        }
      }
      return null;
    };

    const attemptPatch = () => {
      if (v1Patched) return true;
      const ListenerClass = findListenerFromElement();
      if (ListenerClass && ListenerClass.prototype) {
        v1Patched = patchCallSource(ListenerClass.prototype);
      }
      return v1Patched;
    };

    if (!attemptPatch()) {
      let attempts = 0;
      const retryInterval = setInterval(() => {
        attempts++;
        if (attemptPatch() || attempts > 20) {
          clearInterval(retryInterval);
        }
      }, 500);
    }
  }

  function patchAddEventListener() {
    const targetProto = typeof EventTarget !== 'undefined' ? EventTarget.prototype : null;
    if (!targetProto || targetProto.__auDevtoolsPatched) {
      return;
    }
    const originalAdd = targetProto.addEventListener;
    targetProto.__auDevtoolsPatched = true;
    targetProto.addEventListener = function(type, listener, options) {
      maybeWrapListener(listener);
      return originalAdd.call(this, type, listener, options);
    };
  }

  function maybeWrapListener(listener) {
    if (!isAureliaListener(listener) || listener.__auDevtoolsWrapped) {
      return;
    }
    const originalHandleEvent = listener.handleEvent;
    if (typeof originalHandleEvent !== 'function') {
      return;
    }
    listener.__auDevtoolsWrapped = true;
    listener.handleEvent = function(event) {
      if (this.__auDevtoolsRecording) {
        return originalHandleEvent.call(this, event);
      }
      this.__auDevtoolsRecording = true;
      try {
        return recordInteraction(listener, event, originalHandleEvent);
      } finally {
        this.__auDevtoolsRecording = false;
      }
    };
  }

  function isAureliaListener(listener) {
    return !!(
      listener &&
      typeof listener === 'object' &&
      typeof listener.handleEvent === 'function' &&
      typeof listener.callSource === 'function' &&
      typeof listener.targetEvent === 'string' &&
      (listener.ast !== undefined || listener._scope !== undefined || listener.sourceExpression !== undefined || listener.source !== undefined)
    );
  }

  function recordInteraction(binding, event, originalHandleEvent) {
    const started = Date.now();
    let vm = null;
    let beforeSnapshot = null;
    let error = null;
    let result;

    try {
      vm = extractViewModel(binding);
      beforeSnapshot = snapshotViewModel(vm);
    } catch {}

    try {
      result = originalHandleEvent.call(binding, event);
    } catch (err) {
      error = err;
      throw err;
    } finally {
      try {
        const afterSnapshot = snapshotViewModel(vm);
        const domPath = getDomPath(binding && binding.target);
        const eventInit = extractEventInit(event);
        const targetHint = buildTargetHint(binding, domPath);
        const entry = {
          id: `evt-${++interactionSequence}`,
          eventName: (event && event.type) || (binding && binding.targetEvent) || 'unknown',
          domPath: domPath || '',
          timestamp: started,
          duration: Date.now() - started,
          mode: inferEventMode(binding),
          vmName: vm && vm.constructor ? vm.constructor.name : undefined,
          handlerName: inferHandlerName(binding),
          before: beforeSnapshot,
          after: afterSnapshot,
          error: error ? String(error && (error.message || error)) : null,
          replayable: !!(binding && (binding.target || domPath)),
          canApplySnapshot: !!vm,
          eventInit,
          detail: eventInit && eventInit.detail ? eventInit.detail : undefined,
          target: targetHint,
        };

        logInteraction(entry, {
          vmRef: vm ? (typeof WeakRef === 'function' ? new WeakRef(vm) : vm) : null,
          targetRef: binding && binding.target ? (typeof WeakRef === 'function' ? new WeakRef(binding.target) : binding.target) : null,
          bindingRef: binding || null,
        });
      } catch {}
    }

    return result;
  }

  function extractViewModel(binding) {
    if (!binding) {
      return null;
    }
    const scope = binding._scope || binding.scope || null;
    if (scope && scope.bindingContext) {
      return scope.bindingContext;
    }
    if (scope && scope.overrideContext && scope.overrideContext.bindingContext) {
      return scope.overrideContext.bindingContext;
    }
    if (binding.source && typeof binding.source === 'object') {
      return binding.source;
    }
    return null;
  }

  function snapshotViewModel(vm) {
    if (!vm || typeof vm !== 'object') {
      return null;
    }
    const snapshot = {};
    let propCount = 0;
    const MAX_PROPS = 20;

    try {
      const keys = Object.keys(vm);
      for (const key of keys) {
        if (propCount >= MAX_PROPS) break;
        if (key.startsWith('$') || key.startsWith('_')) continue;
        if (key === 'router' || key === 'element' || key === 'view' || key === 'controller') continue;

        try {
          const value = vm[key];
          if (value === undefined || value === null) {
            snapshot[key] = value;
            propCount++;
            continue;
          }
          const type = typeof value;
          if (type === 'function') continue;
          if (type === 'string' || type === 'number' || type === 'boolean') {
            snapshot[key] = value;
            propCount++;
            continue;
          }
          if (Array.isArray(value)) {
            snapshot[key] = `[Array(${value.length})]`;
            propCount++;
            continue;
          }
          if (type === 'object') {
            const ctorName = value.constructor?.name || 'Object';
            snapshot[key] = `[${ctorName}]`;
            propCount++;
          }
        } catch {}
      }
    } catch {}
    return snapshot;
  }

  function deepCloneForSnapshot(value) {
    if (value == null) return value;
    if (typeof value !== 'object') return value;

    if (value.__array_observer__ || value.__set_observer__ || value.__map_observer__) {
      if (Array.isArray(value)) return `[Array(${value.length})]`;
      return '[Observable]';
    }

    try {
      if (typeof structuredClone === 'function') {
        return structuredClone(value);
      }
    } catch {}
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {}
    try {
      return sanitizeForTransport(value);
    } catch {}
    return '[Uncloneable]';
  }

  function applySnapshot(vm, snapshot) {
    if (!vm || !snapshot || typeof vm !== 'object') {
      return false;
    }
    let applied = false;
    Object.keys(snapshot).forEach((key) => {
      if (typeof vm[key] === 'function') {
        return;
      }
      try {
        vm[key] = deepCloneForSnapshot(snapshot[key]);
        applied = true;
      } catch {}
    });
    return applied;
  }

  function applyInteractionSnapshot(id, phase) {
    const entry = findInteractionEntry(id);
    if (!entry) {
      return false;
    }
    let vm = deref(entry.vmRef);
    if (!vm) {
      const target =
        findElementByDomPath(entry.domPath) ||
        findElementByTargetHint(entry.target);
      vm = resolveViewModelFromElement(target, entry.target);
    }
    if (!vm) {
      return false;
    }
    const snapshot = phase === 'before' ? entry.before : entry.after;
    return applySnapshot(vm, snapshot);
  }

  function replayInteraction(id) {
    const entry = findInteractionEntry(id);
    if (!entry) {
      return false;
    }

    const target =
      deref(entry.targetRef) ||
      findElementByDomPath(entry.domPath) ||
      findElementByTargetHint(entry.target);
    if (!target || typeof target.dispatchEvent !== 'function') {
      return false;
    }

    const eventType = entry.eventName || 'click';
    const init = Object.assign({ bubbles: true, cancelable: true, composed: true }, entry.eventInit || {});
    let synthetic;

    try {
      if (eventType.startsWith('mouse') || eventType === 'click' || eventType === 'dblclick') {
        synthetic = new MouseEvent(eventType, init);
      } else if (eventType.startsWith('key')) {
        synthetic = new KeyboardEvent(eventType, init);
      } else if (typeof CustomEvent === 'function') {
        synthetic = new CustomEvent(eventType, { ...init, detail: entry.detail || null });
      } else {
        synthetic = new Event(eventType, init);
      }
    } catch {
      try {
        synthetic = document.createEvent('Event');
        synthetic.initEvent(eventType, true, true);
      } catch {
        return false;
      }
    }

    return target.dispatchEvent(synthetic);
  }

  function getInteractionLog() {
    return interactionLog.map(exportInteraction).filter((x) => x);
  }

  function exportInteraction(entry) {
    if (!entry) {
      return null;
    }
    const { vmRef, targetRef, bindingRef, ...rest } = entry;
    return {
      ...rest,
      before: rest.before ? sanitizeForTransport(rest.before) : null,
      after: rest.after ? sanitizeForTransport(rest.after) : null,
      eventInit: rest.eventInit ? sanitizeForTransport(rest.eventInit) : undefined,
      detail: rest.detail ? sanitizeForTransport(rest.detail) : undefined,
      canApplySnapshot: !!vmRef || !!rest.target,
      target: rest.target ? sanitizeForTransport(rest.target) : undefined,
    };
  }

  function clearInteractionLog() {
    interactionLog.length = 0;
    interactionSequence = 0;
    return true;
  }

  function findInteractionEntry(id) {
    return interactionLog.find((entry) => entry && entry.id === id) || null;
  }

  function deref(ref) {
    if (!ref) {
      return null;
    }
    if (typeof ref.deref === 'function') {
      return ref.deref();
    }
    return ref;
  }

  function findElementByDomPath(domPath) {
    if (!domPath || typeof domPath !== 'string') {
      return null;
    }
    try {
      return document.querySelector(domPath);
    } catch {
      return null;
    }
  }

  function findElementByTargetHint(hint) {
    if (!hint) return null;
    const domCandidate = hint.domPath ? findElementByDomPath(hint.domPath) : null;
    if (domCandidate) return domCandidate;
    if (hint.href) {
      try {
        const match = Array.from(document.querySelectorAll('a')).find((a) => a.href === hint.href);
        if (match) return match;
      } catch {}
    }
    if (!hooks.findElementByComponentInfo) return null;
    const fakeInfo = {
      customElementInfo: hint.componentType === 'custom-element'
        ? { name: hint.componentName, key: hint.componentKey }
        : null,
      customAttributesInfo: hint.componentType === 'custom-attribute'
        ? [{ name: hint.componentName, key: hint.componentKey }]
        : [],
    };
    try {
      return hooks.findElementByComponentInfo(fakeInfo);
    } catch {
      return null;
    }
  }

  function resolveViewModelFromElement(element, hint) {
    if (!element) return null;
    // Aurelia v2
    const auV2 = element['$au'];
    if (auV2) {
      const ce = auV2['au:resource:custom-element'];
      if (ce && matchesHint(ce.definition, hint)) {
        return ce.viewModel || ce;
      }
      const attr = findMatchingAttribute(auV2, hint);
      if (attr) return attr.viewModel || attr;
    }
    // Aurelia v1
    const auV1 = element.au;
    if (auV1 && auV1.controller && matchesHint(auV1.controller.behavior, hint)) {
      return auV1.controller.viewModel || auV1.controller;
    }
    if (auV1) {
      const tagName = element.tagName ? element.tagName.toLowerCase() : null;
      for (const key in auV1) {
        if (key === 'controller' || key === tagName) continue;
        const candidate = auV1[key];
        if (candidate && candidate.behavior && matchesHint(candidate.behavior, hint)) {
          return candidate.viewModel || candidate;
        }
      }
    }
    return null;
  }

  function matchesHint(definition, hint) {
    if (!hint || !definition) return true;
    const name = definition.name || definition.elementName || definition.attributeName;
    const key = definition.key || definition.attributeName || definition.elementName;
    if (hint.componentKey && key) {
      return hint.componentKey === key;
    }
    if (hint.componentName && name) {
      return hint.componentName === name;
    }
    return true;
  }

  function findMatchingAttribute(auV2, hint) {
    if (!hint) return null;
    const keys = Object.getOwnPropertyNames(auV2).filter((k) => k.includes('custom-attribute'));
    for (const k of keys) {
      const attr = auV2[k];
      if (attr && attr.definition && matchesHint(attr.definition, hint)) {
        return attr;
      }
    }
    return null;
  }

  function buildTargetHint(binding, domPath) {
    const hint = {
      domPath: domPath || null,
      tagName: null,
      componentName: null,
      componentKey: null,
      componentType: 'unknown',
      href: null,
    };
    try {
      const target = binding && binding.target;
      if (target && target.tagName) {
        hint.tagName = target.tagName.toLowerCase();
      }
      if (target && target.href) {
        hint.href = target.href;
      }
      if (hooks.getCustomElementInfo && target) {
        const info = hooks.getCustomElementInfo(target, false);
        if (info && info.customElementInfo) {
          hint.componentType = 'custom-element';
          hint.componentName = info.customElementInfo.name || null;
          hint.componentKey = info.customElementInfo.key || null;
        } else if (info && info.customAttributesInfo && info.customAttributesInfo.length) {
          const firstAttr = info.customAttributesInfo[0];
          hint.componentType = 'custom-attribute';
          hint.componentName = firstAttr.name || null;
          hint.componentKey = firstAttr.key || null;
        }
      }
    } catch {}
    return hint;
  }

  function logInteraction(entry, meta) {
    if (!isRecordingInteractions) return;

    interactionLog.push({
      ...entry,
      ...meta,
    });

    if (interactionLog.length > MAX_INTERACTION_LOG) {
      interactionLog.shift();
    }

    try {
      const exported = exportInteraction(entry);
      if (exported) {
        window.dispatchEvent(new CustomEvent('aurelia-devtools:interaction', { detail: exported }));
      }
    } catch {}
  }

  function startInteractionRecording() {
    isRecordingInteractions = true;
    return true;
  }

  function stopInteractionRecording() {
    isRecordingInteractions = false;
    return true;
  }

  function installNavigationListeners() {
    try {
      let lastHref = location.href;
      const record = (source) => {
        const current = location.href;
        if (current === lastHref) return;
        const entry = {
          id: `nav-${++interactionSequence}`,
          eventName: 'route-change',
          domPath: null,
          timestamp: Date.now(),
          duration: 0,
          mode: 'navigation',
          vmName: undefined,
          handlerName: source,
          before: null,
          after: null,
          error: null,
          replayable: false,
          canApplySnapshot: false,
          eventInit: { from: lastHref, to: current, source },
          detail: { from: lastHref, to: current, source },
          target: { href: current, componentType: 'unknown', domPath: null, tagName: null, componentName: null, componentKey: null },
        };
        logInteraction(entry, {});
        lastHref = current;
      };

      const wrap = (methodName) => {
        const original = history[methodName];
        if (typeof original !== 'function') return;
        history[methodName] = function(state, title, url) {
          const result = original.apply(this, arguments);
          record(methodName);
          return result;
        };
      };

      wrap('pushState');
      wrap('replaceState');
      window.addEventListener('popstate', () => record('popstate'), true);
    } catch {}
  }

  function installRouterEventTap() {
    try {
      const hookInstall = () => {
        const ea = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__?.Aurelia?.container?.get?.({ key: 'IEventAggregator' }) || null;
        if (!ea || typeof ea.subscribe !== 'function') return false;

        const routerEvents = [
          'au:router:location-change',
          'au:router:navigation-start',
          'au:router:navigation-end',
          'au:router:navigation-cancel',
          'au:router:navigation-error',
        ];

        routerEvents.forEach((eventName) => {
          try {
            ea.subscribe(eventName, (msg) => {
              const detail = sanitizeForTransport(msg);
              const entry = {
                id: `router-${++interactionSequence}`,
                eventName,
                domPath: null,
                timestamp: Date.now(),
                duration: 0,
                mode: 'navigation',
                vmName: undefined,
                handlerName: 'router',
                before: null,
                after: null,
                error: null,
                replayable: false,
                canApplySnapshot: false,
                eventInit: detail,
                detail,
                target: { href: detail?.url || location.href, componentType: 'unknown', domPath: null, tagName: null, componentName: null, componentKey: null },
              };
              logInteraction(entry, {});
            });
          } catch {}
        });
        return true;
      };

      // If Aurelia already installed, try immediately; otherwise retry a few times
      if (!hookInstall()) {
        let attempts = 0;
        const t = setInterval(() => {
          attempts++;
          if (hookInstall() || attempts > 10) {
            clearInterval(t);
          }
        }, 300);
      }
    } catch {}
  }

  function extractEventInit(event) {
    if (!event || typeof event !== 'object') {
      return { bubbles: true, cancelable: true, composed: true };
    }
    const base = {
      bubbles: !!event.bubbles,
      cancelable: !!event.cancelable,
      composed: !!event.composed,
    };

    if (typeof MouseEvent !== 'undefined' && event instanceof MouseEvent) {
      return Object.assign(base, {
        button: event.button,
        buttons: event.buttons,
        clientX: event.clientX,
        clientY: event.clientY,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
      });
    }

    if (typeof KeyboardEvent !== 'undefined' && event instanceof KeyboardEvent) {
      return Object.assign(base, {
        key: event.key,
        code: event.code,
        keyCode: event.keyCode,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
      });
    }

    if (typeof CustomEvent !== 'undefined' && event instanceof CustomEvent) {
      return Object.assign(base, {
        detail: sanitizeForTransport(event.detail),
      });
    }

    return base;
  }

  function inferEventMode(binding) {
    if (!binding) {
      return 'unknown';
    }
    if (binding._options && binding._options.capture) {
      return 'capture';
    }
    if (binding.self) {
      return 'trigger';
    }
    return 'delegate';
  }

  function inferHandlerName(binding) {
    try {
      const ast = binding && binding.ast;
      if (ast && ast.name) {
        return ast.name;
      }
      if (ast && ast.value && ast.value.name) {
        return ast.value.name;
      }
      if (ast && typeof ast.toString === 'function') {
        const str = String(ast);
        if (str && str.length < 120) {
          return str;
        }
      }
    } catch {}
    return undefined;
  }

  function getDomPath(element) {
    if (!element || element.nodeType !== 1) {
      return '';
    }

    const segments = [];
    let current = element;

    while (current && current.nodeType === 1 && current !== document) {
      const tag = current.tagName ? current.tagName.toLowerCase() : 'unknown';
      let index = 1;
      let sibling = current;

      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName === current.tagName) {
          index++;
        }
      }

      segments.push(`${tag}:nth-of-type(${index})`);
      current = current.parentElement;
    }

    segments.push('html');
    return segments.reverse().join(' > ');
  }

  function createNodeId(info, domPath) {
    const elementKey = info && info.customElementInfo ? (info.customElementInfo.key || info.customElementInfo.name || '') : '';
    const attrKeys = (info && info.customAttributesInfo ? info.customAttributesInfo.map((attr) => attr && (attr.key || attr.name || '')).join('|') : '');
    return `${domPath}::${elementKey}::${attrKeys}`;
  }

  // Enhanced Component Inspection - Lifecycle Hooks
  const V2_LIFECYCLE_HOOKS = ['define', 'hydrating', 'hydrated', 'created', 'binding', 'bound', 'attaching', 'attached', 'detaching', 'unbinding', 'dispose'];
  const V1_LIFECYCLE_HOOKS = ['created', 'bind', 'attached', 'detached', 'unbind'];

  function detectControllerVersion(controller) {
    if (!controller) return 2;
    if (controller.definition && controller.definition.key) return 2;
    if (controller.behavior) return 1;
    return 2;
  }

  function findControllerByKey(componentKey) {
    if (!componentKey) return null;

    const allElements = document.querySelectorAll('*');

    for (const element of allElements) {
      const auV2 = element['$au'];
      if (auV2) {
        const ce = auV2['au:resource:custom-element'];
        if (ce) {
          const key = ce.definition?.key || ce.definition?.name;
          const name = ce.definition?.name;
          if (key === componentKey || name === componentKey) {
            return ce;
          }
        }

        const attrKeys = Object.getOwnPropertyNames(auV2).filter(k =>
          k.includes('custom-attribute') || (k.startsWith('au:resource:') && k !== 'au:resource:custom-element')
        );
        for (const attrKey of attrKeys) {
          const attr = auV2[attrKey];
          if (attr && attr.definition) {
            const key = attr.definition.key || attr.definition.name;
            if (key === componentKey) {
              return attr;
            }
          }
        }
      }

      const auV1 = element.au;
      if (auV1) {
        if (auV1.controller) {
          const ctrl = auV1.controller;
          const key = ctrl.behavior?.elementName || ctrl.behavior?.attributeName;
          if (key === componentKey) {
            return ctrl;
          }
        }

        const tagName = element.tagName ? element.tagName.toLowerCase() : null;
        for (const attrKey in auV1) {
          if (attrKey !== 'controller' && attrKey !== tagName) {
            const attr = auV1[attrKey];
            if (attr && attr.behavior) {
              const key = attr.behavior.attributeName || attr.behavior.elementName;
              if (key === componentKey) {
                return attr;
              }
            }
          }
        }
      }
    }

    return null;
  }

  function serializePropertyValue(value) {
    if (value === null) return { value: null, type: 'null' };
    if (value === undefined) return { value: undefined, type: 'undefined' };
    const t = typeof value;
    if (t === 'function') return { value: '[Function]', type: 'function' };
    if (t === 'object') {
      try {
        return { value: JSON.parse(JSON.stringify(value)), type: Array.isArray(value) ? 'array' : 'object' };
      } catch {
        return { value: '[Object]', type: 'object' };
      }
    }
    return { value, type: t };
  }

  function attachPropertyWatchers(componentKey) {
    if (!componentKey) return false;

    detachPropertyWatchers(componentKey);

    const controller = findControllerByKey(componentKey);
    if (!controller) return false;

    const viewModel = controller.viewModel || controller.bindingContext || controller;
    if (!viewModel) return false;

    const version = detectControllerVersion(controller);
    if (version !== 2) {
      return false;
    }

    const container = controller.container;
    if (!container) return false;

    let observerLocator = null;
    try {
      const IObserverLocator = container.get && container.getAll
        ? Array.from(container.getAll ? container.getAll(Symbol.for('au:resource:observer-locator')) || [] : []).find(Boolean)
        : null;

      if (!IObserverLocator) {
        const tryGet = (key) => {
          try { return container.get(key); } catch { return null; }
        };
        observerLocator = tryGet(Symbol.for('au:resource:observer-locator'))
          || tryGet('IObserverLocator')
          || (container.root && container.root.get && tryGet.call(container.root, Symbol.for('au:resource:observer-locator')));
      } else {
        observerLocator = IObserverLocator;
      }
    } catch {}

    if (!observerLocator) {
      try {
        if (typeof viewModel.$controller !== 'undefined' && viewModel.$controller.container) {
          const c = viewModel.$controller.container;
          observerLocator = c.get && c.get(Symbol.for('au:resource:observer-locator'));
        }
      } catch {}
    }

    if (!observerLocator || typeof observerLocator.getObserver !== 'function') {
      return false;
    }

    const unsubscribers = [];
    const propertyKeys = Object.keys(viewModel).filter(k =>
      !k.startsWith('$') &&
      !k.startsWith('_') &&
      typeof viewModel[k] !== 'function'
    );

    for (const key of propertyKeys) {
      try {
        const observer = observerLocator.getObserver(viewModel, key);
        if (!observer || typeof observer.subscribe !== 'function') continue;

        const subscriber = {
          handleChange(newValue, oldValue) {
            const serializedNew = serializePropertyValue(newValue);
            const serializedOld = serializePropertyValue(oldValue);
            emitDevtoolsEvent('aurelia-devtools:property-change', {
              componentKey,
              propertyName: key,
              newValue: serializedNew.value,
              oldValue: serializedOld.value,
              newType: serializedNew.type,
              oldType: serializedOld.type,
              timestamp: Date.now()
            });
          }
        };

        observer.subscribe(subscriber);
        unsubscribers.push(() => {
          try { observer.unsubscribe(subscriber); } catch {}
        });
      } catch {}
    }

    if (unsubscribers.length > 0) {
      activePropertyWatchers.set(componentKey, { unsubscribers, viewModel });
      return true;
    }

    return false;
  }

  function detachPropertyWatchers(componentKey) {
    if (!componentKey) return false;

    const entry = activePropertyWatchers.get(componentKey);
    if (entry) {
      for (const unsub of entry.unsubscribers) {
        try { unsub(); } catch {}
      }
      activePropertyWatchers.delete(componentKey);
      return true;
    }
    return false;
  }

  function detachAllPropertyWatchers() {
    for (const [key] of activePropertyWatchers) {
      detachPropertyWatchers(key);
    }
  }

  function extractLifecycleHooks(controller) {
    if (!controller) return null;

    try {
      const version = detectControllerVersion(controller);
      const hookNames = version === 1 ? V1_LIFECYCLE_HOOKS : V2_LIFECYCLE_HOOKS;
      const viewModel = controller.viewModel || controller.bindingContext || controller;

      if (!viewModel) return null;

      const hooks = hookNames.map(name => {
        const fn = viewModel[name];
        const implemented = typeof fn === 'function';
        let isAsync = false;

        if (implemented) {
          try {
            const fnStr = fn.toString();
            isAsync = fnStr.startsWith('async') || fnStr.includes('return new Promise') || fnStr.includes('.then(');
          } catch {}
        }

        return { name, implemented, isAsync };
      });

      return { version, hooks };
    } catch {
      return null;
    }
  }

  function extractComputedProperties(controller) {
    if (!controller) return [];

    try {
      const viewModel = controller.viewModel || controller.bindingContext || controller;
      if (!viewModel) return [];

      const computed = [];
      let proto = Object.getPrototypeOf(viewModel);

      while (proto && proto !== Object.prototype) {
        const descriptors = Object.getOwnPropertyDescriptors(proto);
        for (const [name, desc] of Object.entries(descriptors)) {
          if (name === 'constructor' || name.startsWith('_') || name.startsWith('$')) continue;
          if (typeof desc.get !== 'function') continue;

          let value, type = 'unknown';
          try {
            value = viewModel[name];
            type = value === null ? 'null' : value === undefined ? 'undefined' : Array.isArray(value) ? 'array' : typeof value;
            value = formatPreview(value);
          } catch (e) {
            value = '[Error]';
            type = 'error';
          }

          computed.push({ name, value, type, hasGetter: true, hasSetter: !!desc.set });
        }
        proto = Object.getPrototypeOf(proto);
      }

      return computed;
    } catch {
      return [];
    }
  }

  function extractKeyName(key) {
    if (!key) return null;
    if (typeof key === 'string') return key;
    if (typeof key === 'function') return key.name || 'Anonymous';
    if (typeof key === 'symbol') return key.description || 'Symbol';
    if (key.key) return extractKeyName(key.key);
    if (key.friendlyName) return key.friendlyName;
    return String(key);
  }

  function inferDependencyType(key) {
    if (!key) return 'unknown';

    const keyStr = String(key);

    if (typeof key === 'function' && key.name && key.name[0] === 'I' && key.name[1] === key.name[1].toUpperCase()) {
      return 'interface';
    }

    if (keyStr.includes('Token') || keyStr.includes('KEY')) {
      return 'token';
    }

    if (typeof key === 'function' && key.prototype) {
      return 'service';
    }

    return 'unknown';
  }

  function extractDependencies(controller) {
    if (!controller) return null;

    try {
      const version = detectControllerVersion(controller);
      const deps = [];

      if (version === 2) {
        const Type = controller.definition?.Type;
        if (Type && Type.inject) {
          const injectKeys = Array.isArray(Type.inject) ? Type.inject : [Type.inject];
          injectKeys.forEach(key => {
            deps.push({
              name: extractKeyName(key) || 'unknown',
              key: String(key),
              type: inferDependencyType(key)
            });
          });
        }
      }

      if (version === 1) {
        const Type = controller.behavior?.target;
        if (Type && Type.inject) {
          const injectKeys = Array.isArray(Type.inject) ? Type.inject : [Type.inject];
          injectKeys.forEach(key => {
            deps.push({
              name: extractKeyName(key) || 'unknown',
              key: String(key),
              type: inferDependencyType(key)
            });
          });
        }
      }

      return { dependencies: deps, containerDepth: 0 };
    } catch {
      return null;
    }
  }

  function getRegistrationCount(container) {
    try {
      const resolvers = container._resolvers || container['_resolvers'];
      if (resolvers && resolvers.size !== undefined) {
        return resolvers.size;
      }
    } catch {}
    return -1;
  }

  function getContainerOwnerName(container) {
    try {
      if (container.root === container) return 'Root';

      const res = container.res;
      if (res) {
        for (const key in res) {
          if (key.startsWith('au:resource:custom-element:')) {
            return key.replace('au:resource:custom-element:', '');
          }
        }
      }

      if (container._resolver && container._resolver.Type) {
        return container._resolver.Type.name || null;
      }
    } catch {}
    return null;
  }

  function extractContainerHierarchy(controller) {
    const container = controller.container;
    if (!container) return null;

    try {
      const ancestors = [];
      let current = container;
      let depthCounter = 0;

      while (current) {
        ancestors.push({
          id: typeof current.id === 'number' ? current.id : depthCounter,
          depth: typeof current.depth === 'number' ? current.depth : depthCounter,
          isRoot: current.parent === null,
          registrationCount: getRegistrationCount(current),
          ownerName: getContainerOwnerName(current)
        });
        current = current.parent;
        depthCounter++;
      }

      return {
        current: ancestors[0],
        ancestors: ancestors.slice(1)
      };
    } catch {
      return null;
    }
  }

  function findProvidingContainerDepth(container, key) {
    let current = container;
    let depth = 0;

    while (current) {
      try {
        if (typeof current.has === 'function' && current.has(key, false)) {
          return typeof current.depth === 'number' ? current.depth : depth;
        }
      } catch {}
      current = current.parent;
      depth++;
    }

    return -1;
  }

  function findProvidingContainer(container, key) {
    let current = container;
    let depthCounter = 0;

    while (current) {
      try {
        if (typeof current.has === 'function' && current.has(key, false)) {
          return {
            id: typeof current.id === 'number' ? current.id : depthCounter,
            depth: typeof current.depth === 'number' ? current.depth : depthCounter,
            isRoot: current.parent === null,
            registrationCount: getRegistrationCount(current)
          };
        }
      } catch {}
      current = current.parent;
      depthCounter++;
    }

    return null;
  }

  function getValueType(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'Array';
    const type = typeof value;
    if (type === 'object' && value.constructor && value.constructor.name !== 'Object') {
      return value.constructor.name;
    }
    return type;
  }

  function serializeForDevtools(value, depth = 0, maxDepth = 2, seen = new WeakSet()) {
    if (depth > maxDepth) return '[Max depth]';
    if (value === null) return null;
    if (value === undefined) return undefined;

    const type = typeof value;

    if (type === 'string' || type === 'number' || type === 'boolean') {
      return value;
    }

    if (type === 'function') {
      return '[Function: ' + (value.name || 'anonymous') + ']';
    }

    if (type === 'object') {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);

      if (Array.isArray(value)) {
        if (value.length > 10) {
          return '[Array(' + value.length + ')]';
        }
        return value.slice(0, 10).map(function(v) {
          return serializeForDevtools(v, depth + 1, maxDepth, seen);
        });
      }

      if (value.constructor && value.constructor.name !== 'Object') {
        const className = value.constructor.name;
        const preview = { __type__: className };
        const keys = Object.keys(value).slice(0, 5);
        keys.forEach(function(k) {
          preview[k] = serializeForDevtools(value[k], depth + 1, maxDepth, seen);
        });
        return preview;
      }

      const result = {};
      const keys = Object.keys(value).slice(0, 10);
      keys.forEach(function(k) {
        result[k] = serializeForDevtools(value[k], depth + 1, maxDepth, seen);
      });
      return result;
    }

    return String(value);
  }

  function getInstancePreview(instance, maxProps) {
    if (!instance || typeof instance !== 'object') return null;

    try {
      const preview = {};
      const keys = Object.keys(instance);
      let count = 0;

      for (let i = 0; i < keys.length && count < maxProps; i++) {
        const key = keys[i];
        if (key.startsWith('_') || key.startsWith('$')) continue;

        const val = instance[key];
        const type = typeof val;

        if (type === 'function') continue;

        if (type === 'string' || type === 'number' || type === 'boolean' || val === null) {
          preview[key] = val;
          count++;
        } else if (Array.isArray(val)) {
          preview[key] = '[Array(' + val.length + ')]';
          count++;
        } else if (type === 'object') {
          preview[key] = '{...}';
          count++;
        }
      }

      return Object.keys(preview).length > 0 ? preview : null;
    } catch {
      return null;
    }
  }

  function extractEnhancedDependencies(controller) {
    const version = detectControllerVersion(controller);
    if (version !== 2) return null;

    const container = controller.container;
    const Type = controller.definition && controller.definition.Type;
    if (!Type || !Type.inject || !container) return null;

    try {
      const deps = [];
      const injectKeys = Array.isArray(Type.inject) ? Type.inject : [Type.inject];

      injectKeys.forEach(function(key) {
        const dep = {
          name: extractKeyName(key) || 'unknown',
          key: String(key),
          type: inferDependencyType(key),
          containerDepth: findProvidingContainerDepth(container, key),
          containerInfo: findProvidingContainer(container, key),
          resolvedValue: null,
          resolvedType: null,
          instanceName: null,
          instancePreview: null
        };

        try {
          const resolved = container.get(key);
          dep.resolvedType = getValueType(resolved);

          if (resolved && typeof resolved === 'object') {
            const ctorName = resolved.constructor ? resolved.constructor.name : null;
            if (ctorName && ctorName !== 'Object' && ctorName.length > 1) {
              dep.instanceName = ctorName;
            }
            dep.instancePreview = getInstancePreview(resolved, 4);
          } else {
            dep.resolvedValue = resolved;
          }
        } catch {}

        deps.push(dep);
      });

      return deps;
    } catch {
      return null;
    }
  }

  function inferServiceType(key) {
    const keyStr = String(key);
    if (keyStr.includes('au:resource:')) {
      return 'resource';
    }
    return inferDependencyType(key);
  }

  function isInternalAureliaKey(keyStr) {
    if (keyStr.startsWith('au:')) return true;
    if (keyStr.startsWith('IWindow')) return true;
    if (keyStr.startsWith('ILocation')) return true;
    if (keyStr.startsWith('IHistory')) return true;
    if (keyStr.includes('__au_')) return true;
    if (keyStr === 'function Object() { [native code] }') return true;
    if (keyStr === 'function Array() { [native code] }') return true;
    return false;
  }

  function extractAvailableServices(controller) {
    const version = detectControllerVersion(controller);
    if (version !== 2) return null;

    const container = controller.container;
    if (!container) return null;

    try {
      const services = [];
      const seen = new Set();
      let current = container;
      let isAncestor = false;

      while (current) {
        try {
          const resolvers = current._resolvers || current['_resolvers'];
          if (resolvers && typeof resolvers.forEach === 'function') {
            resolvers.forEach(function(resolver, key) {
              const keyStr = String(key);

              if (isInternalAureliaKey(keyStr)) return;
              if (seen.has(keyStr)) return;

              seen.add(keyStr);

              const name = extractKeyName(key) || keyStr;
              if (name.length <= 2) return;

              services.push({
                name: name,
                key: keyStr,
                type: inferServiceType(key),
                isFromAncestor: isAncestor
              });
            });
          }
        } catch {}

        current = current.parent;
        isAncestor = true;
      }

      return services;
    } catch {
      return null;
    }
  }

  function extractEnhancedDISnapshot(controller) {
    if (!controller) return null;

    const version = detectControllerVersion(controller);
    if (version !== 2) {
      return extractDependencies(controller);
    }

    try {
      const result = {
        version: 2,
        dependencies: [],
        containerHierarchy: null,
        availableServices: []
      };

      try {
        result.dependencies = extractEnhancedDependencies(controller) || [];
      } catch {}

      try {
        result.containerHierarchy = extractContainerHierarchy(controller);
      } catch {}

      try {
        result.availableServices = extractAvailableServices(controller) || [];
      } catch {}

      return result;
    } catch {
      return extractDependencies(controller);
    }
  }

  function extractRouteInfo(controller) {
    if (!controller) return null;

    try {
      const viewModel = controller.viewModel || controller.bindingContext;
      const info = {
        currentRoute: null,
        params: [],
        queryParams: [],
        navigationId: null,
        isNavigating: false
      };

      if (viewModel) {
        if (viewModel.$params && typeof viewModel.$params === 'object') {
          Object.entries(viewModel.$params).forEach(([k, v]) => {
            info.params.push({ name: k, value: String(v) });
          });
        }

        if (viewModel.activationParams && typeof viewModel.activationParams === 'object') {
          Object.entries(viewModel.activationParams).forEach(([k, v]) => {
            info.params.push({ name: k, value: String(v) });
          });
        }

        if (viewModel.routeConfig) {
          info.currentRoute = viewModel.routeConfig.route || viewModel.routeConfig.name || null;
        }
      }

      try {
        const urlParams = new URLSearchParams(window.location.search);
        urlParams.forEach((v, k) => {
          info.queryParams.push({ name: k, value: v });
        });
      } catch {}

      return info;
    } catch {
      return null;
    }
  }

  function extractSlotInfo(controller) {
    if (!controller) return null;

    try {
      const slots = [];
      const host = controller.host || (controller.view && controller.view.host);

      if (host) {
        const auSlots = host.querySelectorAll('au-slot');
        auSlots.forEach(el => {
          const name = el.getAttribute('name') || 'default';
          slots.push({
            name,
            hasContent: el.childNodes.length > 0 || (el.textContent && el.textContent.trim().length > 0),
            nodeCount: el.childNodes.length
          });
        });

        const nativeSlots = host.querySelectorAll('slot');
        nativeSlots.forEach(el => {
          const name = el.getAttribute('name') || 'default';
          const assigned = el.assignedNodes ? el.assignedNodes() : [];
          slots.push({
            name,
            hasContent: assigned.length > 0,
            nodeCount: assigned.length
          });
        });
      }

      return {
        slots,
        hasDefaultSlot: slots.some(s => s.name === 'default')
      };
    } catch {
      return null;
    }
  }

  function extractTemplateSnapshot(controller) {
    if (!controller) return null;

    try {
      const version = detectControllerVersion(controller);
      const viewModel = controller.viewModel || controller.bindingContext || controller;
      const componentKey = controller.definition?.key || controller.definition?.name ||
                          controller.behavior?.elementName || controller.behavior?.attributeName || 'unknown';
      const componentName = controller.definition?.name ||
                           controller.behavior?.elementName || controller.behavior?.attributeName || 'unknown';

      const bindings = extractTemplateBindings(controller, version);
      const controllers = extractTemplateControllers(controller, version);

      let hasSlots = false;
      let shadowMode = 'none';
      let isContainerless = false;

      if (version === 2) {
        const def = controller.definition || controller._compiledDef;
        hasSlots = def?.hasSlots || false;
        shadowMode = def?.shadowOptions?.mode || 'none';
        isContainerless = def?.containerless || false;
      }

      return {
        componentKey,
        componentName,
        bindings,
        controllers,
        instructions: [],
        hasSlots,
        shadowMode,
        isContainerless
      };
    } catch {
      return null;
    }
  }

  function extractTemplateBindings(controller, version) {
    const bindings = [];
    let bindingId = 0;

    try {
      let bindingList = [];

      if (version === 2) {
        bindingList = controller.bindings || [];
      } else {
        const view = controller.view;
        bindingList = view?.bindings || [];
      }

      for (const binding of bindingList) {
        if (!binding) continue;

        const ast = binding.ast || binding.sourceExpression || binding.expression;
        if (!ast) continue;

        const kind = ast.$kind || ast.kind || ast.type || (ast.constructor && ast.constructor.name) || 'unknown';
        const expr = unparseExpression(ast);

        let type = 'property';
        if (kind === 'Interpolation' || kind === 'InterpolationBinding') {
          type = 'interpolation';
        } else if (binding.targetEvent || kind === 'ListenerBinding' || kind === 'Listener') {
          type = 'listener';
        } else if (kind === 'RefBinding' || binding.targetProperty === '$ref') {
          type = 'ref';
        } else if (kind === 'LetBinding') {
          type = 'let';
        } else if (binding.targetAttribute || kind === 'AttributeBinding') {
          type = 'attribute';
        }

        let mode = 'default';
        if (binding.mode !== undefined) {
          const modeMap = { 0: 'default', 1: 'oneTime', 2: 'toView', 3: 'fromView', 4: 'twoWay' };
          mode = modeMap[binding.mode] || 'default';
        } else if (binding.updateSource && binding.updateTarget) {
          mode = 'twoWay';
        } else if (binding.updateTarget) {
          mode = 'toView';
        } else if (binding.updateSource) {
          mode = 'fromView';
        }

        let value = undefined;
        let valueType = 'unknown';
        try {
          if (binding._value !== undefined) {
            value = binding._value;
          } else if (binding.value !== undefined) {
            value = binding.value;
          } else if (binding._scope && ast) {
            const scope = binding._scope;
            if (scope.bindingContext) {
              const propName = ast.name || (ast.object && ast.object.name);
              if (propName && scope.bindingContext[propName] !== undefined) {
                value = scope.bindingContext[propName];
              }
            }
          }
          valueType = value === null ? 'null' : value === undefined ? 'undefined' :
                     Array.isArray(value) ? 'array' : typeof value;
          if (valueType === 'object' || valueType === 'array') {
            value = formatPreview(value);
          }
        } catch {}

        const target = binding.targetProperty || binding.targetEvent || binding.targetAttribute || 'unknown';

        bindings.push({
          id: `binding-${bindingId++}`,
          type,
          expression: expr,
          target,
          value,
          valueType,
          mode,
          isBound: binding.isBound !== false
        });
      }
    } catch {}

    return bindings;
  }

  function extractTemplateControllers(controller, version) {
    const controllers = [];
    let controllerId = 0;

    try {
      const children = controller.children || [];

      for (const child of children) {
        if (!child) continue;

        const defName = child.definition?.name || child.vmKind || '';
        const vmKind = child.vmKind;

        if (vmKind === 'synthetic' || defName === 'if' || defName === 'else' ||
            defName === 'repeat' || defName === 'with' || defName === 'switch' ||
            defName === 'case' || defName === 'au-slot' || defName === 'portal') {

          const vm = child.viewModel;
          let type = defName || 'other';
          let expression = '';
          let isActive = child.isActive !== false;
          let condition = undefined;
          let items = undefined;
          let itemCount = undefined;
          let localVariable = undefined;
          let cachedViews = undefined;

          if (type === 'if' || type === 'else') {
            condition = vm?.value;
            isActive = !!condition;
            if (vm?.ifView) cachedViews = 1;
            if (vm?.elseView) cachedViews = (cachedViews || 0) + 1;
          }

          if (type === 'repeat') {
            const repeatVm = vm;
            localVariable = repeatVm?.local;
            itemCount = repeatVm?.items?.length ?? repeatVm?._normalizedItems?.length ?? 0;

            if (repeatVm?.forOf) {
              expression = unparseExpression(repeatVm.forOf);
            }

            const maxItems = 10;
            items = [];
            const normalizedItems = repeatVm?._normalizedItems || repeatVm?.items || [];
            const count = Math.min(normalizedItems.length, maxItems);

            for (let i = 0; i < count; i++) {
              const itemValue = normalizedItems[i];
              items.push({
                index: i,
                value: formatPreview(itemValue),
                isFirst: i === 0,
                isLast: i === normalizedItems.length - 1,
                isEven: i % 2 === 0,
                isOdd: i % 2 === 1
              });
            }

            if (normalizedItems.length > maxItems) {
              items.push({
                index: maxItems,
                value: `... and ${normalizedItems.length - maxItems} more`,
                isFirst: false,
                isLast: true,
                isEven: false,
                isOdd: false
              });
            }
          }

          controllers.push({
            id: `tc-${controllerId++}`,
            type,
            name: defName,
            expression,
            isActive,
            condition,
            items,
            itemCount,
            localVariable,
            cachedViews
          });
        }

        const nestedControllers = extractTemplateControllers(child, version);
        controllers.push(...nestedControllers);
      }
    } catch {}

    return controllers;
  }

  return { hooks, debugValueLookup };

  function registerExternalPanelBridge() {
    try {
      window.addEventListener('aurelia-devtools-panel-data', handleExternalPanelData, true);
      window.addEventListener('aurelia-devtools-panel-remove', handleExternalPanelRemove, true);
      window.addEventListener('aurelia-devtools-panel-clear', clearExternalPanels, true);
      window.dispatchEvent(
        new CustomEvent('aurelia-devtools-ready', {
          detail: {
            version: window.__AURELIA_DEVTOOLS_VERSION__ || window.__AURELIA_DEVTOOLS_DETECTED_VERSION__ || null,
          },
        })
      );
    } catch {}
  }

  function handleExternalPanelData(event) {
    if (!event || !event.detail) {
      return;
    }
    upsertExternalPanel(event.detail);
  }

  function handleExternalPanelRemove(event) {
    if (!event || !event.detail) {
      return;
    }
    const identifier = event.detail.id || event.detail.panelId;
    if (!identifier) {
      return;
    }
    const id = String(identifier);
    if (externalPanels.delete(id)) {
      externalPanelsVersion += 1;
    }
  }

  function clearExternalPanels() {
    externalPanels.clear();
    externalPanelsVersion += 1;
  }

  function upsertExternalPanel(detail) {
    const normalized = normalizeExternalPanel(detail);
    if (!normalized) {
      return;
    }
    externalPanels.set(normalized.id, normalized);
    externalPanelsVersion += 1;
  }

  function normalizeExternalPanel(detail) {
    if (!detail) {
      return null;
    }

    const identifier = detail.id || detail.panelId || detail.name;
    if (!identifier) {
      return null;
    }

    const id = String(identifier);
    const labelSource = detail.label || detail.title || detail.name || id;
    const label =
      typeof labelSource === 'string' && labelSource.trim()
        ? labelSource.trim().slice(0, 80)
        : id;
    const icon =
      typeof detail.icon === 'string' && detail.icon.trim()
        ? detail.icon.trim().slice(0, 4)
        : '🧩';
    const description =
      typeof detail.description === 'string'
        ? detail.description.trim().slice(0, 400)
        : undefined;
    const order =
      typeof detail.order === 'number' && !isNaN(detail.order)
        ? detail.order
        : 0;

    const result = normalizePanelResult(detail, id, label);
    return {
      id,
      label,
      icon,
      description,
      order,
      ...result,
    };
  }

  function normalizePanelResult(detail, id, label) {
    const normalized = {
      status: typeof detail.status === 'string' ? detail.status : 'ok',
      pluginId: id,
      title: typeof detail.title === 'string' ? detail.title : undefined,
      summary:
        typeof detail.summary === 'string'
          ? detail.summary
          : typeof detail.description === 'string'
            ? detail.description
            : undefined,
      sections: normalizeSections(detail.sections || detail.blocks || detail.groups) || undefined,
      data:
        detail.data !== undefined
          ? sanitizeForTransport(detail.data)
          : detail.payload !== undefined
            ? sanitizeForTransport(detail.payload)
            : undefined,
      raw: detail.raw !== undefined ? sanitizeForTransport(detail.raw) : undefined,
      table: normalizeTable(detail.table),
      error: typeof detail.error === 'string' ? detail.error : undefined,
      timestamp: typeof detail.timestamp === 'number' ? detail.timestamp : Date.now(),
    };

    if (!normalized.sections) {
      const fallbackRows = normalizeRows(detail.rows || detail.entries || detail.items);
      if (fallbackRows) {
        normalized.sections = [{ title: label, rows: fallbackRows }];
      }
    }

    return normalized;
  }

  function emitDevtoolsEvent(eventName, payload) {
    if (!eventName || typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
      return false;
    }
    try {
      window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
      return true;
    } catch {
      return false;
    }
  }

  function normalizeSections(sections) {
    if (!Array.isArray(sections)) {
      return undefined;
    }

    const normalized = sections
      .map((section) => {
        if (!section || typeof section !== 'object') {
          return null;
        }

        const rows = normalizeRows(section.rows || section.entries || section.items);
        const table = normalizeTable(section.table);

        if (!rows && !table) {
          return null;
        }

        return {
          title: typeof section.title === 'string' ? section.title : undefined,
          description: typeof section.description === 'string' ? section.description : undefined,
          rows,
          table,
        };
      })
      .filter((section) => !!section);

    return normalized.length ? normalized : undefined;
  }

  function normalizeRows(rows) {
    if (!Array.isArray(rows)) {
      return undefined;
    }

    const normalized = rows
      .map((row) => {
        if (row == null) {
          return null;
        }

        if (typeof row === 'string' || typeof row === 'number' || typeof row === 'boolean') {
          return {
            label: '',
            value: sanitizeForTransport(row),
            format: typeof row === 'object' ? 'json' : 'text',
          };
        }

        if (typeof row === 'object') {
          const label = typeof row.label === 'string'
            ? row.label
            : (typeof row.name === 'string' ? row.name : '');
          const valueSource = row.value !== undefined ? row.value : (row.text !== undefined ? row.text : row.details);
          const value = sanitizeForTransport(valueSource);
          const format = typeof row.format === 'string' ? row.format : (typeof value === 'object' ? 'json' : 'text');
          const hint = typeof row.hint === 'string' ? row.hint : undefined;
          return { label, value, format, hint };
        }

        return null;
      })
      .filter((row) => !!row);

    return normalized.length ? normalized : undefined;
  }

  function normalizeTable(table) {
    if (!table || typeof table !== 'object') {
      return undefined;
    }

    const columns = Array.isArray(table.columns)
      ? table.columns.map((column) => String(column))
      : undefined;
    const rows = Array.isArray(table.rows)
      ? table.rows
          .map((row) => (Array.isArray(row) ? row.map((cell) => sanitizeForTransport(cell)) : null))
          .filter((row) => !!row)
      : undefined;

    if ((!columns || !columns.length) && (!rows || !rows.length)) {
      return undefined;
    }

    return { columns, rows };
  }

  function sanitizeForTransport(value, seen, depth) {
    if (value == null) {
      return value;
    }

    if (!seen) {
      seen = new Set();
    }
    if (depth === undefined) {
      depth = 0;
    }

    const MAX_DEPTH = 5;
    const MAX_KEYS = 30;
    const MAX_ARRAY = 50;

    if (depth > MAX_DEPTH) {
      return '[Max Depth]';
    }

    if (typeof value === 'function') {
      return value.name ? `[Function: ${value.name}]` : '[Function]';
    }

    if (typeof Node !== 'undefined' && value instanceof Node) {
      return `[${value.nodeName || 'Node'}]`;
    }

    if (typeof value === 'object') {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);

      if (Array.isArray(value)) {
        const slice = value.length > MAX_ARRAY ? value.slice(0, MAX_ARRAY) : value;
        const mapped = slice.map((item) => sanitizeForTransport(item, seen, depth + 1));
        if (value.length > MAX_ARRAY) {
          mapped.push(`[...${value.length - MAX_ARRAY} more]`);
        }
        seen.delete(value);
        return mapped;
      }

      if (value instanceof Error) {
        const errorPayload = {
          message: value.message,
          stack: value.stack,
          name: value.name,
        };
        seen.delete(value);
        return errorPayload;
      }

      const output = {};
      let keyCount = 0;
      const keys = Object.keys(value);
      for (const key of keys) {
        if (keyCount >= MAX_KEYS) {
          output['...'] = `${keys.length - MAX_KEYS} more keys`;
          break;
        }
        if (key.startsWith('_') || key.startsWith('$')) continue;
        try {
          output[key] = sanitizeForTransport(value[key], seen, depth + 1);
          keyCount++;
        } catch {
          output[key] = '[Unreadable]';
          keyCount++;
        }
      }
      seen.delete(value);
      return output;
    }

    return value;
  }

  function extractControllerInfo(controller) {
    if (!controller) return null;

    try {
      // Handle Aurelia v2 (both custom elements and custom attributes)
      if (controller.definition && controller.viewModel) {
        const interpolationMap = extractInterpolationMap(controller);
        const bindableKeys = Object.keys(controller.definition.bindables || {});
        const properties = Object.keys(controller.viewModel)
          .filter((x) => !bindableKeys.some((y) => y === x))
          .filter((x) => !x.startsWith("$"))
          .map((y) => {
            const debugInfo = setValueOnDebugInfo(
              { name: y },
              controller.viewModel[y],
              controller.viewModel,
            );
            if (interpolationMap[y] && interpolationMap[y].length) {
              debugInfo.expression = interpolationMap[y].join(' | ');
            }
            return debugInfo;
          });

        const bindingList = getControllerBindings(controller);
        if (bindingList && bindingList.length) {
          properties.unshift(
            setValueOnDebugInfo(
              { name: 'bindings', canEdit: false },
              bindingList,
              controller,
              { canEdit: false }
            )
          );
        }

        const instructions = getControllerInstructions(controller);
        if (instructions && instructions.length) {
          properties.unshift(
            setValueOnDebugInfo(
              { name: 'instructions', canEdit: false },
              instructions,
              controller,
              { canEdit: false }
            )
          );
        }

        return {
          bindables: bindableKeys.map((y) => {
            const debugInfo = setValueOnDebugInfo(
              { name: y },
              controller.viewModel[y],
              controller.viewModel,
            );
            if (interpolationMap[y] && interpolationMap[y].length) {
              debugInfo.expression = interpolationMap[y].join(' | ');
            }
            return debugInfo;
          }),
          properties,
          name: controller.definition.name,
          aliases: controller.definition.aliases || [],
          key: controller.definition.key,
          // Expose controller internals for inspection (exclude viewModel to avoid duplication)
          controller: convertObjectToDebugInfo(controller, { viewModel: true })
        };
      }
      // Handle Aurelia v1 (both custom elements and custom attributes)
      else if (controller.behavior && controller.viewModel) {
        const interpolationMap = extractInterpolationMap(controller);
        const behavior = controller.behavior;
        const viewModel = controller.viewModel;
        const bindableProperties = behavior.properties || [];
        const bindableKeys = bindableProperties.map(prop => prop.name);
        const properties = Object.keys(viewModel)
          .filter((x) => !bindableKeys.some((y) => y === x))
          .filter((x) => !x.startsWith("$") && !denyListProps.includes(x))
          .map((y) => {
            const debugInfo = setValueOnDebugInfo(
              { name: y },
              viewModel[y],
              viewModel,
            );
            if (interpolationMap[y] && interpolationMap[y].length) {
              debugInfo.expression = interpolationMap[y].join(' | ');
            }
            return debugInfo;
          });

        const bindingList = getControllerBindings(controller);
        if (bindingList && bindingList.length) {
          properties.unshift(
            setValueOnDebugInfo(
              { name: 'bindings', canEdit: false },
              bindingList,
              controller,
              { canEdit: false }
            )
          );
        }

        const instructions = getControllerInstructions(controller);
        if (instructions && instructions.length) {
          properties.unshift(
            setValueOnDebugInfo(
              { name: 'instructions', canEdit: false },
              instructions,
              controller,
              { canEdit: false }
            )
          );
        }

        return {
          bindables: bindableProperties.map((prop) => {
            const debugInfo = setValueOnDebugInfo(
              { name: prop.name, attribute: prop.attribute },
              viewModel[prop.name],
              viewModel,
            );
            if (interpolationMap[prop.name] && interpolationMap[prop.name].length) {
              debugInfo.expression = interpolationMap[prop.name].join(' | ');
            }
            return debugInfo;
          }),
          properties,
          name: behavior.elementName || behavior.attributeName,
          aliases: [],
          key: behavior.elementName || behavior.attributeName,
          controller: convertObjectToDebugInfo(controller, { viewModel: true })
        };
      }
      // Handle edge cases where controller has different structure
      else if (controller.viewModel || controller.bindingContext) {
        const viewModel = controller.viewModel || controller.bindingContext;
        const name = controller.name || controller.constructor?.name || 'unknown';
        const properties = Object.keys(viewModel)
          .filter((x) => !x.startsWith("$") && !denyListProps.includes(x))
          .map((y) => {
            return setValueOnDebugInfo(
              { name: y },
              viewModel[y],
              viewModel,
            );
          });

        const bindingList = getControllerBindings(controller);
        if (bindingList && bindingList.length) {
          properties.unshift(
            setValueOnDebugInfo(
              { name: 'bindings', canEdit: false },
              bindingList,
              controller,
              { canEdit: false }
            )
          );
        }

        const instructions = getControllerInstructions(controller);
        if (instructions && instructions.length) {
          properties.unshift(
            setValueOnDebugInfo(
              { name: 'instructions', canEdit: false },
              instructions,
              controller,
              { canEdit: false }
            )
          );
        }

        return {
          bindables: [],
          properties,
          name: name,
          aliases: [],
          key: name,
        };
      }
      // Handle cases where controller itself is the viewModel
      else if (typeof controller === 'object' && controller.constructor) {
        const name = controller.constructor.name || 'unknown';
        return {
          bindables: [],
          properties: Object.keys(controller)
            .filter((x) => !x.startsWith("$") && !denyListProps.includes(x))
            .map((y) => {
              return setValueOnDebugInfo(
                { name: y },
                controller[y],
                controller,
              );
            }),
          name: name,
          aliases: [],
          key: name,
        };
      }
    } catch (error) {
      // If extraction fails, return a basic error info object
      return {
        bindables: [],
        properties: [{
          name: 'extraction_error',
          value: error.message || 'Failed to extract controller info',
          type: 'string',
          canEdit: false,
          debugId: getNextDebugId()
        }],
        name: 'error',
        aliases: [],
        key: 'error',
      };
    }

    return null;
  }
  function getValueFor(value) {
    if (value instanceof Node) {
      return value.constructor.name;
    } else if (Array.isArray(value)) {
      return `Array[${value.length}]`;
    } else if (typeof value === "object") {
      if (value.constructor) {
        return value.constructor.name;
      } else {
        return "Object";
      }
    } else {
      return value;
    }
  }

  function isMapLike(o) {
    if (!o || (typeof o !== "object" && typeof o !== "function")) {
      return false;
    }
    try {
      Map.prototype.has.call(o, undefined);
      return typeof o.size === "number" && typeof o.forEach === "function";
    } catch (e) {
      return false;
    }
  }

  function isSetLike(o) {
    if (!o || (typeof o !== "object" && typeof o !== "function")) {
      return false;
    }
    try {
      Set.prototype.has.call(o, undefined);
      return typeof o.size === "number" && typeof o.forEach === "function";
    } catch (e) {
      return false;
    }
  }

  function isMapEntryLike(o) {
    return !!(o && typeof o === "object" && o[MAP_ENTRY_METADATA_KEY]);
  }

  function formatPreview(value) {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (value instanceof Node) {
      return value.constructor?.name || "Node";
    }
    if (Array.isArray(value)) {
      return `Array[${value.length}]`;
    }
    if (isMapLike(value)) {
      return `Map(${value?.size ?? 0})`;
    }
    if (isSetLike(value)) {
      return `Set(${value?.size ?? 0})`;
    }

    const type = typeof value;
    switch (type) {
      case "string":
        return `"${value}"`;
      case "number":
      case "boolean":
      case "bigint":
        return String(value);
      case "symbol":
        return value.toString();
      case "function":
        return value.name ? `function ${value.name}` : "function";
      case "object":
        if (value && value.constructor && value.constructor.name) {
          return value.constructor.name;
        }
        return "Object";
      default:
        return String(value);
    }
  }

  function convertMapToDebugInfo(mapValue) {
    const properties = [];

    const sizeInfo = setValueOnDebugInfo(
      { name: "size" },
      mapValue.size,
      mapValue,
      { canEdit: false }
    );
    properties.push(sizeInfo);

    let index = 0;
    mapValue.forEach((entryValue, entryKey) => {
      const entryObject = { key: entryKey, value: entryValue };
      try {
        Object.defineProperty(entryObject, MAP_ENTRY_METADATA_KEY, {
          value: { key: entryKey },
          enumerable: false,
          configurable: false,
        });
      } catch {}
      const preview = `${formatPreview(entryKey)} => ${formatPreview(entryValue)}`;
      const entryInfo = setValueOnDebugInfo(
        { name: `[${index}]` },
        entryObject,
        mapValue,
        {
          displayValue: preview,
          expandableValue: entryObject,
          canEdit: false,
        }
      );
      properties.push(entryInfo);
      index += 1;
    });

    return { properties };
  }

  function convertSetToDebugInfo(setValue) {
    const properties = [];

    const sizeInfo = setValueOnDebugInfo(
      { name: "size" },
      setValue.size,
      setValue,
      { canEdit: false }
    );
    properties.push(sizeInfo);

    let index = 0;
    setValue.forEach((item) => {
      const entryInfo = setValueOnDebugInfo(
        { name: `[${index}]` },
        item,
        setValue,
        {
          canEdit: false,
        }
      );
      properties.push(entryInfo);
      index += 1;
    });

    return { properties };
  }

  function convertMapEntryToDebugInfo(entryObject) {
    const properties = [];

    const keyInfo = setValueOnDebugInfo(
      { name: "key" },
      entryObject.key,
      entryObject,
      { canEdit: false }
    );
    properties.push(keyInfo);

    const valueInfo = setValueOnDebugInfo(
      { name: "value" },
      entryObject.value,
      entryObject,
      { canEdit: false }
    );
    properties.push(valueInfo);

    return { properties };
  }

  function getControllerBindings(controller) {
    try {
      const view = controller && (controller.view || controller.viewModel?.view || controller.viewModel?.$view || controller.viewCache?.peek?.());
      const bindings = view && Array.isArray(view.bindings) ? view.bindings : null;
      return bindings && bindings.length ? bindings : null;
    } catch {
      return null;
    }
  }

  function extractInterpolationMap(controller) {
    const map = {};
    try {
      const bindings = getControllerBindings(controller);
      if (!bindings) return map;

      for (const binding of bindings) {
        if (!binding) continue;

        const ast = binding.ast || binding.sourceExpression || binding.expression;
        if (!ast) continue;

        const kind = ast.$kind || ast.kind || ast.type || (ast.constructor && ast.constructor.name);
        if (kind === 'Interpolation') {
          const fullExpr = unparseExpression(ast);
          const referencedNames = extractReferencedNames(ast);
          for (const name of referencedNames) {
            if (!map[name]) {
              map[name] = [];
            }
            map[name].push(fullExpr);
          }
        } else {
          const referencedNames = extractReferencedNames(ast);
          if (referencedNames.length) {
            const fullExpr = unparseExpression(ast);
            for (const name of referencedNames) {
              if (!map[name]) {
                map[name] = [];
              }
              if (fullExpr && !map[name].includes(fullExpr)) {
                map[name].push(fullExpr);
              }
            }
          }
        }
      }
    } catch {}
    return map;
  }

  function extractReferencedNames(ast) {
    const names = [];
    if (!ast) return names;

    const visit = (node) => {
      if (!node) return;
      const kind = node.$kind || node.kind || node.type || (node.constructor && node.constructor.name);

      switch (kind) {
        case 'AccessScope':
          if (node.name && !node.ancestor) {
            names.push(node.name);
          }
          break;
        case 'AccessMember':
          if (node.object) {
            const objKind = node.object.$kind || node.object.kind || node.object.type || (node.object.constructor && node.object.constructor.name);
            if (objKind === 'AccessScope' && node.object.name && !node.object.ancestor) {
              names.push(node.object.name);
            }
            visit(node.object);
          }
          break;
        case 'AccessKeyed':
          if (node.object) visit(node.object);
          if (node.key) visit(node.key);
          break;
        case 'CallScope':
          if (node.name && !node.ancestor) {
            names.push(node.name);
          }
          if (node.args) node.args.forEach(visit);
          break;
        case 'CallMember':
          if (node.object) visit(node.object);
          if (node.args) node.args.forEach(visit);
          break;
        case 'CallFunction':
          if (node.func) visit(node.func);
          if (node.args) node.args.forEach(visit);
          break;
        case 'Binary':
          if (node.left) visit(node.left);
          if (node.right) visit(node.right);
          break;
        case 'Unary':
          if (node.expression) visit(node.expression);
          break;
        case 'Conditional':
          if (node.condition) visit(node.condition);
          if (node.yes) visit(node.yes);
          if (node.no) visit(node.no);
          break;
        case 'Assign':
          if (node.target) visit(node.target);
          if (node.value) visit(node.value);
          break;
        case 'ValueConverter':
        case 'BindingBehavior':
          if (node.expression) visit(node.expression);
          if (node.args) node.args.forEach(visit);
          break;
        case 'Template':
        case 'TaggedTemplate':
        case 'Interpolation':
          if (node.expressions) node.expressions.forEach(visit);
          break;
        case 'ArrayLiteral':
          if (node.elements) node.elements.forEach(visit);
          break;
        case 'ObjectLiteral':
          if (node.values) node.values.forEach(visit);
          break;
        case 'ForOfStatement':
          if (node.iterable) visit(node.iterable);
          break;
      }
    };

    visit(ast);
    return [...new Set(names)];
  }

  function getControllerInstructions(controller) {
    try {
      const view = controller && (controller.view || controller.viewModel?.view || controller.viewModel?.$view || controller.viewCache?.peek?.());
      const instructions = view && Array.isArray(view.instructions) ? view.instructions : null;
      if (instructions && instructions.length && Array.isArray(instructions[0])) {
        // Flatten instruction rows if needed
        return instructions.flat().filter((x) => x);
      }
      return instructions && instructions.length ? instructions : null;
    } catch {
      return null;
    }
  }

  function isBindingLike(value) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) {
      return false;
    }

    const ctorName = value.constructor && value.constructor.name;
    const looksLikeCtor = typeof ctorName === 'string' && ctorName.toLowerCase().includes('binding');
    const hasAst = !!(value && (value.ast || value.sourceExpression || value.expression));
    const hasTargetMeta = 'targetProperty' in value || 'target' in value;
    const hasBindMethods = typeof value.updateTarget === 'function' || typeof value.callSource === 'function' || typeof value.updateSource === 'function';
    const hasInstructionShape = typeof value === 'object' && value !== null && ('from' in value) && ('to' in value);

    return looksLikeCtor || hasInstructionShape || (hasAst && (hasBindMethods || hasTargetMeta));
  }

  function extractBindingExpression(binding) {
    try {
      const candidate = binding && (binding.ast || binding.sourceExpression || binding.expression || binding.from);
      if (!candidate) return undefined;

      if (typeof candidate === 'string') {
        return candidate;
      }

      const unparsed = unparseExpression(candidate);
      if (unparsed) return unparsed;

      if (typeof candidate.expression === 'string') return candidate.expression;
      if (typeof candidate.name === 'string') return candidate.name;
      if (typeof binding.from === 'string') return binding.from;
      if (typeof candidate.toString === 'function') {
        const str = candidate.toString();
        if (str && typeof str === 'string' && str !== '[object Object]') {
          return str;
        }
      }
    } catch {}
    return undefined;
  }

  function unparseExpression(expr) {
    try {
      const visit = (node) => {
        if (!node) return '';
        const kind = node.$kind || node.kind || node.type || (node.constructor && node.constructor.name);
        switch (kind) {
          case 'AccessThis':
            if (node.ancestor === 0) return '$this';
            return Array(node.ancestor).fill('$parent').join('.');
          case 'AccessScope': {
            const parents = node.ancestor ? Array(node.ancestor).fill('$parent.').join('') : '';
            return parents + node.name;
          }
          case 'AccessMember':
            return `${visit(node.object)}${node.optional ? '?.' : '.'}${node.name}`;
          case 'AccessKeyed':
            return `${visit(node.object)}${node.optional ? '?.' : ''}[${visit(node.key)}]`;
          case 'CallScope':
            return `${visit({ $kind: 'AccessScope', name: node.name, ancestor: node.ancestor || 0 })}${node.optional ? '?.' : ''}(${(node.args || []).map(visit).join(', ')})`;
          case 'CallMember':
            return `${visit(node.object)}${node.optionalMember ? '?.' : '.'}${node.name}${node.optionalCall ? '?.' : ''}(${(node.args || []).map(visit).join(', ')})`;
          case 'CallFunction':
            return `${visit(node.func)}${node.optional ? '?.' : ''}(${(node.args || []).map(visit).join(', ')})`;
          case 'PrimitiveLiteral':
            if (typeof node.value === 'string') return `'${String(node.value).replace(/'/g, "\\'")}'`;
            return String(node.value);
          case 'ArrayLiteral':
            return `[${(node.elements || []).map(visit).join(', ')}]`;
          case 'ObjectLiteral':
            return `{${(node.keys || []).map((k, i) => `'${k}':${visit(node.values[i])}`).join(',')}}`;
          case 'Binary':
            return `(${visit(node.left)}${node.operation.charCodeAt && node.operation.charCodeAt(0) === 105 ? ' ' + node.operation + ' ' : node.operation}${visit(node.right)})`;
          case 'Unary':
            return `(${node.operation}${node.operation.charCodeAt && node.operation.charCodeAt(0) >= 97 ? ' ' : ''}${visit(node.expression)})`;
          case 'Conditional':
            return `(${visit(node.condition)}?${visit(node.yes)}:${visit(node.no)})`;
          case 'Assign':
            return `(${visit(node.target)}=${visit(node.value)})`;
          case 'ValueConverter':
            return `${visit(node.expression)}|${node.name}${(node.args || []).map((a) => ':' + visit(a)).join('')}`;
          case 'BindingBehavior':
            return `${visit(node.expression)}&${node.name}${(node.args || []).map((a) => ':' + visit(a)).join('')}`;
          case 'Template': {
            const parts = node.cooked || [];
            const exprs = node.expressions || [];
            let text = '`' + (parts[0] || '');
            for (let i = 0; i < exprs.length; i++) {
              text += '${' + visit(exprs[i]) + '}' + (parts[i + 1] || '');
            }
            text += '`';
            return text;
          }
          case 'TaggedTemplate': {
            const parts = node.cooked || [];
            const exprs = node.expressions || [];
            let text = visit(node.func) + '`' + (parts[0] || '');
            for (let i = 0; i < exprs.length; i++) {
              text += '${' + visit(exprs[i]) + '}' + (parts[i + 1] || '');
            }
            text += '`';
            return text;
          }
          case 'Interpolation': {
            const parts = node.parts || [];
            const exprs = node.expressions || [];
            let text = parts[0] || '';
            for (let i = 0; i < exprs.length; i++) {
              text += '${' + visit(exprs[i]) + '}' + (parts[i + 1] || '');
            }
            return text;
          }
          case 'ForOfStatement':
            return `${visit(node.declaration)} of ${visit(node.iterable)}`;
          case 'BindingIdentifier':
            return node.name;
          case 'ArrayBindingPattern':
            return `[${(node.elements || []).map(visit).join(', ')}]`;
          case 'ObjectBindingPattern':
            return `{${(node.keys || []).map((k, i) => `${k}:${visit(node.values[i])}`).join(',')}}`;
          default:
            return '';
        }
      };

      const result = visit(expr);
      return result || undefined;
    } catch {
      return undefined;
    }
  }

  function isAccessMemberAst(ast) {
    if (!ast) return false;
    const kind = ast.$kind || ast.kind || ast.type || (ast.constructor && ast.constructor.name);
    return kind === 'AccessMember' || kind === 'CallMember' || kind === 'AccessKeyed';
  }

  function getFromScope(scope, name, ancestor) {
    let current = scope || null;
    let steps = typeof ancestor === 'number' ? ancestor : 0;

    while (current && steps > 0) {
      current = current.parent || current.parentScope || current.scope || current.parentContext || null;
      steps -= 1;
    }

    if (!current) return undefined;

    if (current.bindingContext && Object.prototype.hasOwnProperty.call(current.bindingContext, name)) {
      return current.bindingContext[name];
    }

    if (current.overrideContext && Object.prototype.hasOwnProperty.call(current.overrideContext, name)) {
      return current.overrideContext[name];
    }

    if (current.bindingContext && name in current.bindingContext) {
      return current.bindingContext[name];
    }

    if (current.overrideContext && name in current.overrideContext) {
      return current.overrideContext[name];
    }

    if (name in current) {
      return current[name];
    }

    return undefined;
  }

  function evaluateAstNode(expr, scope) {
    try {
      if (!expr) return undefined;
      const kind = expr.$kind || expr.kind || expr.type || (expr.constructor && expr.constructor.name);
      switch (kind) {
        case 'AccessThis':
          return scope && scope.bindingContext ? scope.bindingContext : scope;
        case 'AccessScope':
          return getFromScope(scope, expr.name, expr.ancestor || 0);
        case 'AccessMember': {
          const base = evaluateAstNode(expr.object, scope);
          return base != null ? base[expr.name] : undefined;
        }
        case 'AccessKeyed': {
          const obj = evaluateAstNode(expr.object, scope);
          const key = evaluateAstNode(expr.key, scope);
          return obj != null ? obj[key] : undefined;
        }
        case 'PrimitiveLiteral':
          return expr.value;
        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
  }

  function getBindingDetails(binding) {
    if (!isBindingLike(binding)) {
      return null;
    }

    const expression = extractBindingExpression(binding);
    const details = { expression };

    const ast = binding.ast || binding.sourceExpression || null;
    if (isAccessMemberAst(ast)) {
      const scope = binding.scope || binding._scope || binding.$scope || binding.sourceScope || binding.$context || binding.source || null;
      details.member = evaluateAstNode(ast.object || ast.expression || null, scope);
    }

    return details;
  }

  function setValueOnDebugInfo(debugInfo, value, instance, overrides) {
    try {
      overrides = overrides || {};
      const bindingDetails = isBindingLike(value) ? getBindingDetails(value) : null;
      debugInfo.canExpand = false;
      debugInfo.canEdit = false;
      let expandableValue;

      if (value instanceof Node) {
        debugInfo.canExpand = true;
        debugInfo.type = "node";
        debugInfo.value = value.constructor.name;
        expandableValue = value;
      } else if (Array.isArray(value)) {
        debugInfo.canExpand = true;
        debugInfo.type = "array";
        debugInfo.value = `Array[${value.length}]`;
        expandableValue = value;
      } else if (isMapLike(value)) {
        debugInfo.canExpand = true;
        debugInfo.type = "map";
        debugInfo.value = `Map(${value?.size ?? 0})`;
        expandableValue = value;
      } else if (isSetLike(value)) {
        debugInfo.canExpand = true;
        debugInfo.type = "set";
        debugInfo.value = `Set(${value?.size ?? 0})`;
        expandableValue = value;
      } else {
        debugInfo.type = typeof value;
        debugInfo.value = value;
      }

      if (value === null) {
        debugInfo.type = "null";
        debugInfo.value = "null";
      } else if (value === undefined) {
        debugInfo.type = "undefined";
        debugInfo.value = "undefined";
      } else if (debugInfo.type === "object" && expandableValue === undefined) {
        debugInfo.canExpand = true;
        expandableValue = value;

        if (value && value.constructor) {
          debugInfo.value = value.constructor.name;
        } else {
          debugInfo.value = "Object";
        }
      }

      if (bindingDetails) {
        debugInfo.type = debugInfo.type === 'object' ? 'binding' : debugInfo.type;
        debugInfo.expression = bindingDetails.expression;
      }

      if (
        overrides.canEdit === undefined &&
        (debugInfo.type === "string" ||
          debugInfo.type === "number" ||
          debugInfo.type === "boolean")
      ) {
        debugInfo.canEdit = true;
      }

      if (overrides.type) {
        debugInfo.type = overrides.type;
      }
      if (overrides.displayValue !== undefined) {
        debugInfo.value = overrides.displayValue;
      }
      if (overrides.value !== undefined) {
        debugInfo.value = overrides.value;
      }
      if (overrides.canExpand !== undefined) {
        debugInfo.canExpand = overrides.canExpand;
      }
      if (overrides.canEdit !== undefined) {
        debugInfo.canEdit = overrides.canEdit;
      }
      if (overrides.expandableValue !== undefined) {
        expandableValue = overrides.expandableValue;
        if (expandableValue !== undefined && overrides.canExpand === undefined) {
          debugInfo.canExpand = true;
        }
      }

      const storedInstance =
        overrides.instance !== undefined ? overrides.instance : instance;

      debugInfo.debugId = debugInfo.debugId || getNextDebugId();

      debugValueLookup[debugInfo.debugId] = Object.assign(
        {
          instance: storedInstance,
          expandableValue: expandableValue,
        },
        debugInfo
      );

      return debugInfo;
    } catch (e) {
      return createErrorObject(e);
    }
  }

  function createControllerDebugInfo(controller) {
    try {
      let controllerDebugInfo = {
        name:
          controller.behavior.elementName || controller.behavior.attributeName,
      };

      let viewModel = controller.viewModel;
      let bindableKeys = {};

      controllerDebugInfo.bindables = controller.behavior.properties.map(
        (x) => {
          bindableKeys[x.name] = true;
          return setValueOnDebugInfo(
            {
              name: x.name,
              attribute: x.attribute,
            },
            viewModel[x.name],
            viewModel
          );
        }
      );

      controllerDebugInfo.properties = getDebugPropertyKeys(viewModel)
        .filter((x) => !(x in bindableKeys))
        .map((x) => {
          return setValueOnDebugInfo(
            {
              name: x,
            },
            viewModel[x],
            viewModel
          );
        });

      return controllerDebugInfo;
    } catch (e) {
      return createErrorObject(e);
    }
  }

  function convertBindingToDebugInfo(binding, blackList) {
    blackList = blackList || {};
    const properties = [];
    const details = getBindingDetails(binding) || {};

    if (details.expression) {
      properties.push(
        setValueOnDebugInfo(
          { name: 'expression', canEdit: false },
          details.expression,
          binding,
          { type: 'string', canExpand: false, canEdit: false }
        )
      );
    }

    if (details && Object.prototype.hasOwnProperty.call(details, 'member')) {
      properties.push(
        setValueOnDebugInfo(
          { name: 'member', canEdit: false },
          details.member,
          binding,
          { canEdit: false }
        )
      );
    }

    const keys = getDebugPropertyKeys(binding).filter((x) => !(x in blackList));
    for (const key of keys) {
      try {
        properties.push(
          setValueOnDebugInfo(
            { name: key },
            binding[key],
            binding
          )
        );
      } catch (e) {
        properties.push({ name: key, type: 'error', value: 'unavailable' });
      }
    }

    return { properties };
  }

  function convertObjectToDebugInfo(obj, blackList) {
    if (isBindingLike(obj)) {
      return convertBindingToDebugInfo(obj, blackList);
    }

    blackList = blackList || {};
    return {
      properties: getDebugPropertyKeys(obj)
        .filter((x) => !(x in blackList))
        .map((x) => {
          try {
            return setValueOnDebugInfo(
              { name: x },
              obj[x],
              obj
            );
          } catch (e) {
            return { name: x, type: 'error', value: 'unavailable' };
          }
        }),
    };
  }

  function getDebugInfoForNode(selectedNode) {
    try {
      var debugInfo = {};

      nextDebugId = 0;

      if (selectedNode.au) {
        var au = selectedNode.au;

        if (au.controller) {
          debugInfo.customElement = createControllerDebugInfo(au.controller);
        }

        var tagName = selectedNode.tagName
          ? selectedNode.tagName.toLowerCase()
          : null;
        var customAttributeNames = getDebugPropertyKeys(au).filter(function (
          key
        ) {
          return key !== "controller" && key !== tagName;
        });

        if (customAttributeNames.length) {
          debugInfo.customAttributes = customAttributeNames.map((x) =>
            createControllerDebugInfo(au[x])
          );
        }
      }

      let owningView = findOwningViewOfNode(selectedNode);

      if (owningView) {
        if (owningView.bindingContext) {
          debugInfo.bindingContext = convertObjectToDebugInfo(
            owningView.bindingContext
          );
        }

        if (owningView.overrideContext) {
          debugInfo.overrideContext = convertObjectToDebugInfo(
            owningView.overrideContext,
            { bindingContext: true, parentOverrideContext: true }
          );
        }
      }

      return debugInfo;
    } catch (e) {
      return createErrorObject(e);
    }
  }

  function findOwningViewOfNode(node) {
    function moveUp(n) {
      let current = n.parentNode;

      if (current) {
        return (
          findComposingView(current) ||
          findSiblingRepeaterView(current) ||
          findImmediateControllerOwningView(current) ||
          moveUp(current)
        );
      }

      return null;
    }

    return (
      attachedOwner(node) ||
      findSiblingRepeaterView(node) ||
      findImmediateControllerOwningView(node) ||
      moveUp(node)
    );
  }

  function updateValueForId(id, value) {
    let debugInfo = debugValueLookup[id];
    debugInfo.instance[debugInfo.name] = value;
    setValueOnDebugInfo(debugInfo, value, debugInfo.instance);
  }

  function getNextDebugId() {
    return ++nextDebugId;
  }

  function createErrorObject(e) {
    return [
      {
        // bindingContext: {
        // properties: [
        // {
        name: "Debugger Error",
        value: e.message,
        type: "string",
        canEdit: false,
        // }
        // ]
        // }
      },
    ];
  }

  function attachedOwner(node) {
    let ownerView = node.auOwnerView;

    if (ownerView && ownerView.viewFactory) {
      return ownerView;
    }

    return null;
  }

  function nodeIsImmediateChildOfView(view, node) {
    let currentChild = view.firstChild;
    let lastChild = view.lastChild;
    let nextChild;

    while (currentChild) {
      nextChild = currentChild.nextSibling;

      if (currentChild === node) {
        return true;
      }

      if (currentChild === lastChild) {
        break;
      }

      currentChild = nextChild;
    }

    return false;
  }

  function findSiblingRepeaterView(node) {
    if (!node) {
      return null;
    }

    let current = node.nextSibling;

    while (current) {
      if (
        current.nodeType === 8 &&
        current.viewSlot &&
        current.data === "anchor"
      ) {
        let children = current.viewSlot.children;

        for (let i = 0, ii = children.length; i < ii; ++i) {
          let view = children[i];

          if (nodeIsImmediateChildOfView(view, node)) {
            return view;
          }
        }
      }

      current = current.nextSibling;
    }

    return null;
  }

  function findImmediateControllerOwningView(node) {
    let parent = node.parentNode;

    if (
      parent &&
      parent.au &&
      parent.au.controller &&
      parent.au.controller.view &&
      nodeIsImmediateChildOfView(parent.au.controller.view, node)
    ) {
      return parent.au.controller.view;
    }

    return null;
  }

  function findComposingView(node) {
    if (!node) {
      return null;
    }

    if (node.aurelia) {
      return node.aurelia.root.view;
    } else if (attachedOwner(node)) {
      return attachedOwner(node);
    } else if (node.au) {
      var au = node.au;

      if (au.controller) {
        //custom element
        var controller = au.controller;
        var tagName = node.tagName ? node.tagName.toLowerCase() : null;

        if (tagName === "router-view") {
          return controller.viewModel.view;
        } else if (tagName === "compose") {
          return controller.viewModel.currentController.view;
        } else if (controller["with"]) {
          return controller["with"].viewModel.view;
        }
      }
    }

    return null;
  }

  function getDebugPropertyKeys(obj) {
    let props = [];

    if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) return props;
    let keys = [];
    try { keys = keys.concat(Object.keys(obj)); } catch {}
    try { keys = keys.concat(Object.getOwnPropertyNames(obj)); } catch {}
    const uniqueKeys = keys.filter((value, i, arr) => arr.indexOf(value) === i);

    for (const key of uniqueKeys) {
      const isDenyListed = denyListProps.some((x) => x === key);
      if (
        key &&
        !key.startsWith("_") &&
        !isDenyListed &&
        typeof obj[key] !== "function"
      ) {
        props.push(key);
      }
    }

    return props;
  }
}
/**
 * Manifest v3 approach to evaluate code in the context of the inspected window.
 */
const hooksAsStringv2 = `
  (function() {
    if (${optOutCheckExpression}) {
      return;
    }
    if (window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__ && window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__.__au_devtools_installed__) {
      return;
    }
    var globalDebugValueLookup = window.__AURELIA_DEVTOOLS_DEBUG_LOOKUP__;
    var installedData = (${install.toString()})(globalDebugValueLookup);
    var hooks = installedData.hooks;
    window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__ = hooks;
    window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__.__au_devtools_installed__ = true;
    globalDebugValueLookup = installedData.debugValueLookup;
    window.__AURELIA_DEVTOOLS_DEBUG_LOOKUP__ = globalDebugValueLookup;
  })();
  `;

chrome.runtime.onConnect.addListener((port) => {
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
