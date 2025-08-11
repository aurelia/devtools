import { AureliaInfo, IControllerInfo, Property } from '../shared/types';
import { App } from './../app';
import { ICustomElementViewModel } from 'aurelia';

declare let aureliaDebugger;

export class SelectionChanged {
  constructor(public debugInfo: IControllerInfo) {}
}

export class DebugHost implements ICustomElementViewModel {
  consumer: App;
  private pickerPollingInterval: number | null = null;

  attach(consumer: App) {
    this.consumer = consumer;
    if (chrome && chrome.devtools) {
      // Force installation of hooks first
      this.ensureHooksInstalled().then(() => {

        chrome.devtools.network.onNavigated.addListener(() => {
          this.getAllComponents().then((debugObject) => {
            this.consumer.allAureliaObjects = debugObject || [];
            this.consumer.buildComponentTree(debugObject || []);
          });
        });

        chrome.devtools.panels.elements.onSelectionChanged.addListener(() => {
          this.ensureHooksInstalled().then(() => {
            chrome.devtools.inspectedWindow.eval(
              `window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__.getCustomElementInfo($0)`,
              (debugObject: AureliaInfo) => {
                this.consumer.selectedElement = debugObject?.customElementInfo;
                this.consumer.selectedElementAttributes =
                  debugObject?.customAttributesInfo;
              }
            );
          });
        });

        // Initial load of components - add delay to let Aurelia initialize
        setTimeout(() => {
          this.getAllComponents().then((debugObject) => {
            this.consumer.allAureliaObjects = debugObject || [];
            this.consumer.buildComponentTree(debugObject || []);
          });
        }, 1000);
      });
    }
  }

  private ensureHooksInstalled(): Promise<void> {
    return new Promise((resolve) => {
      // Force fresh installation to ensure latest code
      const hooksAsStringv2 = `
        // Preserve detection state before deleting hooks
        const preservedDetectionState = window.__AURELIA_DEVTOOLS_DETECTION_STATE__;
        const preservedVersion = window.__AURELIA_DEVTOOLS_VERSION__;
        const preservedDetectedVersion = window.__AURELIA_DEVTOOLS_DETECTED_VERSION__;
        
        delete window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;

        var globalDebugValueLookup;
        var installedData = (function install(debugValueLookup) {
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
            updateValues: (info, property) => {
              if (property && property.debugId && debugValueLookup[property.debugId]) {
                const debugItem = debugValueLookup[property.debugId];
                const instance = debugItem.instance;
                const propertyName = property.name;


                if (instance && propertyName && instance.hasOwnProperty(propertyName)) {
                  try {
                    const oldValue = instance[propertyName];
                    instance[propertyName] = property.value;

                    // Trigger Aurelia 2 change detection
                    try {
                      // Method 1: Find the DOM element and trigger proper change detection
                      const elements = document.querySelectorAll('*');
                      for (const element of elements) {
                        const au = element['$au'];
                        if (au) {
                          const customElement = au['au:resource:custom-element'];
                          if (customElement && customElement.viewModel === instance) {

                            // Method 1: Try to notify through observable system
                            try {
                              // Check if the instance has an observable system we can notify
                              if (instance['$observers']) {
                                const observer = instance['$observers'][propertyName];
                                if (observer && observer.notifySubscribers) {
                                  observer.notifySubscribers(property.value, oldValue);
                                }
                              }

                              // Check for Aurelia 2 style observers
                              if (instance['__observers__']) {
                                const observer = instance['__observers__'][propertyName];
                                if (observer && observer.setValue) {
                                  observer.setValue(property.value);
                                }
                              }
                            } catch (observerError) {
                              // Continue to other methods if observer approach fails
                            }

                            // Method 2: Try to trigger change detection through controller
                            if (customElement.controller && customElement.controller.container) {
                              try {
                                // Get the platform and observation locator if available
                                const platform = customElement.controller.container.get('IPlatform');
                                const observationLocator = customElement.controller.container.get('IObservationLocator', true);
                                
                                if (platform) {
                                  platform.queueMicrotask(() => {
                                    // Method 2a: Try to get the property accessor and trigger change
                                    if (observationLocator) {
                                      try {
                                        const accessor = observationLocator.getAccessor(instance, propertyName);
                                        if (accessor && accessor.setValue) {
                                          accessor.setValue(property.value, instance, propertyName);
                                        } else if (accessor && accessor.notifySubscribers) {
                                          accessor.notifySubscribers(property.value, oldValue);
                                        }
                                      } catch (accessorError) {
                                        // Continue if accessor approach fails
                                      }
                                    }

                                    // Method 2b: Force binding updates on related bindings
                                    if (customElement.bindings) {
                                      customElement.bindings.forEach(binding => {
                                        try {
                                          // Check if binding is related to our property
                                          if (binding.sourceExpression && 
                                              (binding.sourceExpression.name === propertyName || 
                                               binding.sourceExpression.toString().includes(propertyName))) {
                                            if (binding.updateTarget) {
                                              binding.updateTarget(property.value);
                                            } else if (binding.callBinding) {
                                              binding.callBinding();
                                            }
                                          }
                                        } catch (bindingError) {
                                          // Continue on binding errors
                                        }
                                      });
                                    }
                                  });
                                }
                              } catch (containerError) {
                                // Continue if container approach fails
                              }
                            }

                            // Method 3: Force DOM update and dispatch change event
                            Promise.resolve().then(() => {
                              // Dispatch property change event for any listeners
                              element.dispatchEvent(new CustomEvent('aurelia:property-changed', {
                                detail: { property: propertyName, oldValue, newValue: property.value },
                                bubbles: true
                              }));

                              // Also dispatch a generic change event
                              element.dispatchEvent(new Event('change', { bubbles: true }));
                              
                              // Force form control updates if any
                              const formControls = element.querySelectorAll('input, select, textarea');
                              formControls.forEach(control => {
                                if (control.value !== undefined) {
                                  control.dispatchEvent(new Event('input', { bubbles: true }));
                                  control.dispatchEvent(new Event('change', { bubbles: true }));
                                }
                              });
                            });

                            break;
                          }
                        }
                      }
                    } catch (triggerError) {
                      console.warn('Could not trigger Aurelia 2 change detection:', triggerError);
                    }

                    return true;
                  } catch (error) {
                    console.error('Failed to update property:', error);
                    return false;
                  }
                } else {
                  console.warn('Property not found on instance:', propertyName, instance);
                  return false;
                }
              } else {
                console.warn('Invalid property or missing debugId:', property);
                return false;
              }
            },
            getExpandedDebugValueForId(id) {
              let value = debugValueLookup[id].expandableValue;
              const converted = convertObjectToDebugInfo(value);
              return converted;
            }
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

          function setValueOnDebugInfo(debugInfo, value, instance) {
            try {
              let expandableValue;
              if (Array.isArray(value)) {
                debugInfo.canExpand = true;
                debugInfo.type = "array";
                debugInfo.value = \`Array[\${value.length}]\`;
                expandableValue = value;
              } else if (typeof value === 'function') {
                debugInfo.type = "function";
                debugInfo.value = value.name ? value.name + '()' : 'anonymous()';
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
                debugInfo.value = value.constructor ? value.constructor.name : "Object";
              }

              if (["string", "number", "boolean"].includes(debugInfo.type)) {
                debugInfo.canEdit = true;
              }

              debugInfo.debugId = debugInfo.debugId || getNextDebugId();
              debugValueLookup[debugInfo.debugId] = Object.assign(
                { instance: instance, expandableValue: expandableValue },
                debugInfo,
              );
              return debugInfo;
            } catch (e) {
              return { name: "Error", value: e.message, type: "string", canEdit: false };
            }
          }

          function getNextDebugId() {
            return ++nextDebugId;
          }

          function convertObjectToDebugInfo(obj) {
            return {
              properties: Object.keys(obj || {}).map((x) => {
                return setValueOnDebugInfo({ name: x }, obj[x], obj);
              }),
            };
          }
        })(globalDebugValueLookup);
        var {hooks} = installedData;
        window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__ = hooks;
        globalDebugValueLookup = installedData.debugValueLookup;
        
        // Restore preserved detection state after hook installation
        if (preservedDetectionState) {
          window.__AURELIA_DEVTOOLS_DETECTION_STATE__ = preservedDetectionState;
        }
        if (preservedVersion) {
          window.__AURELIA_DEVTOOLS_VERSION__ = preservedVersion;
        }
        if (preservedDetectedVersion) {
          window.__AURELIA_DEVTOOLS_DETECTED_VERSION__ = preservedDetectedVersion;
        }
      `;

      chrome.devtools.inspectedWindow.eval(
        hooksAsStringv2,
        (result, isException) => {
          if (isException) {
            // Silent fail - don't log the error to avoid Chrome Store issues
          }
          resolve();
        }
      );
    });
  }

  private retryHookInstallation(): Promise<void> {
    return new Promise((resolve) => {
      resolve(); // Just resolve to prevent blocking
    });
  }

  updateValues(
    value: IControllerInfo,
    property?: Property
  ) {
    chrome.devtools.inspectedWindow.eval(
      `window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__.updateValues(${JSON.stringify(
        value
      )}, ${JSON.stringify(property)})`,
      (debugObject: AureliaInfo) => {
        // this.consumer.selectedElement = debugObject;
      }
    );
  }

  updateDebugValue(debugInfo: Property) {
    let value = debugInfo.value;

    if (debugInfo.type === 'string') {
      value = "'" + value + "'";
    }

    let code = `aureliaDebugger.updateValueForId(${debugInfo.debugId}, ${value})`;
    chrome.devtools.inspectedWindow.eval(code);
  }

  toggleDebugValueExpansion(debugInfo: Property) {
    if (debugInfo.canExpand) {
      debugInfo.isExpanded = !debugInfo.isExpanded;

      if (debugInfo.isExpanded && !debugInfo.expandedValue) {
        let code = `window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__.getExpandedDebugValueForId(${debugInfo.debugId});`;
        chrome.devtools.inspectedWindow.eval(
          code,
          (expandedValue: IControllerInfo) => {
            debugInfo.expandedValue = expandedValue;
            debugInfo.isExpanded = true;
          }
        );
      }
    }
  }

  getAllComponents(): Promise<AureliaInfo[]> {
    return new Promise((resolve) => {
      if (chrome && chrome.devtools) {
        // First ensure hooks are installed, then get components
        this.ensureHooksInstalled()
          .then(() => {
            const getComponentsCode = `
            (() => {
              if (window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__ && window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__.getAllInfo) {
                try {
                  return window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__.getAllInfo();
                } catch (error) {
                  return [];
                }
              } else {
                return [];
              }
            })();
          `;

            chrome.devtools.inspectedWindow.eval(
              getComponentsCode,
              (debugObject: AureliaInfo[]) => {
                resolve(debugObject || []);
              }
            );
          })
          .catch((error) => {
            console.error('Failed to install hooks:', error);
            resolve([]);
          });
      } else {
        resolve([]);
      }
    });
  }

  private getHooksInstallationCode(): string {
    // Get the hooks installation code from devtools.js
    return `
      var globalDebugValueLookup;
      var installedData = (${this.getInstallFunction()})(globalDebugValueLookup)
      var {hooks} = installedData;
      window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__ = hooks;
      globalDebugValueLookup = installedData.debugValueLookup;
    `;
  }

  private getInstallFunction(): string {
    // Return the install function as a string with unified v1/v2 support
    return `function install(debugValueLookup) {
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

      // Detect Aurelia version
      const aureliaVersion = window.__AURELIA_DEVTOOLS_VERSION__ || window.__AURELIA_DEVTOOLS_DETECTED_VERSION__ || 2;

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
        getCustomElementInfo: (element, traverse = true) => {
          if (aureliaVersion === 1) {
            return hooks.getCustomElementInfoV1(element, traverse);
          } else {
            return hooks.getCustomElementInfoV2(element, traverse);
          }
        },

        // Aurelia v2 implementation (existing)
        getCustomElementInfoV2: (element, traverse = true) => {
          let customElement;
          let customAttributes;

          try {
            while (!customElement && element !== document.body) {
              if (!element) return;
              const au = element["$au"];
              if (au) {
                customElement = element["$au"]["au:resource:custom-element"];
                const customAttributeKeys = Object.getOwnPropertyNames(au).filter(
                  (y) => y.includes("custom-attribute"),
                );
                customAttributes = customAttributeKeys.map((x) => au[x]);
              }
              element = element.parentElement;
              if (!traverse) break;
            }
          } catch (e) {
            // Silent error handling
          }

          if (!customElement && !customAttributes) return;

          hooks.currentElement = customElement;
          hooks.currentAttributes = customAttributes;

          const customElementInfo = extractControllerInfoV2(customElement);
          const customAttributesInfo =
            customAttributes &&
            customAttributes.map(extractControllerInfoV2).filter((x) => x);
          return {
            customElementInfo,
            customAttributesInfo,
          };
        },

        // Aurelia v1 implementation (new)
        getCustomElementInfoV1: (element, traverse = true) => {
          let customElement;
          let customAttributes = [];

          try {
            while (!customElement && element !== document.body) {
              if (!element) return;
              const au = element.au;
              if (au) {
                // In v1, custom element controller is stored as au.controller
                if (au.controller) {
                  customElement = au.controller;
                }

                // Custom attributes are stored directly on au object
                const tagName = element.tagName ? element.tagName.toLowerCase() : null;
                Object.keys(au).forEach(key => {
                  if (key !== 'controller' && key !== tagName && au[key] && au[key].behavior) {
                    customAttributes.push(au[key]);
                  }
                });
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

          const customElementInfo = customElement ? extractControllerInfoV1(customElement) : null;
          const customAttributesInfo = customAttributes.length > 0 ?
            customAttributes.map(extractControllerInfoV1).filter((x) => x) : [];

          return {
            customElementInfo,
            customAttributesInfo,
          };
        },
        updateValues: (controllerInfo, property) => {
          if (property && property.debugId && debugValueLookup[property.debugId]) {
            const debugItem = debugValueLookup[property.debugId];
            const instance = debugItem.instance;
            const propertyName = property.name;


            if (instance && propertyName && instance.hasOwnProperty(propertyName)) {
              try {
                const oldValue = instance[propertyName];
                instance[propertyName] = property.value;

                // Try to trigger Aurelia 2 change detection
                // Method 1: Try to find the controller and trigger update
                try {
                  // Look for the controller in the DOM element
                  const elements = document.querySelectorAll('*');
                  for (const element of elements) {
                    const au = element['$au'];
                    if (au) {
                      const customElement = au['au:resource:custom-element'];
                      if (customElement && customElement.viewModel === instance) {

                        // Try to trigger binding update by dispatching a custom event
                        element.dispatchEvent(new CustomEvent('aurelia:property-changed', {
                          detail: { property: propertyName, oldValue, newValue: property.value }
                        }));

                        // Also try to trigger binding update on the controller if available
                        if (customElement.bindingContext) {
                        }

                        // Force a micro-task to allow Aurelia to process changes
                        Promise.resolve().then(() => {
                        });

                        break;
                      }
                    }
                  }
                } catch (triggerError) {
                  console.warn('Could not trigger Aurelia change detection:', triggerError);
                }

                return true;
              } catch (error) {
                console.error('Failed to update property:', error);
                return false;
              }
            } else {
              console.warn('Property not found on instance:', propertyName, instance);
              return false;
            }
          }
          return false;
        },
        getExpandedDebugValueForId: (debugId) => {
          const debugItem = debugValueLookup[debugId];
          if (debugItem && debugItem.expandableValue) {
            const expandableValue = debugItem.expandableValue;
            const properties = [];

            try {
              if (Array.isArray(expandableValue)) {
                expandableValue.forEach((item, index) => {
                  properties.push(setValueOnDebugInfo({
                    name: index.toString()
                  }, item, expandableValue));
                });
              } else if (typeof expandableValue === 'object' && expandableValue !== null) {
                Object.keys(expandableValue).forEach(key => {
                  if (!denyListProps.includes(key)) {
                    properties.push(setValueOnDebugInfo({
                      name: key
                    }, expandableValue[key], expandableValue));
                  }
                });
              }
            } catch (error) {
              console.error('Error expanding debug value:', error);
            }

            return { properties };
          }
          return { properties: [] };
        }
      };

      return { hooks, debugValueLookup };

      function extractControllerInfoV2(customElement) {
        if (!customElement) return;
        const bindableKeys = Object.keys(customElement.definition.bindables);
        const returnVal = {
          bindables: bindableKeys.map((y) => {
            return setValueOnDebugInfo(
              {
                name: y,
              },
              customElement.viewModel[y],
              customElement.viewModel,
            );
          }),
          properties: Object.keys(customElement.viewModel)
            .filter((x) => !bindableKeys.some((y) => y === x))
            .filter((x) => !x.startsWith("$"))
            .map((y) => {
              return setValueOnDebugInfo(
                {
                  name: y,
                },
                customElement.viewModel[y],
                customElement.viewModel,
              );
            }),
          name: customElement.definition.name,
          aliases: customElement.definition.aliases,
          key: customElement.definition.key,
        };
        return returnVal;
      }

      function extractControllerInfoV1(controller) {
        if (!controller) return;

        // Aurelia v1 structure
        const behavior = controller.behavior;
        const viewModel = controller.viewModel;

        if (!behavior || !viewModel) return;

        // Get bindable properties from behavior.properties
        const bindableProperties = behavior.properties || [];
        const bindableKeys = bindableProperties.map(prop => prop.name);

        const returnVal = {
          bindables: bindableProperties.map((prop) => {
            return setValueOnDebugInfo(
              {
                name: prop.name,
                attribute: prop.attribute, // v1 has attribute property
              },
              viewModel[prop.name],
              viewModel,
            );
          }),
          properties: Object.keys(viewModel)
            .filter((x) => !bindableKeys.some((y) => y === x))
            .filter((x) => !x.startsWith("$") && !denyListProps.includes(x))
            .map((y) => {
              return setValueOnDebugInfo(
                {
                  name: y,
                },
                viewModel[y],
                viewModel,
              );
            }),
          name: behavior.elementName || behavior.attributeName,
          aliases: [], // v1 doesn't have aliases concept
          key: behavior.elementName || behavior.attributeName, // Use name as key
        };
        return returnVal;
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
            debugInfo.value = \`Array[\${value.length}]\`;
            expandableValue = value;
          } else if (typeof value === 'function') {
            debugInfo.type = "function";
            debugInfo.value = value.name ? value.name + '()' : 'anonymous()';
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
            debugInfo,
          );

          return debugInfo;
        } catch (e) {
          return createErrorObject(e);
        }
      }

      function getNextDebugId() {
        return ++nextDebugId;
      }

      function createErrorObject(e) {
        return [
          {
            name: "Debugger Error",
            value: e.message,
            type: "string",
            canEdit: false,
          },
        ];
      }
    }`;
  }

  // Component highlighting functionality
  highlightComponent(componentInfo: any) {
    if (chrome && chrome.devtools) {
      const highlightCode = `
        (() => {
          // Remove existing highlights
          document.querySelectorAll('.aurelia-devtools-highlight').forEach(el => {
            el.classList.remove('aurelia-devtools-highlight');
          });

          // Add CSS for highlighting if not exists
          if (!document.getElementById('aurelia-devtools-styles')) {
            const style = document.createElement('style');
            style.id = 'aurelia-devtools-styles';
            style.textContent = \`
              .aurelia-devtools-highlight {
                outline: 2px solid #1967d2 !important;
                outline-offset: -2px !important;
                background-color: rgba(25, 103, 210, 0.1) !important;
                box-shadow: inset 0 0 0 2px rgba(25, 103, 210, 0.3) !important;
                position: relative !important;
              }
              .aurelia-devtools-highlight::after {
                content: '${componentInfo.name || 'component'}';
                position: absolute !important;
                top: -20px !important;
                left: 0 !important;
                background: #1967d2 !important;
                color: white !important;
                padding: 2px 6px !important;
                font-size: 11px !important;
                font-family: monospace !important;
                border-radius: 2px !important;
                z-index: 10000 !important;
                pointer-events: none !important;
                white-space: nowrap !important;
              }
            \`;
            document.head.appendChild(style);
          }

          // Find and highlight the element
          const aureliaHook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
          if (aureliaHook && aureliaHook.findElementByComponentInfo) {
            const element = aureliaHook.findElementByComponentInfo(${JSON.stringify(
              componentInfo
            )});
            if (element) {
              element.classList.add('aurelia-devtools-highlight');
              return true;
            }
          }
          return false;
        })();
      `;

      chrome.devtools.inspectedWindow.eval(highlightCode);
    }
  }

  unhighlightComponent() {
    if (chrome && chrome.devtools) {
      const unhighlightCode = `
        document.querySelectorAll('.aurelia-devtools-highlight').forEach(el => {
          el.classList.remove('aurelia-devtools-highlight');
        });
      `;

      chrome.devtools.inspectedWindow.eval(unhighlightCode);
    }
  }

  // Element picker functionality
  startElementPicker() {
    if (chrome && chrome.devtools) {
      // Start polling for picked components
      this.startPickerPolling();

      const pickerCode = `
        (() => {
          // Remove existing picker if any
          window.__aureliaDevtoolsStopPicker && window.__aureliaDevtoolsStopPicker();

          let isPickerActive = true;
          let currentHighlight = null;

          // Add picker styles
          if (!document.getElementById('aurelia-picker-styles')) {
            const style = document.createElement('style');
            style.id = 'aurelia-picker-styles';
            style.textContent = \`
              .aurelia-picker-highlight {
                outline: 2px solid #ff6b35 !important;
                outline-offset: -2px !important;
                background-color: rgba(255, 107, 53, 0.1) !important;
                box-shadow: inset 0 0 0 2px rgba(255, 107, 53, 0.3) !important;
                cursor: crosshair !important;
                position: relative !important;
              }
              .aurelia-picker-highlight::after {
                content: 'Click to select';
                position: absolute !important;
                top: -20px !important;
                left: 0 !important;
                background: #ff6b35 !important;
                color: white !important;
                padding: 2px 6px !important;
                font-size: 11px !important;
                font-family: monospace !important;
                border-radius: 2px !important;
                z-index: 10000 !important;
                pointer-events: none !important;
                white-space: nowrap !important;
              }
              * {
                cursor: crosshair !important;
              }
            \`;
            document.head.appendChild(style);
          }

          function highlightElement(element) {
            if (currentHighlight) {
              currentHighlight.classList.remove('aurelia-picker-highlight');
            }
            element.classList.add('aurelia-picker-highlight');
            currentHighlight = element;
          }

          function unhighlightElement() {
            if (currentHighlight) {
              currentHighlight.classList.remove('aurelia-picker-highlight');
              currentHighlight = null;
            }
          }

          function onMouseOver(event) {
            if (!isPickerActive) return;
            event.stopPropagation();
            highlightElement(event.target);
          }

          function onMouseOut(event) {
            if (!isPickerActive) return;
            event.stopPropagation();
            unhighlightElement();
          }

          function onClick(event) {
            if (!isPickerActive) return;
            event.preventDefault();
            event.stopPropagation();

            const aureliaHook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
            if (aureliaHook) {
              const componentInfo = aureliaHook.getCustomElementInfo(event.target, true);

              if (componentInfo) {
                // Store the picked component info in a global variable that DevTools can access
                window.__AURELIA_DEVTOOLS_PICKED_COMPONENT__ = componentInfo;
              } else {
                window.__AURELIA_DEVTOOLS_PICKED_COMPONENT__ = null;
              }
            }

            // Stop picker
            window.__aureliaDevtoolsStopPicker();
          }

          // Add event listeners
          document.addEventListener('mouseover', onMouseOver, true);
          document.addEventListener('mouseout', onMouseOut, true);
          document.addEventListener('click', onClick, true);

          // Store stop function
          window.__aureliaDevtoolsStopPicker = function() {
            isPickerActive = false;
            unhighlightElement();
            document.removeEventListener('mouseover', onMouseOver, true);
            document.removeEventListener('mouseout', onMouseOut, true);
            document.removeEventListener('click', onClick, true);

            // Remove styles
            const pickerStyles = document.getElementById('aurelia-picker-styles');
            if (pickerStyles) {
              pickerStyles.remove();
            }

            delete window.__aureliaDevtoolsStopPicker;
          };

          return true;
        })();
      `;

      chrome.devtools.inspectedWindow.eval(pickerCode);
    }
  }

  stopElementPicker() {
    if (chrome && chrome.devtools) {
      // Stop polling
      this.stopPickerPolling();

      const stopPickerCode = `
        window.__aureliaDevtoolsStopPicker && window.__aureliaDevtoolsStopPicker();
      `;

      chrome.devtools.inspectedWindow.eval(stopPickerCode);
    }
  }

  private startPickerPolling() {
    // Stop any existing polling
    this.stopPickerPolling();

    // Start polling for picked components
    this.pickerPollingInterval = setInterval(() => {
      this.checkForPickedComponent();
    }, 100) as any;
  }

  private stopPickerPolling() {
    if (this.pickerPollingInterval) {
      clearInterval(this.pickerPollingInterval);
      this.pickerPollingInterval = null;
    }
  }

  private checkForPickedComponent() {
    if (chrome && chrome.devtools) {
      const checkCode = `
        (() => {
          const picked = window.__AURELIA_DEVTOOLS_PICKED_COMPONENT__;
          if (picked) {
            // Clear the picked component
            window.__AURELIA_DEVTOOLS_PICKED_COMPONENT__ = null;
            return picked;
          }
          return null;
        })();
      `;

      chrome.devtools.inspectedWindow.eval(
        checkCode,
        (componentInfo: AureliaInfo) => {
          if (componentInfo) {
            this.stopPickerPolling(); // Stop polling when we get a component
            this.consumer.onElementPicked(componentInfo);
          }
        }
      );
    }
  }
}
