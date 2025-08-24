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
      chrome.devtools.network.onNavigated.addListener(() => {
        this.getAllComponents().then((debugObject) => {
          this.consumer.allAureliaObjects = debugObject || [];
          this.consumer.buildComponentTree(debugObject || []);
        });
      });

      chrome.devtools.panels.elements.onSelectionChanged.addListener(() => {
        // Respect consumer preference for following Elements selection
        if (this.consumer && (this.consumer as any).followChromeSelection === false) {
          return;
        }
        chrome.devtools.inspectedWindow.eval(
          `window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__ && window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__.getCustomElementInfo($0)`,
          (debugObject: AureliaInfo) => {
            if (!debugObject) return;
            // Sync the selection in our panel/component tree
            if (this.consumer && typeof this.consumer.onElementPicked === 'function') {
              this.consumer.onElementPicked(debugObject);
            } else {
              // Fallback: update basic fields
              this.consumer.selectedElement = debugObject?.customElementInfo;
              this.consumer.selectedElementAttributes = debugObject?.customAttributesInfo;
            }
          }
        );
      });

      // Initial load of components - add delay to let Aurelia initialize
      setTimeout(() => {
        this.getAllComponents().then((debugObject) => {
          this.consumer.allAureliaObjects = debugObject || [];
          this.consumer.buildComponentTree(debugObject || []);
        });
      }, 1000);
    }
  }


  updateValues(
    value: IControllerInfo,
    property?: Property
  ) {
    chrome.devtools.inspectedWindow.eval(
      `window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__.updateValues(${JSON.stringify(
        value
      )}, ${JSON.stringify(property)})`
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
            if (!debugObject || debugObject.length === 0) {
              setTimeout(() => {
                chrome.devtools.inspectedWindow.eval(
                  getComponentsCode,
                  (second: AureliaInfo[]) => {
                    if (!second || second.length === 0) {
                      const fallbackScan = `
                        (function(){
                          try {
                            const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
                            if (!hook || !hook.getCustomElementInfo) return [];
                            const results = [];
                            const seen = new Set();
                            const els = document.querySelectorAll('*');
                            for (const el of els) {
                              try {
                                const info = hook.getCustomElementInfo(el, false);
                                if (info && (info.customElementInfo || (info.customAttributesInfo && info.customAttributesInfo.length))) {
                                  const key = info.customElementInfo?.key || info.customElementInfo?.name || (info.customAttributesInfo && info.customAttributesInfo.map(a=>a?.key||a?.name).join('|')) || Math.random().toString(36).slice(2);
                                  if (!seen.has(key)) {
                                    seen.add(key);
                                    results.push(info);
                                  }
                                }
                              } catch {}
                            }
                            return results;
                          } catch { return []; }
                        })();
                      `;
                      chrome.devtools.inspectedWindow.eval(
                        fallbackScan,
                        (fallback: AureliaInfo[]) => resolve(fallback || [])
                      );
                    } else {
                      resolve(second || []);
                    }
                  }
                );
              }, 250);
            } else {
              resolve(debugObject || []);
            }
          }
        );
      } else {
        resolve([]);
      }
    });
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

  // Reveal a component's DOM element in the Elements panel
  revealInElements(componentInfo: any) {
    if (chrome && chrome.devtools) {
      const code = `(() => {
        try {
          const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
          if (!hook || !hook.findElementByComponentInfo) return false;
          const el = hook.findElementByComponentInfo(${JSON.stringify(componentInfo)});
          if (el) {
            // Built-in DevTools helper to select and reveal an element
            // eslint-disable-next-line no-undef
            inspect(el);
            return true;
          }
          return false;
        } catch { return false; }
      })();`;
      chrome.devtools.inspectedWindow.eval(code);
    }
  }
}
