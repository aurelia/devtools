import { DebugHost, SelectionChanged } from './backend/debug-host';
import {
  ValueConverterInstance,
  ICustomElementViewModel,
  IPlatform,
} from 'aurelia';
import { IControllerInfo, AureliaInfo } from './shared/types';
import { resolve } from '@aurelia/kernel';

export class App implements ICustomElementViewModel {
  debugInfo: any;
  isDarkTheme: boolean = false;
  JSON = JSON;

  // Tab management
  activeTab: 'all' | 'components' | 'attributes' = 'all';
  tabs = [
    { id: 'all', label: 'All', icon: '🌲' },
    { id: 'components', label: 'Components', icon: '📦' },
    { id: 'attributes', label: 'Attributes', icon: '🔧' },
  ];

  // Inspector tab data
  selectedElement: IControllerInfo = undefined;
  selectedElementAttributes: IControllerInfo[] = undefined;

  // Components tab data
  allAureliaObjects: AureliaInfo[] = undefined;
  componentTree: ComponentNode[] = [];
  filteredComponentTree: ComponentNode[] = [];
  selectedComponentId: string = undefined;
  searchQuery: string = '';
  isElementPickerActive: boolean = false;
  // Preference: follow Chrome Elements selection automatically
  followChromeSelection: boolean = true;
  // UI: animate refresh icon when user-triggered refresh happens
  isRefreshing: boolean = false;

  // Detection status
  aureliaDetected: boolean = false;
  aureliaVersion: number | null = null;
  detectionState: 'checking' | 'detected' | 'not-found' = 'checking';

  private debugHost: DebugHost = resolve(DebugHost);
  private plat: IPlatform = resolve(IPlatform);

  attaching() {
    this.debugHost.attach(this);
    this.isDarkTheme = (chrome?.devtools?.panels as any)?.themeName === 'dark';
    [].join();

    if (this.isDarkTheme) {
      document.querySelector('html').style.background = '#202124';
    }

    // Initialize filtered tree
    this.filteredComponentTree = [];

    // Restore persisted preference for following Elements selection
    try {
      const persisted = localStorage.getItem('au-devtools.followChromeSelection');
      if (persisted != null) this.followChromeSelection = persisted === 'true';
    } catch {}

    // Check detection state set by devtools.js
    this.checkDetectionState();

    // Delay component loading to allow Aurelia hooks to install, then try regardless of detection flags
    setTimeout(() => {
      this.checkDetectionState();
      this.loadAllComponents();
    }, 1000);

    // Poll for detection state changes
    this.startDetectionPolling();
  }

  get currentController() {
    return this.selectedElement;
  }

  checkDetectionState() {
    if (chrome && chrome.devtools) {
      chrome.devtools.inspectedWindow.eval(
        `({
          state: window.__AURELIA_DEVTOOLS_DETECTION_STATE__,
          version: window.__AURELIA_DEVTOOLS_VERSION__
        })`,
        (result: {state: string, version: number}, isException?: any) => {
          if (!isException && result) {

            switch (result.state) {
              case 'detected':
                this.aureliaDetected = true;
                this.aureliaVersion = result.version;
                this.detectionState = 'detected';
                break;
              case 'not-found':
                this.aureliaDetected = false;
                this.aureliaVersion = null;
                this.detectionState = 'not-found';
                break;
              case 'checking':
              default:
                this.detectionState = 'checking';
                break;
            }
          }
        }
      );
    }
  }

  startDetectionPolling() {
    // Poll for detection state changes every 2 seconds
    setInterval(() => {
      this.checkDetectionState();
      // Keep trying to load until we find components, regardless of detection flags
      if (!this.allAureliaObjects?.length) {
        this.loadAllComponents();
      }
    }, 2000);
  }

  recheckAurelia() {
    this.checkDetectionState();
    if (this.aureliaDetected || this.detectionState === 'not-found') {
      this.loadAllComponents();
    }
  }

  // Tab management methods
  switchTab(tabId: 'all' | 'components' | 'attributes') {
    this.activeTab = tabId;
    // Auto-refresh components when switching to any tab
    this.loadAllComponents();
  }

  // Component discovery methods
  loadAllComponents(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.plat.queueMicrotask(() => {
        this.debugHost
          .getAllComponents()
          .then((components) => {
            this.allAureliaObjects = components || [];
            this.buildComponentTree(components || []);

            // Update detection status based on whether we got components
            if (components && components.length > 0) {
              this.aureliaDetected = true;
              this.detectionState = 'detected';
            }

            resolve();
          })
          .catch((error) => {
            console.warn('Failed to load components:', error);
            this.allAureliaObjects = [];
            this.componentTree = [];
            reject(error);
          });
      });
    });
  }

  // User-triggered refresh with spinner animation
  refreshComponents() {
    if (this.isRefreshing) return;
    this.isRefreshing = true;
    this.loadAllComponents()
      .finally(() => {
        // Allow a short delay so the animation is visible even on fast refresh
        setTimeout(() => (this.isRefreshing = false), 300);
      });
  }

  public buildComponentTree(components: AureliaInfo[]) {
    // Build a hierarchical tree of components
    this.componentTree = this.createComponentHierarchy(components);
    // Filtering is now handled automatically by the filteredComponentTreeByTab getter
  }

  get filteredComponentTreeByTab(): ComponentNode[] {
    // First apply tab filtering to the full tree
    let tabFilteredTree: ComponentNode[];

    switch (this.activeTab) {
      case 'components':
        tabFilteredTree = this.filterTreeByType(this.componentTree, 'custom-element');
        break;
      case 'attributes':
        tabFilteredTree = this.filterTreeByType(this.componentTree, 'custom-attribute');
        break;
      case 'all':
      default:
        tabFilteredTree = this.componentTree;
        break;
    }

    // Then apply search filtering to the tab-filtered tree
    if (!this.searchQuery.trim()) {
      return tabFilteredTree;
    }

    const query = this.searchQuery.toLowerCase();
    return this.filterComponentTree(tabFilteredTree, query);
  }

  private filterTreeByType(nodes: ComponentNode[], type: 'custom-element' | 'custom-attribute'): ComponentNode[] {
    const filtered: ComponentNode[] = [];

    for (const node of nodes) {
      if (node.type === type) {
        // Include this node
        filtered.push({
          ...node,
          children: this.filterTreeByType(node.children, type)
        });
      } else {
        // Check if any children match the type
        const filteredChildren = this.filterTreeByType(node.children, type);
        if (filteredChildren.length > 0) {
          // Include parent with filtered children
          filtered.push({
            ...node,
            children: filteredChildren,
            expanded: true // Auto-expand to show matching children
          });
        }
      }
    }

    return filtered;
  }

  createComponentHierarchy(components: AureliaInfo[]): ComponentNode[] {
    const tree: ComponentNode[] = [];
    const processedElements = new Set<string>();

    components.forEach((component, index) => {
      // Process Custom Elements
      if (component.customElementInfo) {
        const elementInfo = component.customElementInfo;
        const elementId = elementInfo.key || `element-${index}`;

        if (!processedElements.has(elementId)) {
          const elementNode: ComponentNode = {
            id: elementId,
            name: elementInfo.name || `<unknown-element>`,
            type: 'custom-element',
            children: [],
            data: component,
            expanded: false,
            hasAttributes: component.customAttributesInfo?.length > 0,
          };

          // Add custom attributes as children if they exist
          if (
            component.customAttributesInfo &&
            component.customAttributesInfo.length > 0
          ) {
            // Filter out any attribute that accidentally matches the element's key/name
            const filteredAttrs = component.customAttributesInfo.filter(attr => {
              try {
                if (!attr) return false;
                const sameKey = !!(attr.key && elementInfo.key && attr.key === elementInfo.key);
                const sameName = !!(attr.name && elementInfo.name && attr.name === elementInfo.name);
                return !(sameKey || sameName);
              } catch { return true; }
            });

            filteredAttrs.forEach((attr, attrIndex) => {
              const attrNode: ComponentNode = {
                id: `${elementId}-attr-${attrIndex}`,
                name: attr.name || `unknown-attribute`,
                type: 'custom-attribute',
                children: [],
                data: { customElementInfo: null, customAttributesInfo: [attr] },
                expanded: false,
                hasAttributes: false,
              };
              elementNode.children.push(attrNode);
            });
          }

          tree.push(elementNode);
          processedElements.add(elementId);
        }
      } else if (
        component.customAttributesInfo &&
        component.customAttributesInfo.length > 0
      ) {
        // Process standalone Custom Attributes (without a parent element)
        component.customAttributesInfo
          .filter(attr => !!attr)
          .forEach((attr, attrIndex) => {
          const standaloneAttrNode: ComponentNode = {
            id: `standalone-attr-${index}-${attrIndex}`,
            name: attr.name || `unknown-attribute`,
            type: 'custom-attribute',
            children: [],
            data: { customElementInfo: null, customAttributesInfo: [attr] },
            expanded: false,
            hasAttributes: false,
          };
          tree.push(standaloneAttrNode);
        });
      }
    });

    return tree.sort((a, b) => {
      // Sort custom elements first, then attributes
      if (a.type === 'custom-element' && b.type === 'custom-attribute')
        return -1;
      if (a.type === 'custom-attribute' && b.type === 'custom-element')
        return 1;
      return a.name.localeCompare(b.name);
    });
  }

  selectComponent(componentId: string) {
    this.selectedComponentId = componentId;
    const component = this.findComponentById(componentId);
    if (component) {
      // Handle custom attributes differently from custom elements
      if (component.type === 'custom-attribute') {
        // For custom attributes, show the attribute info as the selected element
        // and clear any additional attributes since this IS the attribute
        this.selectedElement = component.data.customAttributesInfo?.[0] || null;
        this.selectedElement.bindables = this.selectedElement?.bindables || [];
        this.selectedElement.properties = this.selectedElement?.properties || [];
        this.selectedElementAttributes = [];
      } else {
        // For custom elements, use the existing logic
        this.selectedElement = component.data.customElementInfo || null;
        this.selectedElement.bindables = this.selectedElement?.bindables || [];
        this.selectedElement.properties = this.selectedElement?.properties || [];
        // Apply the same filtering logic used in tree creation to prevent duplicates
        const elementInfo = component.data.customElementInfo;
        const rawAttributes = component.data.customAttributesInfo || [];
        this.selectedElementAttributes = (rawAttributes || []).filter(attr => {
          try {
            if (!attr) return false;
            const sameKey = !!(attr.key && elementInfo.key && attr.key === elementInfo.key);
            const sameName = !!(attr.name && elementInfo.name && attr.name === elementInfo.name);
            return !(sameKey || sameName);
          } catch { return true; }
        });
      }

      // No longer switch tabs - details will show in the right panel
    }
  }

  findComponentById(id: string): ComponentNode | undefined {
    const findInTree = (nodes: ComponentNode[]): ComponentNode | undefined => {
      for (const node of nodes) {
        if (node.id === id) return node;
        const found = findInTree(node.children);
        if (found) return found;
      }
      return undefined;
    };
    return findInTree(this.componentTree);
  }

  toggleComponentExpansion(componentId: string) {
    const component = this.findComponentById(componentId);
    if (component) {
      component.expanded = !component.expanded;
    }
  }

  // Search and filter functionality
  filterComponents() {
    // Search filtering is now handled in the filteredComponentTreeByTab getter
    // This method is kept for compatibility but doesn't need to do anything
    // since the reactive getter automatically handles filtering
  }

  private filterComponentTree(
    nodes: ComponentNode[],
    query: string
  ): ComponentNode[] {
    const filtered: ComponentNode[] = [];

    for (const node of nodes) {
      const matchesSearch =
        node.name.toLowerCase().includes(query) ||
        node.type.toLowerCase().includes(query);

      // Filter children recursively
      const filteredChildren = this.filterComponentTree(node.children, query);

      // Include node if it matches or has matching children
      if (matchesSearch || filteredChildren.length > 0) {
        const filteredNode: ComponentNode = {
          ...node,
          children: filteredChildren,
          expanded: filteredChildren.length > 0 || node.expanded, // Auto-expand if has matching children
        };
        filtered.push(filteredNode);
      }
    }

    return filtered;
  }

  clearSearch() {
    this.searchQuery = '';
    // Filtering automatically updates via the reactive getter
  }

  // Component highlighting methods
  highlightComponent(component: ComponentNode) {
    // Pass the component info to debugHost for highlighting
    this.debugHost.highlightComponent({
      name: component.name,
      type: component.type,
      ...component.data,
    });
  }

  unhighlightComponent() {
    this.debugHost.unhighlightComponent();
  }

  // Element picker functionality
  toggleElementPicker() {
    this.isElementPickerActive = !this.isElementPickerActive;

    if (this.isElementPickerActive) {
      this.debugHost.startElementPicker();
    } else {
      this.debugHost.stopElementPicker();
    }
  }

  onElementPicked(componentInfo: AureliaInfo) {
    // Stop the picker
    this.isElementPickerActive = false;
    this.debugHost.stopElementPicker();

    // Find the component in our tree and select it
    const foundComponent = this.findComponentInTreeByInfo(componentInfo);
    if (foundComponent) {
      this.selectedComponentId = foundComponent.id;
      this.selectedElement = foundComponent.data.customElementInfo || (foundComponent.data.customAttributesInfo?.[0] ?? null);
      this.selectedElementAttributes = foundComponent.data.customAttributesInfo || [];
    } else {
      // If not found, refresh components and try again
      this.loadAllComponents().then(() => {
        const foundComponentAfterRefresh =
          this.findComponentInTreeByInfo(componentInfo);
        if (foundComponentAfterRefresh) {
          this.selectedComponentId = foundComponentAfterRefresh.id;
          this.selectedElement = foundComponentAfterRefresh.data.customElementInfo || (foundComponentAfterRefresh.data.customAttributesInfo?.[0] ?? null);
          this.selectedElementAttributes = foundComponentAfterRefresh.data.customAttributesInfo || [];
        }
      });
    }
  }

  toggleFollowChromeSelection() {
    this.followChromeSelection = !this.followChromeSelection;
    try {
      localStorage.setItem('au-devtools.followChromeSelection', String(this.followChromeSelection));
    } catch {}
  }

  revealInElements() {
    const node = this.findComponentById(this.selectedComponentId);
    if (!node) return;
    const info = node.data;
    this.debugHost.revealInElements({
      name: node.name,
      type: node.type,
      ...info,
    });
  }

  private findComponentInTreeByInfo(
    componentInfo: AureliaInfo
  ): ComponentNode | undefined {
    const searchInNodes = (
      nodes: ComponentNode[]
    ): ComponentNode | undefined => {
      for (const node of nodes) {
        // Check if this node matches the component info
        if (
          componentInfo.customElementInfo &&
          node.data.customElementInfo &&
          node.data.customElementInfo.key ===
            componentInfo.customElementInfo.key
        ) {
          return node;
        }

        // Check in children
        const found = searchInNodes(node.children);
        if (found) return found;
      }
      return undefined;
    };

    return searchInNodes(this.componentTree);
  }

  valueChanged(element: IControllerInfo) {
    this.plat.queueMicrotask(() => this.debugHost.updateValues(element));
  }

  // Property editing methods for inline properties
  editProperty(property: any) {
    const editableTypes = [
      'string',
      'number',
      'boolean',
      'bigint',
      'null',
      'undefined',
    ];
    if (editableTypes.includes(property.type) || property.canEdit) {
      property.isEditing = true;
      property.originalValue = property.value;
    }
  }

  saveProperty(property: any, newValue: string) {
    const originalType = property.type;
    let convertedValue: any = newValue;

    try {
      // Convert the value based on the original type
      switch (originalType) {
        case 'number':
          const numValue = Number(newValue);
          if (!isNaN(numValue)) {
            convertedValue = numValue;
          } else {
            property.value = property.originalValue; // Revert on invalid input
            property.isEditing = false;
            delete property.originalValue;
            return;
          }
          break;

        case 'boolean':
          const lowerValue = newValue.toLowerCase();
          if (lowerValue === 'true' || lowerValue === 'false') {
            convertedValue = lowerValue === 'true';
          } else {
            property.value = property.originalValue; // Revert on invalid input
            property.isEditing = false;
            delete property.originalValue;
            return;
          }
          break;

        case 'null':
          if (newValue === 'null' || newValue === '') {
            convertedValue = null;
          } else {
            convertedValue = newValue; // Convert to string if not null
            property.type = 'string';
          }
          break;

        case 'undefined':
          if (newValue === 'undefined' || newValue === '') {
            convertedValue = undefined;
          } else {
            convertedValue = newValue; // Convert to string if not undefined
            property.type = 'string';
          }
          break;

        case 'string':
        default:
          convertedValue = newValue;
          property.type = 'string';
          break;
      }

      // Update the property value
      property.value = convertedValue;
      property.isEditing = false;
      delete property.originalValue;

      // Update the actual property value via debugHost
      this.plat.queueMicrotask(() => {
        this.debugHost.updateValues(this.selectedElement, property);

        // Force UI update by refreshing just this property's binding
        this.refreshPropertyBindings();
      });
    } catch (error) {
      console.warn('Failed to convert property value:', error);
      property.value = property.originalValue; // Revert on error
      property.isEditing = false;
      delete property.originalValue;
    }
  }

  cancelPropertyEdit(property: any) {
    property.value = property.originalValue;
    property.isEditing = false;
    delete property.originalValue;
  }

  refreshPropertyBindings() {
    // Force Aurelia to re-render property bindings by updating object references
    if (this.selectedElement) {
      // Ensure arrays exist to avoid template errors
      this.selectedElement.bindables = this.selectedElement.bindables || [];
      this.selectedElement.properties = this.selectedElement.properties || [];

      // Update the bindables array reference to trigger change detection
      if (this.selectedElement.bindables) {
        this.selectedElement.bindables = [...this.selectedElement.bindables];
      }

      // Update the properties array reference to trigger change detection
      if (this.selectedElement.properties) {
        this.selectedElement.properties = [...this.selectedElement.properties];
      }
    }
  }

  // Object expansion functionality
  togglePropertyExpansion(property: any) {
    if (property.canExpand) {
      if (!property.isExpanded) {
        // Expanding - load the expanded value

        if (!property.expandedValue) {
          // Load expanded value using debugHost with callback
          this.loadExpandedPropertyValue(property);
        } else {
          // Already have expanded value, just toggle visibility
          property.isExpanded = true;
        }
      } else {
        // Collapsing - just hide the expanded content
        property.isExpanded = false;
      }
    } else {
    }
  }

  private loadExpandedPropertyValue(property: any) {
    if (property.debugId && chrome && chrome.devtools) {
      const code = `window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__.getExpandedDebugValueForId(${property.debugId})`;

      chrome.devtools.inspectedWindow.eval(
        code,
        (result: any, isException?: any) => {
          if (isException) {
            console.warn('Failed to get expanded value:', isException);
            return;
          }

          // No-op: remove debug logging after verification

          property.expandedValue = result;
          property.isExpanded = true;

          // Force UI update without calling refreshPropertyBindings to avoid conflicts with editing
          this.plat.queueMicrotask(() => {
            // Trigger change detection by updating the property reference
          // Handle first-level properties
          if (this.selectedElement?.bindables?.includes(property)) {
            const index = this.selectedElement.bindables.indexOf(property);
            this.selectedElement.bindables[index] = { ...property };
          }
          if (this.selectedElement?.properties?.includes(property)) {
            const index = this.selectedElement.properties.indexOf(property);
            this.selectedElement.properties[index] = { ...property };
          }
          // Handle controller top-level properties
          if ((this.selectedElement as any)?.controller?.properties?.includes?.(property)) {
            const arr = (this.selectedElement as any).controller.properties as any[];
            const index = arr.indexOf(property);
            if (index !== -1) arr[index] = { ...property };
          }

            // Handle nested properties - find parent and update its expanded value
            this.updateNestedPropertyReference(property);
          });
        }
      );
    }
  }

  private updateNestedPropertyReference(property: any) {
    // Helper function to recursively search and update nested properties
    const updateInArray = (arr: any[]): boolean => {
      if (!arr) return false;

      for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        if (item.expandedValue && item.expandedValue.properties) {
          // Check if this property is a child of this item
          const childIndex = item.expandedValue.properties.indexOf(property);
          if (childIndex !== -1) {
            // Found it! Update the parent's expanded value reference
            item.expandedValue = { ...item.expandedValue };
            item.expandedValue.properties = [...item.expandedValue.properties];
            item.expandedValue.properties[childIndex] = { ...property };
            return true;
          }

          // Recursively check nested properties
          if (updateInArray(item.expandedValue.properties)) {
            // A nested update occurred, so update this level too
            item.expandedValue = { ...item.expandedValue };
            item.expandedValue.properties = [...item.expandedValue.properties];
            return true;
          }
        }
      }
      return false;
    };

    // Check in bindables, properties, and controller properties (for deeper nesting)
    if (this.selectedElement) {
      updateInArray(this.selectedElement.bindables || []);
      updateInArray(this.selectedElement.properties || []);
      // Include controller internals if present
      updateInArray((this.selectedElement as any)?.controller?.properties || []);
    }
  }
}

interface ComponentNode {
  id: string;
  name: string;
  type: 'custom-element' | 'custom-attribute';
  children: ComponentNode[];
  data: AureliaInfo;
  expanded: boolean;
  hasAttributes: boolean;
}

export class StringifyValueConverter implements ValueConverterInstance {
  toView(value: unknown) {
    return JSON.stringify(value);
  }
}
