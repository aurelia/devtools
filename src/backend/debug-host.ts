import { AureliaComponentSnapshot, AureliaInfo, ComputedPropertyInfo, DISnapshot, EventInteractionRecord, ExternalPanelSnapshot, IControllerInfo, InteractionPhase, LifecycleHooksSnapshot, Property, PropertyChangeRecord, PropertySnapshot, RouteSnapshot, SlotSnapshot, WatchOptions } from '../shared/types';
import { App } from './../app';
import { ICustomElementViewModel } from 'aurelia';

declare let aureliaDebugger;

export class SelectionChanged {
  constructor(public debugInfo: IControllerInfo) {}
}

export class DebugHost implements ICustomElementViewModel {
  consumer: App;
  private pickerPollingInterval: number | null = null;
  private propertyWatchInterval: number | null = null;
  private lastPropertySnapshot: PropertySnapshot | null = null;
  private watchingComponentKey: string | null = null;
  private componentTreeSignature: string = '';

  attach(consumer: App) {
    this.consumer = consumer;
    if (chrome && chrome.devtools) {
      chrome.devtools.network.onNavigated.addListener(() => {
        this.getAllComponents().then((snapshot) => {
          this.consumer.handleComponentSnapshot(snapshot || { tree: [], flat: [] });
        });
      });

      chrome.devtools.panels.elements.onSelectionChanged.addListener(() => {
        // Respect consumer preference for following Elements selection
        if (this.consumer && (this.consumer as any).followChromeSelection === false) {
          return;
        }
        const selectionEval = `
          (function() {
            const target = typeof $0 !== 'undefined' ? $0 : null;
            const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
            if (!hook || !hook.getCustomElementInfo || !target) {
              return null;
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

                segments.push(tag + ':nth-of-type(' + index + ')');
                current = current.parentElement;
              }

              segments.push('html');
              return segments.reverse().join(' > ');
            }

            const info = hook.getCustomElementInfo(target);
            if (!info) {
              return null;
            }

            let hostElement = null;
            if (typeof hook.findElementByComponentInfo === 'function') {
              try {
                hostElement = hook.findElementByComponentInfo(info) || null;
              } catch (err) {
                hostElement = null;
              }
            }

            if (!hostElement) {
              if (target.nodeType === 1) {
                hostElement = target;
              } else if (target.parentElement) {
                hostElement = target.parentElement;
              }
            }

            if (hostElement) {
              const domPath = getDomPath(hostElement);
              if (domPath) {
                info.__auDevtoolsDomPath = domPath;
                if (info.customElementInfo) {
                  info.customElementInfo.__auDevtoolsDomPath = domPath;
                }
                if (Array.isArray(info.customAttributesInfo)) {
                  info.customAttributesInfo.forEach(function(attr) {
                    if (attr) {
                      attr.__auDevtoolsDomPath = domPath;
                    }
                  });
                }
              }
            }

            return info;
          })();
        `;
        chrome.devtools.inspectedWindow.eval(
          selectionEval,
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
        this.getAllComponents().then((snapshot) => {
          this.consumer.handleComponentSnapshot(snapshot || { tree: [], flat: [] });
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

  getAllComponents(): Promise<AureliaComponentSnapshot> {
    return new Promise((resolve) => {
      if (chrome && chrome.devtools) {
        const getComponentsCode = `
          (() => {
            const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
            if (!hook) {
              return { kind: 'empty', data: [] };
            }

            try {
              if (hook.getComponentTree) {
                const tree = hook.getComponentTree() || [];
                return { kind: 'tree', data: tree };
              }

              if (hook.getAllInfo) {
                const flat = hook.getAllInfo() || [];
                return { kind: 'flat', data: flat };
              }

              return { kind: 'empty', data: [] };
            } catch (error) {
              return { kind: 'error', data: [] };
            }
          })();
        `;

        chrome.devtools.inspectedWindow.eval(
          getComponentsCode,
          (result: { kind: string; data: any }) => {
            if (!result) {
              resolve({ tree: [], flat: [] });
              return;
            }

            if (result.kind === 'tree') {
              resolve({ tree: Array.isArray(result.data) ? result.data : [], flat: [] });
              return;
            }

            if (result.kind === 'flat') {
              const flatData = Array.isArray(result.data) ? result.data : [];
              resolve({ tree: [], flat: flatData });
              return;
            }

            if (!result.data || result.data.length === 0) {
              setTimeout(() => {
                chrome.devtools.inspectedWindow.eval(
                  getComponentsCode,
                  (second: { kind: string; data: any }) => {
                    if (!second || !Array.isArray(second.data) || second.data.length === 0) {
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
                            return { kind: 'flat', data: results };
                          } catch { return { kind: 'flat', data: [] }; }
                        })();
                      `;
                      chrome.devtools.inspectedWindow.eval(
                        fallbackScan,
                        (fallback: { kind: string; data: any }) => {
                          if (fallback && fallback.kind === 'tree') {
                            resolve({ tree: Array.isArray(fallback.data) ? fallback.data : [], flat: [] });
                          } else {
                            const fallbackFlat = fallback && Array.isArray(fallback.data) ? fallback.data : [];
                            resolve({ tree: [], flat: fallbackFlat });
                          }
                        }
                      );
                    } else {
                      if (second.kind === 'tree') {
                        resolve({ tree: Array.isArray(second.data) ? second.data : [], flat: [] });
                      } else {
                        const secondFlat = Array.isArray(second.data) ? second.data : [];
                        resolve({ tree: [], flat: secondFlat });
                      }
                    }
                  }
                );
              }, 250);
            } else {
              if (result.kind === 'tree') {
                resolve({ tree: Array.isArray(result.data) ? result.data : [], flat: [] });
              } else {
                const fallbackFlat = Array.isArray(result.data) ? result.data : [];
                resolve({ tree: [], flat: fallbackFlat });
              }
            }
          }
        );
      } else {
        resolve({ tree: [], flat: [] });
      }
    });
  }

  getExternalPanelsSnapshot(): Promise<ExternalPanelSnapshot> {
    return new Promise((resolve) => {
      if (!(chrome && chrome.devtools)) {
        resolve({ version: 0, panels: [] });
        return;
      }

      const expression = `
        (function() {
          const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
          if (!hook || typeof hook.getExternalPanelsSnapshot !== 'function') {
            return { version: 0, panels: [] };
          }
          try {
            return hook.getExternalPanelsSnapshot();
          } catch (error) {
            return { version: 0, panels: [] };
          }
        })();
      `;

      chrome.devtools.inspectedWindow.eval(
        expression,
        (result: ExternalPanelSnapshot) => {
          if (!result || typeof result !== 'object') {
            resolve({ version: 0, panels: [] });
            return;
          }
          const version = typeof result.version === 'number' ? result.version : 0;
          const panels = Array.isArray(result.panels) ? result.panels : [];
          resolve({ version, panels });
        }
      );
    });
  }

  emitExternalPanelEvent(eventName: string, payload: Record<string, unknown> = {}): Promise<boolean> {
    return new Promise((resolve) => {
      if (!(chrome && chrome.devtools)) {
        resolve(false);
        return;
      }

      let serializedPayload = '{}';
      try {
        serializedPayload = JSON.stringify(payload || {});
      } catch {
        serializedPayload = '{}';
      }

      const expression = `
        (function() {
          try {
            const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
            if (hook && typeof hook.emitDevtoolsEvent === 'function') {
              return hook.emitDevtoolsEvent(${JSON.stringify(eventName)}, ${serializedPayload});
            }
            window.dispatchEvent(new CustomEvent(${JSON.stringify(eventName)}, { detail: ${serializedPayload} }));
            return true;
          } catch (error) {
            return false;
          }
        })();
      `;

      chrome.devtools.inspectedWindow.eval(expression, (result: boolean) => {
        resolve(Boolean(result));
      });
    });
  }

  getInteractionLog(): Promise<EventInteractionRecord[]> {
    return new Promise((resolve) => {
      if (!(chrome && chrome.devtools)) {
        resolve([]);
        return;
      }

      const expression = `
        (function() {
          try {
            const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
            if (!hook || typeof hook.getInteractionLog !== 'function') {
              return [];
            }
            const log = hook.getInteractionLog();
            return Array.isArray(log) ? log : [];
          } catch (error) {
            return [];
          }
        })();
      `;

      chrome.devtools.inspectedWindow.eval(expression, (result: EventInteractionRecord[]) => {
        if (!Array.isArray(result)) {
          resolve([]);
          return;
        }
        resolve(result);
      });
    });
  }

  replayInteraction(interactionId: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (!(chrome && chrome.devtools)) {
        resolve(false);
        return;
      }

      const expression = `
        (function() {
          const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
          if (!hook || typeof hook.replayInteraction !== 'function') {
            return false;
          }
          try {
            return hook.replayInteraction(${JSON.stringify(interactionId)});
          } catch (error) {
            return false;
          }
        })();
      `;

      chrome.devtools.inspectedWindow.eval(expression, (result: boolean) => {
        resolve(Boolean(result));
      });
    });
  }

  applyInteractionSnapshot(interactionId: string, phase: InteractionPhase): Promise<boolean> {
    return new Promise((resolve) => {
      if (!(chrome && chrome.devtools)) {
        resolve(false);
        return;
      }

      const expression = `
        (function() {
          const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
          if (!hook || typeof hook.applyInteractionSnapshot !== 'function') {
            return false;
          }
          try {
            return hook.applyInteractionSnapshot(${JSON.stringify(interactionId)}, ${JSON.stringify(phase)});
          } catch (error) {
            return false;
          }
        })();
      `;

      chrome.devtools.inspectedWindow.eval(expression, (result: boolean) => {
        resolve(Boolean(result));
      });
    });
  }

  clearInteractionLog(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!(chrome && chrome.devtools)) {
        resolve(false);
        return;
      }

      const expression = `
        (function() {
          const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
          if (!hook || typeof hook.clearInteractionLog !== 'function') {
            return false;
          }
          try {
            return hook.clearInteractionLog();
          } catch (error) {
            return false;
          }
        })();
      `;

      chrome.devtools.inspectedWindow.eval(expression, (result: boolean) => {
        resolve(Boolean(result));
      });
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

              segments.push(tag + ':nth-of-type(' + index + ')');
              current = current.parentElement;
            }

            segments.push('html');
            return segments.reverse().join(' > ');
          }

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
                const domPath = getDomPath(event.target);
                componentInfo.__auDevtoolsDomPath = domPath;
                if (componentInfo.customElementInfo) {
                  componentInfo.customElementInfo.__auDevtoolsDomPath = domPath;
                }
                if (componentInfo.customAttributesInfo && componentInfo.customAttributesInfo.length) {
                  componentInfo.customAttributesInfo.forEach(attr => {
                    if (attr) {
                      attr.__auDevtoolsDomPath = domPath;
                    }
                  });
                }
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

  startPropertyWatching(options: WatchOptions) {
    this.stopPropertyWatching();

    this.watchingComponentKey = options.componentKey;
    const interval = options.pollInterval || 500;

    this.getPropertySnapshot(options.componentKey).then((snapshot) => {
      this.lastPropertySnapshot = snapshot;
    });

    this.propertyWatchInterval = setInterval(() => {
      this.checkForPropertyChanges();
    }, interval) as any;
  }

  stopPropertyWatching() {
    if (this.propertyWatchInterval) {
      clearInterval(this.propertyWatchInterval);
      this.propertyWatchInterval = null;
    }
    this.watchingComponentKey = null;
    this.lastPropertySnapshot = null;
  }

  private checkForPropertyChanges() {
    if (!this.watchingComponentKey) return;

    this.getPropertySnapshot(this.watchingComponentKey).then((snapshot) => {
      if (!snapshot || !this.lastPropertySnapshot) {
        this.lastPropertySnapshot = snapshot;
        return;
      }

      const changes = this.diffPropertySnapshots(this.lastPropertySnapshot, snapshot);

      if (changes.length > 0) {
        this.lastPropertySnapshot = snapshot;
        if (this.consumer && typeof this.consumer.onPropertyChanges === 'function') {
          this.consumer.onPropertyChanges(changes, snapshot);
        }
      }
    });
  }

  private diffPropertySnapshots(
    oldSnapshot: PropertySnapshot,
    newSnapshot: PropertySnapshot
  ): PropertyChangeRecord[] {
    const changes: PropertyChangeRecord[] = [];

    const compareProperties = (
      oldProps: Array<{ name: string; value: unknown; type: string }>,
      newProps: Array<{ name: string; value: unknown; type: string }>,
      propertyType: 'bindable' | 'property'
    ) => {
      const oldMap = new Map(oldProps.map((p) => [p.name, p]));
      const newMap = new Map(newProps.map((p) => [p.name, p]));

      for (const [name, newProp] of newMap) {
        const oldProp = oldMap.get(name);
        if (!oldProp) {
          changes.push({
            componentKey: newSnapshot.componentKey,
            propertyName: name,
            propertyType,
            oldValue: undefined,
            newValue: newProp.value,
            timestamp: newSnapshot.timestamp,
          });
        } else if (!this.valuesEqual(oldProp.value, newProp.value)) {
          changes.push({
            componentKey: newSnapshot.componentKey,
            propertyName: name,
            propertyType,
            oldValue: oldProp.value,
            newValue: newProp.value,
            timestamp: newSnapshot.timestamp,
          });
        }
      }
    };

    compareProperties(oldSnapshot.bindables, newSnapshot.bindables, 'bindable');
    compareProperties(oldSnapshot.properties, newSnapshot.properties, 'property');

    return changes;
  }

  private valuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return a === b;
    if (typeof a === 'object') {
      try {
        return JSON.stringify(a) === JSON.stringify(b);
      } catch {
        return false;
      }
    }
    return false;
  }

  getPropertySnapshot(componentKey: string): Promise<PropertySnapshot | null> {
    return new Promise((resolve) => {
      if (!(chrome && chrome.devtools)) {
        resolve(null);
        return;
      }

      const expression = `
        (function() {
          try {
            const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
            if (!hook || !hook.getComponentByKey) {
              return null;
            }
            const info = hook.getComponentByKey(${JSON.stringify(componentKey)});
            if (!info) {
              return null;
            }
            const serializeValue = (val) => {
              if (val === null) return { value: null, type: 'null' };
              if (val === undefined) return { value: undefined, type: 'undefined' };
              const t = typeof val;
              if (t === 'function') return { value: '[Function]', type: 'function' };
              if (t === 'object') {
                try {
                  return { value: JSON.parse(JSON.stringify(val)), type: Array.isArray(val) ? 'array' : 'object' };
                } catch {
                  return { value: '[Object]', type: 'object' };
                }
              }
              return { value: val, type: t };
            };
            const bindables = (info.bindables || []).map(b => ({
              name: b.name,
              ...serializeValue(b.value)
            }));
            const properties = (info.properties || []).map(p => ({
              name: p.name,
              ...serializeValue(p.value)
            }));
            return {
              componentKey: ${JSON.stringify(componentKey)},
              bindables,
              properties,
              timestamp: Date.now()
            };
          } catch (e) {
            return null;
          }
        })();
      `;

      chrome.devtools.inspectedWindow.eval(expression, (result: PropertySnapshot | null) => {
        resolve(result);
      });
    });
  }

  refreshSelectedComponent(): Promise<IControllerInfo | null> {
    return new Promise((resolve) => {
      if (!(chrome && chrome.devtools) || !this.watchingComponentKey) {
        resolve(null);
        return;
      }

      const expression = `
        (function() {
          try {
            const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
            if (!hook || !hook.getComponentByKey) {
              return null;
            }
            return hook.getComponentByKey(${JSON.stringify(this.watchingComponentKey)});
          } catch (e) {
            return null;
          }
        })();
      `;

      chrome.devtools.inspectedWindow.eval(expression, (result: IControllerInfo | null) => {
        resolve(result);
      });
    });
  }

  checkComponentTreeChanges(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!(chrome && chrome.devtools)) {
        resolve(false);
        return;
      }

      const expression = `
        (function() {
          try {
            const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
            if (!hook) return '';

            const getSignature = (nodes) => {
              if (!nodes || !nodes.length) return '';
              return nodes.map(n => {
                const key = n.customElementInfo?.key || n.customElementInfo?.name || n.id || '';
                const attrKeys = (n.customAttributesInfo || []).map(a => a?.key || a?.name || '').join(',');
                const childSig = n.children ? getSignature(n.children) : '';
                return key + ':' + attrKeys + '(' + childSig + ')';
              }).join('|');
            };

            if (hook.getComponentTree) {
              const tree = hook.getComponentTree() || [];
              return getSignature(tree);
            }

            if (hook.getAllInfo) {
              const flat = hook.getAllInfo() || [];
              return flat.map(c => (c.customElementInfo?.key || c.customElementInfo?.name || '')).join('|');
            }

            return '';
          } catch (e) {
            return '';
          }
        })();
      `;

      chrome.devtools.inspectedWindow.eval(expression, (signature: string) => {
        const hasChanged = signature !== this.componentTreeSignature;
        this.componentTreeSignature = signature;
        resolve(hasChanged);
      });
    });
  }

  getLifecycleHooks(componentKey: string): Promise<LifecycleHooksSnapshot | null> {
    return new Promise((resolve) => {
      if (!(chrome && chrome.devtools)) {
        resolve(null);
        return;
      }

      const expression = `
        (function() {
          try {
            const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
            if (!hook || typeof hook.getLifecycleHooks !== 'function') {
              return null;
            }
            return hook.getLifecycleHooks(${JSON.stringify(componentKey)});
          } catch (error) {
            return null;
          }
        })();
      `;

      chrome.devtools.inspectedWindow.eval(expression, (result: LifecycleHooksSnapshot | null) => {
        resolve(result);
      });
    });
  }

  getComputedProperties(componentKey: string): Promise<ComputedPropertyInfo[]> {
    return new Promise((resolve) => {
      if (!(chrome && chrome.devtools)) {
        resolve([]);
        return;
      }

      const expression = `
        (function() {
          try {
            const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
            if (!hook || typeof hook.getComputedProperties !== 'function') {
              return [];
            }
            return hook.getComputedProperties(${JSON.stringify(componentKey)}) || [];
          } catch (error) {
            return [];
          }
        })();
      `;

      chrome.devtools.inspectedWindow.eval(expression, (result: ComputedPropertyInfo[]) => {
        resolve(Array.isArray(result) ? result : []);
      });
    });
  }

  getDependencies(componentKey: string): Promise<DISnapshot | null> {
    return new Promise((resolve) => {
      if (!(chrome && chrome.devtools)) {
        resolve(null);
        return;
      }

      const expression = `
        (function() {
          try {
            const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
            if (!hook || typeof hook.getDependencies !== 'function') {
              return null;
            }
            return hook.getDependencies(${JSON.stringify(componentKey)});
          } catch (error) {
            return null;
          }
        })();
      `;

      chrome.devtools.inspectedWindow.eval(expression, (result: DISnapshot | null) => {
        resolve(result);
      });
    });
  }

  getRouteInfo(componentKey: string): Promise<RouteSnapshot | null> {
    return new Promise((resolve) => {
      if (!(chrome && chrome.devtools)) {
        resolve(null);
        return;
      }

      const expression = `
        (function() {
          try {
            const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
            if (!hook || typeof hook.getRouteInfo !== 'function') {
              return null;
            }
            return hook.getRouteInfo(${JSON.stringify(componentKey)});
          } catch (error) {
            return null;
          }
        })();
      `;

      chrome.devtools.inspectedWindow.eval(expression, (result: RouteSnapshot | null) => {
        resolve(result);
      });
    });
  }

  getSlotInfo(componentKey: string): Promise<SlotSnapshot | null> {
    return new Promise((resolve) => {
      if (!(chrome && chrome.devtools)) {
        resolve(null);
        return;
      }

      const expression = `
        (function() {
          try {
            const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
            if (!hook || typeof hook.getSlotInfo !== 'function') {
              return null;
            }
            return hook.getSlotInfo(${JSON.stringify(componentKey)});
          } catch (error) {
            return null;
          }
        })();
      `;

      chrome.devtools.inspectedWindow.eval(expression, (result: SlotSnapshot | null) => {
        resolve(result);
      });
    });
  }
}
