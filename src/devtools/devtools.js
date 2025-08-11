let panelCreated = false;
let detectedVersion = null;

// Always create the panel immediately 
function createAureliaPanel() {
  if (panelCreated) return;

  const panelHtml = "index.html";
  const panelTitle = "⚡ Aurelia";

  chrome.devtools.panels.create(
    panelTitle,
    "images/16.png",
    panelHtml,
    function (panel) {
      panelCreated = true;

      // Set initial detection state to false - let the app handle detection
      chrome.devtools.inspectedWindow.eval(`
        window.__AURELIA_DEVTOOLS_DETECTION_STATE__ = 'checking';
      `);
    }
  );
}

// Update detection state when version is detected
function updateDetectionState(version) {
  if (panelCreated) {
    chrome.devtools.inspectedWindow.eval(`
      window.__AURELIA_DEVTOOLS_VERSION__ = ${version};
      window.__AURELIA_DEVTOOLS_DETECTION_STATE__ = 'detected';
    `);
  }
}

// Create panel immediately when devtools opens
createAureliaPanel();

// Listen for Aurelia detection messages
chrome.runtime.onMessage.addListener((req, sender) => {
  if (sender.tab && req.aureliaDetected && req.version) {
    detectedVersion = req.version;
    updateDetectionState(req.version);
  }
});

// Also try to detect immediately when devtools opens
// This handles the case where Aurelia was already detected before devtools opened
chrome.devtools.inspectedWindow.eval(
  `
  // Return the detected version if available, or try to detect
  (function() {
    if (window.__AURELIA_DEVTOOLS_DETECTED_VERSION__) {
      return window.__AURELIA_DEVTOOLS_DETECTED_VERSION__;
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
    }

    return version;
  })();
`,
  (result, isException) => {
    if (isException) {
    } else if (result) {
      detectedVersion = result;
      updateDetectionState(result);
    } else {
      // Set detection state to 'not-found' if nothing detected initially
      if (panelCreated) {
        chrome.devtools.inspectedWindow.eval(`
          window.__AURELIA_DEVTOOLS_DETECTION_STATE__ = 'not-found';
        `);
      }
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

  const hooks = {
    Aurelia: undefined,
    currentElement: undefined,
    currentAttributes: [],
    getAllInfo: (root) => {
      root = root ?? document.body;
      return [
        hooks.getCustomElementInfo(root, false),
        ...Array.from(root.children).flatMap((y) => hooks.getAllInfo(y)),
      ].filter((x) => x);
    },
    updateValues: (info, property) => {
      if (!hooks.currentElement && !hooks.currentAttributes.length) return;

      const currentInfo =
        hooks.currentElement?.definition.key === info.key
          ? hooks.currentElement
          : hooks.currentAttributes.find((y) => y.definition.key === info.key);

      info.bindables.forEach((x) => (currentInfo.viewModel[x.name] = x.value));
      info.properties.forEach((x) => {
        // HMM: Not sure if we need the .value check
        const isObject = x.value === "Object" && x.type === "object";
        if (isObject) {
          let targetProp = currentInfo.viewModel[x.name][property.name];
          if (!targetProp) return;

          currentInfo.viewModel[x.name][property.name] = property.value;

          return;
        }

        currentInfo.viewModel[x.name] = x.value;
      });
      return property;
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
      let value = debugValueLookup[id].expandableValue;

      if (Array.isArray(value)) {
        let newValue = {};
        value.forEach((value, index) => {
          newValue[index] = value;
        });
        value = newValue;
      } else if (isMap(value)) {
        let mapToArr = [];
        value = value.forEach((value, key) => {
          mapToArr.push([value, key]);
        });
        value = mapToArr;
      } else if (isSet(value)) {
        value = Array.from(value);
      }

      const converted = convertObjectToDebugInfo(value);
      return converted;

      // https://stackoverflow.com/questions/29924932/how-to-reliably-check-an-object-is-an-ecmascript-6-map-set
      function isMap(o) {
        try {
          Map.prototype.has.call(o); // throws if o is not an object or has no [[MapData]]
          return true;
        } catch (e) {
          return false;
        }
      }
      function isSet(o) {
        try {
          Set.prototype.has.call(o); // throws if o is not an object or has no [[SetData]]
          return true;
        } catch (e) {
          return false;
        }
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
  };

  return { hooks, debugValueLookup };

  function extractControllerInfo(controller) {
    if (!controller) return null;

    try {
      // Handle Aurelia v2 (both custom elements and custom attributes)
      if (controller.definition && controller.viewModel) {
        const bindableKeys = Object.keys(controller.definition.bindables || {});
        return {
          bindables: bindableKeys.map((y) => {
            return setValueOnDebugInfo(
              { name: y },
              controller.viewModel[y],
              controller.viewModel,
            );
          }),
          properties: Object.keys(controller.viewModel)
            .filter((x) => !bindableKeys.some((y) => y === x))
            .filter((x) => !x.startsWith("$"))
            .map((y) => {
              return setValueOnDebugInfo(
                { name: y },
                controller.viewModel[y],
                controller.viewModel,
              );
            }),
          name: controller.definition.name,
          aliases: controller.definition.aliases || [],
          key: controller.definition.key,
        };
      }
      // Handle Aurelia v1 (both custom elements and custom attributes)
      else if (controller.behavior && controller.viewModel) {
        const behavior = controller.behavior;
        const viewModel = controller.viewModel;
        const bindableProperties = behavior.properties || [];
        const bindableKeys = bindableProperties.map(prop => prop.name);

        return {
          bindables: bindableProperties.map((prop) => {
            return setValueOnDebugInfo(
              { name: prop.name, attribute: prop.attribute },
              viewModel[prop.name],
              viewModel,
            );
          }),
          properties: Object.keys(viewModel)
            .filter((x) => !bindableKeys.some((y) => y === x))
            .filter((x) => !x.startsWith("$") && !denyListProps.includes(x))
            .map((y) => {
              return setValueOnDebugInfo(
                { name: y },
                viewModel[y],
                viewModel,
              );
            }),
          name: behavior.elementName || behavior.attributeName,
          aliases: [],
          key: behavior.elementName || behavior.attributeName,
        };
      }
      // Handle edge cases where controller has different structure
      else if (controller.viewModel || controller.bindingContext) {
        const viewModel = controller.viewModel || controller.bindingContext;
        const name = controller.name || controller.constructor?.name || 'unknown';
        
        return {
          bindables: [],
          properties: Object.keys(viewModel)
            .filter((x) => !x.startsWith("$") && !denyListProps.includes(x))
            .map((y) => {
              return setValueOnDebugInfo(
                { name: y },
                viewModel[y],
                viewModel,
              );
            }),
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

  function setValueOnDebugInfo(debugInfo, value, instance) {
    try {
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
      } else if (debugInfo.type === "object") {
        debugInfo.canExpand = true;
        expandableValue = value;

        if (value.constructor) {
          debugInfo.value = value.constructor.name;
        } else {
          debugInfo.value = "Object";
        }
      }

      if (
        debugInfo.type === "string" ||
        debugInfo.type === "number" ||
        debugInfo.type === "boolean"
      ) {
        debugInfo.canEdit = true;
      }

      debugInfo.debugId = debugInfo.debugId || getNextDebugId();

      debugValueLookup[debugInfo.debugId] = Object.assign(
        {
          instance: instance,
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

  function convertObjectToDebugInfo(obj, blackList) {
    blackList = blackList || {};
    return {
      properties: getDebugPropertyKeys(obj)
        .filter((x) => !(x in blackList))
        .map((x) => {
          return setValueOnDebugInfo(
            {
              name: x,
            },
            obj[x],
            obj
          );
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

    const keys = [...Object.keys(obj), ...Object.getOwnPropertyNames(obj)];
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
  var globalDebugValueLookup;
  var installedData = (${install.toString()})(globalDebugValueLookup)
  var {hooks} = installedData;
  window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__ = hooks;
  globalDebugValueLookup = installedData.debugValueLookup;
  `;

chrome.runtime.onConnect.addListener((port) => {
  chrome.devtools.inspectedWindow.eval(hooksAsStringv2);
});
