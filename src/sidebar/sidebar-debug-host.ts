import {
  AureliaInfo,
  ComponentTreeNode,
  ComputedPropertyInfo,
  DISnapshot,
  EnhancedDISnapshot,
  IControllerInfo,
  LifecycleHooksSnapshot,
  Property,
  PropertySnapshot,
  RouteSnapshot,
  SlotSnapshot,
  TemplateSnapshot,
  WatchOptions,
} from '../shared/types';
import { SidebarApp } from './sidebar-app';

interface SearchResult {
  key: string;
  name: string;
  type: 'custom-element' | 'custom-attribute';
}

export class SidebarDebugHost {
  consumer: SidebarApp | null = null;
  private pickerPollingInterval: number | null = null;
  private propertyWatchInterval: number | null = null;
  private lastPropertySnapshot: PropertySnapshot | null = null;
  private watchingComponentKey: string | null = null;
  private useEventDrivenWatching = false;

  attach(consumer: SidebarApp) {
    this.consumer = consumer;

    if (chrome?.devtools) {
      // Listen for element selection changes in the Elements panel
      chrome.devtools.panels.elements.onSelectionChanged.addListener(() => {
        if (this.consumer && this.consumer.followChromeSelection) {
          this.getSelectedElementInfo();
        }
      });

      // Get initial selection
      setTimeout(() => {
        if (this.consumer?.followChromeSelection) {
          this.getSelectedElementInfo();
        }
      }, 500);
    }
  }

  private getSelectedElementInfo() {
    if (!chrome?.devtools) return;

    const selectionEval = `
      (function() {
        const target = typeof $0 !== 'undefined' ? $0 : null;
        const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
        if (!hook || !target) {
          return null;
        }

        function getDomPath(element) {
          if (!element || element.nodeType !== 1) return '';
          const segments = [];
          let current = element;
          while (current && current.nodeType === 1 && current !== document) {
            const tag = current.tagName ? current.tagName.toLowerCase() : 'unknown';
            let index = 1;
            let sibling = current;
            while ((sibling = sibling.previousElementSibling)) {
              if (sibling.tagName === current.tagName) index++;
            }
            segments.push(tag + ':nth-of-type(' + index + ')');
            current = current.parentElement;
          }
          segments.push('html');
          return segments.reverse().join(' > ');
        }

        // Get component info - traverse=true means it will walk up the DOM
        // to find the nearest Aurelia component/binding context
        let info = null;
        let isBindingContext = false;
        const selectedTagName = target.tagName ? target.tagName.toLowerCase() : 'unknown';

        if (hook.getCustomElementInfo) {
          info = hook.getCustomElementInfo(target, false);
        }

        // If no component found via getCustomElementInfo, try to find binding context
        // by walking up the DOM manually looking for $au or .au properties
        if (!info || (!info.customElementInfo && (!info.customAttributesInfo || !info.customAttributesInfo.length))) {
          let el = target.parentElement;
          while (el && el !== document.body) {
            // Check for Aurelia v2
            if (el.$au) {
              const auV2 = el.$au;
              const customElement = auV2['au:resource:custom-element'];
              if (customElement) {
                // Re-call with this element to get proper info extraction
                info = hook.getCustomElementInfo(el, false);
                if (info) {
                  isBindingContext = true;
                  break;
                }
              }
            }
            // Check for Aurelia v1
            if (el.au && el.au.controller) {
              info = hook.getCustomElementInfo(el, false);
              if (info) {
                isBindingContext = true;
                break;
              }
            }
            el = el.parentElement;
          }
        }

        if (!info) return null;

        const domPath = getDomPath(target);
        info.__auDevtoolsDomPath = domPath;
        info.__selectedElement = selectedTagName;
        info.__isBindingContext = isBindingContext;
        if (info.customElementInfo) {
          info.customElementInfo.__auDevtoolsDomPath = domPath;
        }
        if (Array.isArray(info.customAttributesInfo)) {
          info.customAttributesInfo.forEach(attr => {
            if (attr) attr.__auDevtoolsDomPath = domPath;
          });
        }

        return info;
      })();
    `;

    chrome.devtools.inspectedWindow.eval(selectionEval, (info: AureliaInfo) => {
      if (info && this.consumer) {
        this.consumer.onElementPicked(info);
      }
    });
  }

  updateValues(componentInfo: IControllerInfo, property?: Property) {
    if (!chrome?.devtools) return;

    chrome.devtools.inspectedWindow.eval(
      `window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__.updateValues(${JSON.stringify(
        componentInfo
      )}, ${JSON.stringify(property)})`
    );
  }

  // Element picker
  startElementPicker() {
    if (!chrome?.devtools) return;

    this.startPickerPolling();

    const pickerCode = `
      (() => {
        window.__aureliaDevtoolsStopPicker && window.__aureliaDevtoolsStopPicker();

        let isPickerActive = true;
        let currentHighlight = null;

        function getDomPath(element) {
          if (!element || element.nodeType !== 1) return '';
          const segments = [];
          let current = element;
          while (current && current.nodeType === 1 && current !== document) {
            const tag = current.tagName ? current.tagName.toLowerCase() : 'unknown';
            let index = 1;
            let sibling = current;
            while ((sibling = sibling.previousElementSibling)) {
              if (sibling.tagName === current.tagName) index++;
            }
            segments.push(tag + ':nth-of-type(' + index + ')');
            current = current.parentElement;
          }
          segments.push('html');
          return segments.reverse().join(' > ');
        }

        if (!document.getElementById('aurelia-picker-styles')) {
          const style = document.createElement('style');
          style.id = 'aurelia-picker-styles';
          style.textContent = \`
            .aurelia-picker-highlight {
              outline: 2px solid #ff6b35 !important;
              outline-offset: -2px !important;
              background-color: rgba(255, 107, 53, 0.1) !important;
              cursor: crosshair !important;
            }
            * { cursor: crosshair !important; }
          \`;
          document.head.appendChild(style);
        }

        function highlightElement(element) {
          if (currentHighlight) currentHighlight.classList.remove('aurelia-picker-highlight');
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

          const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
          if (hook) {
            const info = hook.getCustomElementInfo(event.target, true);
            if (info) {
              const domPath = getDomPath(event.target);
              info.__auDevtoolsDomPath = domPath;
              if (info.customElementInfo) info.customElementInfo.__auDevtoolsDomPath = domPath;
              if (info.customAttributesInfo) {
                info.customAttributesInfo.forEach(attr => {
                  if (attr) attr.__auDevtoolsDomPath = domPath;
                });
              }
              window.__AURELIA_DEVTOOLS_PICKED_COMPONENT__ = info;
            } else {
              window.__AURELIA_DEVTOOLS_PICKED_COMPONENT__ = null;
            }
          }

          window.__aureliaDevtoolsStopPicker();
        }

        document.addEventListener('mouseover', onMouseOver, true);
        document.addEventListener('mouseout', onMouseOut, true);
        document.addEventListener('click', onClick, true);

        window.__aureliaDevtoolsStopPicker = function() {
          isPickerActive = false;
          unhighlightElement();
          document.removeEventListener('mouseover', onMouseOver, true);
          document.removeEventListener('mouseout', onMouseOut, true);
          document.removeEventListener('click', onClick, true);
          const styles = document.getElementById('aurelia-picker-styles');
          if (styles) styles.remove();
          delete window.__aureliaDevtoolsStopPicker;
        };

        return true;
      })();
    `;

    chrome.devtools.inspectedWindow.eval(pickerCode);
  }

  stopElementPicker() {
    if (!chrome?.devtools) return;

    this.stopPickerPolling();

    chrome.devtools.inspectedWindow.eval(
      `window.__aureliaDevtoolsStopPicker && window.__aureliaDevtoolsStopPicker();`
    );
  }

  private startPickerPolling() {
    this.stopPickerPolling();
    this.pickerPollingInterval = setInterval(() => {
      this.checkForPickedComponent();
    }, 100) as unknown as number;
  }

  private stopPickerPolling() {
    if (this.pickerPollingInterval) {
      clearInterval(this.pickerPollingInterval);
      this.pickerPollingInterval = null;
    }
  }

  private checkForPickedComponent() {
    if (!chrome?.devtools) return;

    chrome.devtools.inspectedWindow.eval(
      `(() => {
        const picked = window.__AURELIA_DEVTOOLS_PICKED_COMPONENT__;
        if (picked) {
          window.__AURELIA_DEVTOOLS_PICKED_COMPONENT__ = null;
          return picked;
        }
        return null;
      })();`,
      (info: AureliaInfo) => {
        if (info && this.consumer) {
          this.stopPickerPolling();
          this.consumer.onElementPicked(info);
        }
      }
    );
  }

  // Property watching
  startPropertyWatching(options: WatchOptions) {
    this.stopPropertyWatching();
    this.watchingComponentKey = options.componentKey;

    this.tryEventDrivenWatching(options.componentKey).then(success => {
      if (success) {
        this.useEventDrivenWatching = true;
      } else {
        this.useEventDrivenWatching = false;
        const interval = options.pollInterval || 500;

        this.getPropertySnapshot(options.componentKey).then(snapshot => {
          this.lastPropertySnapshot = snapshot;
        });

        this.propertyWatchInterval = setInterval(() => {
          this.checkForPropertyChanges();
        }, interval) as unknown as number;
      }
    });
  }

  private tryEventDrivenWatching(componentKey: string): Promise<boolean> {
    return new Promise(resolve => {
      if (!chrome?.devtools) {
        resolve(false);
        return;
      }

      const expr = `
        (function() {
          try {
            const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
            if (!hook || typeof hook.attachPropertyWatchers !== 'function') return false;
            return hook.attachPropertyWatchers(${JSON.stringify(componentKey)});
          } catch { return false; }
        })();
      `;

      chrome.devtools.inspectedWindow.eval(expr, (result: boolean) => {
        resolve(result === true);
      });
    });
  }

  stopPropertyWatching() {
    if (this.propertyWatchInterval) {
      clearInterval(this.propertyWatchInterval);
      this.propertyWatchInterval = null;
    }

    if (this.useEventDrivenWatching && this.watchingComponentKey && chrome?.devtools) {
      const componentKey = this.watchingComponentKey;
      chrome.devtools.inspectedWindow.eval(`
        (function() {
          try {
            const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
            if (hook && typeof hook.detachPropertyWatchers === 'function') {
              hook.detachPropertyWatchers(${JSON.stringify(componentKey)});
            }
          } catch {}
        })();
      `);
    }

    this.watchingComponentKey = null;
    this.lastPropertySnapshot = null;
    this.useEventDrivenWatching = false;
  }

  private checkForPropertyChanges() {
    if (!this.watchingComponentKey) return;

    this.getPropertySnapshot(this.watchingComponentKey).then(snapshot => {
      if (!snapshot || !this.lastPropertySnapshot) {
        this.lastPropertySnapshot = snapshot;
        return;
      }

      const changes = this.diffPropertySnapshots(this.lastPropertySnapshot, snapshot);
      if (changes.length > 0) {
        this.lastPropertySnapshot = snapshot;
        if (this.consumer) {
          this.consumer.onPropertyChanges(changes, snapshot);
        }
      }
    });
  }

  private diffPropertySnapshots(oldSnap: PropertySnapshot, newSnap: PropertySnapshot) {
    const changes: any[] = [];

    const compare = (oldProps: any[], newProps: any[], type: string) => {
      const oldMap = new Map(oldProps.map(p => [p.name, p]));
      const newMap = new Map(newProps.map(p => [p.name, p]));

      for (const [name, newProp] of newMap) {
        const oldProp = oldMap.get(name);
        if (!oldProp || !this.valuesEqual(oldProp.value, newProp.value)) {
          changes.push({
            componentKey: newSnap.componentKey,
            propertyName: name,
            propertyType: type,
            oldValue: oldProp?.value,
            newValue: newProp.value,
            timestamp: newSnap.timestamp,
          });
        }
      }
    };

    compare(oldSnap.bindables, newSnap.bindables, 'bindable');
    compare(oldSnap.properties, newSnap.properties, 'property');

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
    return new Promise(resolve => {
      if (!chrome?.devtools) {
        resolve(null);
        return;
      }

      const expr = `
        (function() {
          try {
            const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
            if (!hook || !hook.getComponentByKey) return null;
            const info = hook.getComponentByKey(${JSON.stringify(componentKey)});
            if (!info) return null;

            const serialize = val => {
              if (val === null) return { value: null, type: 'null' };
              if (val === undefined) return { value: undefined, type: 'undefined' };
              const t = typeof val;
              if (t === 'function') return { value: '[Function]', type: 'function' };
              if (t === 'object') {
                try {
                  return { value: JSON.parse(JSON.stringify(val)), type: Array.isArray(val) ? 'array' : 'object' };
                } catch { return { value: '[Object]', type: 'object' }; }
              }
              return { value: val, type: t };
            };

            return {
              componentKey: ${JSON.stringify(componentKey)},
              bindables: (info.bindables || []).map(b => ({ name: b.name, ...serialize(b.value) })),
              properties: (info.properties || []).map(p => ({ name: p.name, ...serialize(p.value) })),
              timestamp: Date.now()
            };
          } catch { return null; }
        })();
      `;

      chrome.devtools.inspectedWindow.eval(expr, (result: PropertySnapshot | null) => {
        resolve(result);
      });
    });
  }

  // Search
  searchComponents(query: string): Promise<SearchResult[]> {
    return new Promise(resolve => {
      if (!chrome?.devtools) {
        resolve([]);
        return;
      }

      const expr = `
        (function() {
          try {
            const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
            if (!hook) return [];

            const results = [];
            const query = ${JSON.stringify(query.toLowerCase())};

            const processTree = (nodes) => {
              if (!nodes) return;
              for (const node of nodes) {
                if (node.customElementInfo) {
                  const name = node.customElementInfo.name || '';
                  if (name.toLowerCase().includes(query)) {
                    results.push({
                      key: node.customElementInfo.key || name,
                      name: name,
                      type: 'custom-element'
                    });
                  }
                }
                if (node.customAttributesInfo) {
                  for (const attr of node.customAttributesInfo) {
                    if (attr && attr.name && attr.name.toLowerCase().includes(query)) {
                      results.push({
                        key: attr.key || attr.name,
                        name: attr.name,
                        type: 'custom-attribute'
                      });
                    }
                  }
                }
                if (node.children) processTree(node.children);
              }
            };

            if (hook.getComponentTree) {
              processTree(hook.getComponentTree() || []);
            } else if (hook.getAllInfo) {
              const flat = hook.getAllInfo() || [];
              for (const item of flat) {
                if (item.customElementInfo) {
                  const name = item.customElementInfo.name || '';
                  if (name.toLowerCase().includes(query)) {
                    results.push({
                      key: item.customElementInfo.key || name,
                      name: name,
                      type: 'custom-element'
                    });
                  }
                }
              }
            }

            return results.slice(0, 20);
          } catch { return []; }
        })();
      `;

      chrome.devtools.inspectedWindow.eval(expr, (results: SearchResult[]) => {
        resolve(Array.isArray(results) ? results : []);
      });
    });
  }

  selectComponentByKey(key: string): void {
    if (!chrome?.devtools) return;

    const expr = `
      (function() {
        try {
          const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
          if (!hook) return null;

          const targetKey = ${JSON.stringify(key)};
          let result = null;

          // Try getComponentByKey first if available
          if (hook.getComponentByKey) {
            const info = hook.getComponentByKey(targetKey);
            if (info) {
              result = { customElementInfo: info, customAttributesInfo: [] };
            }
          }

          // Otherwise search through the tree
          if (!result) {
            const findInTree = (nodes) => {
              if (!nodes) return null;
              for (const node of nodes) {
                if (node.customElementInfo) {
                  const nodeKey = node.customElementInfo.key || node.customElementInfo.name;
                  if (nodeKey === targetKey) {
                    return {
                      customElementInfo: node.customElementInfo,
                      customAttributesInfo: node.customAttributesInfo || []
                    };
                  }
                }
                if (node.customAttributesInfo) {
                  for (const attr of node.customAttributesInfo) {
                    const attrKey = attr.key || attr.name;
                    if (attrKey === targetKey) {
                      return {
                        customElementInfo: null,
                        customAttributesInfo: [attr]
                      };
                    }
                  }
                }
                if (node.children) {
                  const found = findInTree(node.children);
                  if (found) return found;
                }
              }
              return null;
            };

            if (hook.getComponentTree) {
              result = findInTree(hook.getComponentTree() || []);
            }
          }

          // Fallback to flat list
          if (!result && hook.getAllInfo) {
            const flat = hook.getAllInfo() || [];
            for (const item of flat) {
              if (item.customElementInfo) {
                const nodeKey = item.customElementInfo.key || item.customElementInfo.name;
                if (nodeKey === targetKey) {
                  result = {
                    customElementInfo: item.customElementInfo,
                    customAttributesInfo: item.customAttributesInfo || []
                  };
                  break;
                }
              }
            }
          }

          // If found, also select the element in the Elements panel
          if (result && hook.findElementByComponentInfo) {
            const el = hook.findElementByComponentInfo(result);
            if (el) {
              inspect(el);
            }
          }

          return result;
        } catch { return null; }
      })();
    `;

    chrome.devtools.inspectedWindow.eval(expr, (info: AureliaInfo) => {
      if (info && this.consumer) {
        this.consumer.onElementPicked(info);
      }
    });
  }

  // Reveal in Elements
  revealInElements(componentInfo: any) {
    if (!chrome?.devtools) return;

    const code = `(() => {
      try {
        const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
        if (!hook || !hook.findElementByComponentInfo) return false;
        const el = hook.findElementByComponentInfo(${JSON.stringify(componentInfo)});
        if (el) {
          inspect(el);
          return true;
        }
        return false;
      } catch { return false; }
    })();`;

    chrome.devtools.inspectedWindow.eval(code);
  }

  // Enhanced info methods
  getLifecycleHooks(componentKey: string): Promise<LifecycleHooksSnapshot | null> {
    return this.evalHook('getLifecycleHooks', componentKey);
  }

  getComputedProperties(componentKey: string): Promise<ComputedPropertyInfo[]> {
    return this.evalHook<ComputedPropertyInfo[]>('getComputedProperties', componentKey).then(r => r || []);
  }

  getDependencies(componentKey: string): Promise<DISnapshot | null> {
    return this.evalHook('getDependencies', componentKey);
  }

  getEnhancedDISnapshot(componentKey: string): Promise<EnhancedDISnapshot | DISnapshot | null> {
    return this.evalHook('getEnhancedDISnapshot', componentKey);
  }

  getRouteInfo(componentKey: string): Promise<RouteSnapshot | null> {
    return this.evalHook('getRouteInfo', componentKey);
  }

  getSlotInfo(componentKey: string): Promise<SlotSnapshot | null> {
    return this.evalHook('getSlotInfo', componentKey);
  }

  getTemplateSnapshot(componentKey: string): Promise<TemplateSnapshot | null> {
    return this.evalHook('getTemplateSnapshot', componentKey);
  }

  getComponentTree(): Promise<ComponentTreeNode[]> {
    return new Promise(resolve => {
      if (!chrome?.devtools) {
        resolve([]);
        return;
      }

      const expr = `
        (function() {
          try {
            const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
            if (!hook || typeof hook.getSimplifiedComponentTree !== 'function') return [];
            return hook.getSimplifiedComponentTree();
          } catch { return []; }
        })();
      `;

      chrome.devtools.inspectedWindow.eval(expr, (result: ComponentTreeNode[]) => {
        resolve(Array.isArray(result) ? result : []);
      });
    });
  }

  // Timeline / Interaction recording
  startInteractionRecording(): Promise<boolean> {
    return new Promise(resolve => {
      if (!chrome?.devtools) {
        resolve(false);
        return;
      }

      const expr = `
        (function() {
          try {
            const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
            if (!hook || typeof hook.startInteractionRecording !== 'function') return false;
            return hook.startInteractionRecording();
          } catch { return false; }
        })();
      `;

      chrome.devtools.inspectedWindow.eval(expr, (result: boolean) => {
        resolve(result === true);
      });
    });
  }

  stopInteractionRecording(): Promise<boolean> {
    return new Promise(resolve => {
      if (!chrome?.devtools) {
        resolve(false);
        return;
      }

      const expr = `
        (function() {
          try {
            const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
            if (!hook || typeof hook.stopInteractionRecording !== 'function') return false;
            return hook.stopInteractionRecording();
          } catch { return false; }
        })();
      `;

      chrome.devtools.inspectedWindow.eval(expr, (result: boolean) => {
        resolve(result === true);
      });
    });
  }

  clearInteractionLog(): void {
    if (!chrome?.devtools) return;

    chrome.devtools.inspectedWindow.eval(`
      (function() {
        try {
          const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
          if (hook && typeof hook.clearInteractionLog === 'function') {
            hook.clearInteractionLog();
          }
        } catch {}
      })();
    `);
  }

  private evalHook<T>(method: string, componentKey: string): Promise<T | null> {
    return new Promise(resolve => {
      if (!chrome?.devtools) {
        resolve(null);
        return;
      }

      const expr = `
        (function() {
          try {
            const hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
            if (!hook || typeof hook.${method} !== 'function') return null;
            return hook.${method}(${JSON.stringify(componentKey)});
          } catch { return null; }
        })();
      `;

      chrome.devtools.inspectedWindow.eval(expr, (result: T | null) => {
        resolve(result);
      });
    });
  }
}
