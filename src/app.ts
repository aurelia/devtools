import { DebugHost, SelectionChanged } from './backend/debug-host';
import {
  ValueConverterInstance,
  ICustomElementViewModel,
  IPlatform,
} from 'aurelia';
import { IControllerInfo, AureliaComponentSnapshot, AureliaComponentTreeNode, AureliaInfo, EventInteractionRecord, ExternalPanelContext, ExternalPanelDefinition, ExternalPanelSnapshot, InteractionPhase, PluginDevtoolsResult, Property, PropertyChangeRecord, PropertySnapshot } from './shared/types';
import { resolve } from '@aurelia/kernel';

export class App implements ICustomElementViewModel {
  debugInfo: any;
  isDarkTheme: boolean = false;
  JSON = JSON;

  // Tab management
  private readonly coreTabs: DevtoolsTabDefinition[] = [
    { id: 'all', label: 'All', icon: '🌲', kind: 'core' },
    { id: 'components', label: 'Components', icon: '📦', kind: 'core' },
    { id: 'attributes', label: 'Attributes', icon: '🔧', kind: 'core' },
    { id: 'interactions', label: 'Interactions', icon: '⏱️', kind: 'core' },
  ];
  activeTab: string = 'all';
  tabs: DevtoolsTabDefinition[] = [...this.coreTabs];
  externalTabs: DevtoolsTabDefinition[] = [];
  externalPanels: Record<string, ExternalPanelDefinition> = {};
  private externalPanelsVersion = 0;
  private externalPanelLoading: Record<string, boolean> = {};
  private externalRefreshHandle: ReturnType<typeof setTimeout> | null = null;

  // Inspector tab data
  selectedElement: IControllerInfo = undefined;
  selectedElementAttributes: IControllerInfo[] = undefined;
  selectedNodeType: 'custom-element' | 'custom-attribute' = 'custom-element';

  // Components tab data
  componentSnapshot: AureliaComponentSnapshot = { tree: [], flat: [] };
  allAureliaObjects: AureliaInfo[] = undefined;
  componentTree: ComponentNode[] = [];
  viewMode: 'tree' | 'list' = 'tree';
  selectedBreadcrumb: ComponentNode[] = [];
  selectedComponentId: string = undefined;
  searchQuery: string = '';
  isElementPickerActive: boolean = false;
  // Preference: follow Chrome Elements selection automatically
  followChromeSelection: boolean = true;
  // UI: animate refresh icon when user-triggered refresh happens
  isRefreshing: boolean = false;
  propertyRowsRevision: number = 0;

  // Interaction timeline
  interactionLog: EventInteractionRecord[] = [];
  interactionLoading: boolean = false;
  interactionError: string | null = null;
  private interactionSignature: string = '';
  private runtimeInteractionListener: ((msg: any, sender: any) => void) | null = null;

  // Property watching
  private propertyChangeListener: ((msg: any, sender: any) => void) | null = null;
  private treeChangeListener: ((msg: any, sender: any) => void) | null = null;

  // Detection status
  aureliaDetected: boolean = false;
  aureliaVersion: number | null = null;
  detectionState: 'checking' | 'detected' | 'not-found' | 'disabled' = 'checking';

  private debugHost: DebugHost = resolve(DebugHost);
  private plat: IPlatform = resolve(IPlatform);

  attaching() {
    this.debugHost.attach(this);
    this.isDarkTheme = (chrome?.devtools?.panels as any)?.themeName === 'dark';
    [].join();

    if (this.isDarkTheme) {
      document.querySelector('html').style.background = '#202124';
    }

    // Restore persisted preference for following Elements selection
    try {
      const persisted = localStorage.getItem('au-devtools.followChromeSelection');
      if (persisted != null) this.followChromeSelection = persisted === 'true';
    } catch {}

    // Restore preferred view mode
    try {
      const persistedViewMode = localStorage.getItem('au-devtools.viewMode');
      if (persistedViewMode === 'tree' || persistedViewMode === 'list') {
        this.viewMode = persistedViewMode;
      }
    } catch {}

    // Wire interaction push stream from content script
    this.registerInteractionStream();

    // Wire property and tree change streams
    this.registerPropertyChangeStream();
    this.registerTreeChangeStream();

    // Check detection state set by devtools.js
    this.checkDetectionState();

    // Delay component loading to allow Aurelia hooks to install, then try regardless of detection flags
    setTimeout(() => {
      this.checkDetectionState();
      this.loadAllComponents();
    }, 1000);

    // Poll for detection state changes
    this.startDetectionPolling();
    this.refreshExternalPanels();
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
              case 'disabled':
                this.aureliaDetected = false;
                this.aureliaVersion = null;
                this.detectionState = 'disabled';
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
      if (this.detectionState === 'disabled') {
        return;
      }
      // Keep trying to load until we find components, regardless of detection flags
      if (!this.allAureliaObjects?.length) {
        this.loadAllComponents();
      } else {
        // Check for tree changes and reload if changed
        this.debugHost.checkComponentTreeChanges().then((hasChanged) => {
          if (hasChanged) {
            this.loadAllComponents();
          }
        });
      }
      this.refreshExternalPanels();
    }, 2000);
  }

  recheckAurelia() {
    this.checkDetectionState();
    if (this.aureliaDetected || this.detectionState === 'not-found') {
      this.loadAllComponents();
    }
  }

  // Tab management methods
  switchTab(tabId: string) {
    this.activeTab = tabId;
    if (this.isComponentTab(tabId)) {
      this.loadAllComponents();
    } else if (tabId === 'interactions') {
      this.loadInteractionLog(true);
    } else {
      this.refreshExternalPanels(true);
      this.notifyExternalSelection();
    }
  }

  get isExternalTabActive(): boolean {
    return this.isExternalTab(this.activeTab);
  }

  get activeExternalIcon(): string {
    return this.getActiveExternalPanel()?.icon || '🧩';
  }

  get activeExternalTitle(): string {
    return this.getActiveExternalPanel()?.label || 'Inspector';
  }

  get activeExternalDescription(): string | undefined {
    return this.getActiveExternalPanel()?.description;
  }

  get activeExternalResult(): PluginDevtoolsResult | undefined {
    return this.getActiveExternalPanel();
  }

  get activeExternalError(): string | null {
    const panel = this.getActiveExternalPanel();
    if (!panel) {
      return null;
    }
    return panel.status === 'error' ? panel.error || 'Panel error' : null;
  }

  get isActiveExternalLoading(): boolean {
    const panelId = this.getExternalPanelIdFromTab(this.activeTab);
    if (!panelId) {
      return false;
    }
    return !!this.externalPanelLoading[panelId];
  }

  refreshActiveExternalTab() {
    if (!this.isExternalTabActive) {
      return;
    }
    this.requestExternalPanelRefresh();
  }

  private getActiveExternalPanel(): ExternalPanelDefinition | undefined {
    const panelId = this.getExternalPanelIdFromTab(this.activeTab);
    if (!panelId) {
      return undefined;
    }
    return this.externalPanels[panelId];
  }

  private isCoreTab(tabId: string): tabId is CoreTabId {
    return tabId === 'all' || tabId === 'components' || tabId === 'attributes' || tabId === 'interactions';
  }

  private isComponentTab(tabId: string): tabId is ComponentTabId {
    return tabId === 'all' || tabId === 'components' || tabId === 'attributes';
  }

  private isExternalTab(tabId: string): boolean {
    return !!this.getExternalPanelIdFromTab(tabId);
  }

  private getExternalPanelIdFromTab(tabId: string): string | null {
    if (!tabId) {
      return null;
    }
    if (tabId.startsWith('external:')) {
      return tabId.slice('external:'.length);
    }
    const panel = this.externalTabs.find((tab) => tab.id === tabId && tab.panelId);
    return panel?.panelId || null;
  }

  refreshExternalPanels(force = false): Promise<void> {
    if (this.detectionState === 'disabled') {
      return Promise.resolve();
    }

    return this.debugHost
      .getExternalPanelsSnapshot()
      .then((snapshot: ExternalPanelSnapshot) => {
        if (!snapshot) {
          return;
        }
        if (!force && snapshot.version === this.externalPanelsVersion) {
          return;
        }
        this.externalPanelsVersion = snapshot.version;
        this.applyExternalPanels(snapshot);
      })
      .catch((error) => {
        console.warn('Failed to load external Aurelia panels', error);
      });
  }

  private applyExternalPanels(snapshot: ExternalPanelSnapshot) {
    const nextPanels: Record<string, ExternalPanelDefinition> = {};
    const tabs = (snapshot.panels || [])
      .filter((panel) => panel && panel.id)
      .map((panel) => {
        nextPanels[panel.id] = panel;
        this.externalPanelLoading[panel.id] = false;
        return {
          id: `external:${panel.id}`,
          label: panel.label || panel.id,
          icon: panel.icon || '🧩',
          kind: 'external' as const,
          panelId: panel.id,
          description: panel.description,
          order: panel.order ?? 0,
        };
      })
      .sort((a, b) => {
        const orderDiff = (a.order ?? 0) - (b.order ?? 0);
        if (orderDiff !== 0) {
          return orderDiff;
        }
        return a.label.localeCompare(b.label);
      });

    this.externalPanels = nextPanels;
    this.externalTabs = tabs;
    this.tabs = [...this.coreTabs, ...this.externalTabs];

    if (!this.tabs.some((tab) => tab.id === this.activeTab)) {
      this.activeTab = 'all';
    }
  }

  private requestExternalPanelRefresh() {
    if (this.detectionState === 'disabled') {
      return;
    }
    const panelId = this.getExternalPanelIdFromTab(this.activeTab);
    if (!panelId) {
      return;
    }
    this.setExternalPanelLoading(panelId, true);
    this.debugHost.emitExternalPanelEvent('aurelia-devtools:request-panel', {
      id: panelId,
      context: this.buildExternalPanelContext(),
    });
    this.scheduleExternalPanelRefresh();
  }

  private scheduleExternalPanelRefresh(delay = 150) {
    if (this.externalRefreshHandle) {
      clearTimeout(this.externalRefreshHandle);
    }
    this.externalRefreshHandle = setTimeout(() => {
      this.refreshExternalPanels(true);
      this.externalRefreshHandle = null;
    }, delay);
  }

  private setExternalPanelLoading(panelId: string, isLoading: boolean) {
    this.externalPanelLoading[panelId] = isLoading;
  }

  private buildExternalPanelContext(): ExternalPanelContext {
    const selectedNode = this.selectedComponentId ? this.findComponentById(this.selectedComponentId) : null;
    const selectedInfo = selectedNode ? selectedNode.data.info : null;

    return {
      selectedComponentId: this.selectedComponentId,
      selectedNodeType: selectedNode?.type,
      selectedDomPath: selectedNode?.domPath,
      aureliaVersion: this.aureliaVersion,
      selectedInfo,
    };
  }

  private notifyExternalSelection() {
    this.debugHost.emitExternalPanelEvent('aurelia-devtools:selection-changed', this.buildExternalPanelContext());
  }

  // Component discovery methods
  loadAllComponents(): Promise<void> {
    if (this.detectionState === 'disabled') {
      this.handleComponentSnapshot({ tree: [], flat: [] });
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this.plat.queueMicrotask(() => {
        this.debugHost
          .getAllComponents()
          .then((snapshot) => {
            this.handleComponentSnapshot(snapshot);
            this.refreshExternalPanels();

            const hasData = !!(snapshot?.tree?.length || snapshot?.flat?.length);
            if (hasData) {
              this.aureliaDetected = true;
              this.detectionState = 'detected';
            }

            resolve();
          })
          .catch((error) => {
            console.warn('Failed to load components:', error);
            this.handleComponentSnapshot({ tree: [], flat: [] });
            reject(error);
          });
      });
    });
  }

  // Interaction timeline
  async loadInteractionLog(force = false, silent = false): Promise<void> {
    if (this.interactionLoading && !force && !silent) return;

    const previousSignature = this.interactionSignature;
    if (!silent) {
      this.interactionLoading = true;
      this.interactionError = null;
    }
    try {
      const log = await this.debugHost.getInteractionLog();
      const sorted = Array.isArray(log)
        ? [...log].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        : [];
      const signature = sorted.map((e) => `${e.id}:${e.timestamp}`).join('|');
      this.interactionSignature = signature;
      if (signature !== previousSignature) {
        this.interactionLog = sorted;
      }
    } catch (error) {
      if (!silent) {
        this.interactionError = (error as any)?.message || String(error);
        this.interactionLog = [];
      }
    } finally {
      if (!silent) {
        this.interactionLoading = false;
      }
    }
  }

  async replayInteraction(id: string): Promise<void> {
    if (!id) return;
    try {
      await this.debugHost.replayInteraction(id);
    } catch (error) {
      console.warn('Replay failed', error);
    }
  }

  async applyInteractionSnapshot(id: string, phase: InteractionPhase): Promise<void> {
    if (!id) return;
    try {
      await this.debugHost.applyInteractionSnapshot(id, phase);
    } catch (error) {
      console.warn('Apply snapshot failed', error);
    }
  }

  async clearInteractionLog(): Promise<void> {
    // Optimistically clear local log for immediate UI feedback
    this.interactionLog = [];
    this.interactionSignature = '';
    this.interactionError = null;

    try {
      await this.debugHost.clearInteractionLog();
    } catch (error) {
      console.warn('Clear interaction log failed', error);
    }
  }

  get hasInteractions(): boolean {
    return Array.isArray(this.interactionLog) && this.interactionLog.length > 0;
  }

  get formattedInteractionLog(): EventInteractionRecord[] {
    return this.interactionLog || [];
  }

  private registerInteractionStream() {
    if (!(chrome?.runtime?.onMessage?.addListener)) return;
    this.runtimeInteractionListener = (message: any) => {
      if (message && message.type === 'au-devtools:interaction' && message.entry) {
        this.handleIncomingInteraction(message.entry as EventInteractionRecord);
      }
    };
    chrome.runtime.onMessage.addListener(this.runtimeInteractionListener);
  }

  private handleIncomingInteraction(entry: EventInteractionRecord) {
    if (!entry || !entry.id) return;
    const existing = this.interactionLog.find((e) => e.id === entry.id);
    if (existing) return;
    const next = [entry, ...(this.interactionLog || [])];
    next.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    this.interactionLog = next;
    this.interactionSignature = next.map((e) => `${e.id}:${e.timestamp}`).join('|');
  }

  private registerPropertyChangeStream() {
    if (!(chrome?.runtime?.onMessage?.addListener)) return;
    this.propertyChangeListener = (message: any) => {
      if (message && message.type === 'au-devtools:property-change') {
        this.onPropertyChanges(message.changes, message.snapshot);
      }
    };
    chrome.runtime.onMessage.addListener(this.propertyChangeListener);
  }

  private registerTreeChangeStream() {
    if (!(chrome?.runtime?.onMessage?.addListener)) return;
    this.treeChangeListener = (message: any) => {
      if (message && message.type === 'au-devtools:tree-change') {
        this.loadAllComponents();
      }
    };
    chrome.runtime.onMessage.addListener(this.treeChangeListener);
  }

  onPropertyChanges(changes: PropertyChangeRecord[], snapshot: PropertySnapshot) {
    if (!changes || !changes.length || !this.selectedElement) return;

    const selectedKey = this.selectedElement.key || this.selectedElement.name;
    if (!selectedKey || snapshot?.componentKey !== selectedKey) return;

    let hasUpdates = false;

    for (const change of changes) {
      const bindable = this.selectedElement.bindables?.find((b) => b.name === change.propertyName);
      if (bindable) {
        bindable.value = change.newValue;
        hasUpdates = true;
        continue;
      }

      const property = this.selectedElement.properties?.find((p) => p.name === change.propertyName);
      if (property) {
        property.value = change.newValue;
        hasUpdates = true;
      }
    }

    if (hasUpdates) {
      this.refreshPropertyBindings();
    }
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

  public handleComponentSnapshot(snapshot: AureliaComponentSnapshot) {
    const safeSnapshot = snapshot || { tree: [], flat: [] };
    this.componentSnapshot = safeSnapshot;

    const rawTree = (safeSnapshot.tree && safeSnapshot.tree.length)
      ? safeSnapshot.tree
      : this.convertFlatListToTreeNodes(safeSnapshot.flat || []);

    const fallbackFlat = (safeSnapshot.flat && safeSnapshot.flat.length)
      ? safeSnapshot.flat
      : this.flattenRawTree(rawTree);

    this.allAureliaObjects = fallbackFlat;
    this.componentTree = this.mapRawTreeToComponentNodes(rawTree);

    if (this.selectedComponentId) {
      const existingNode = this.findComponentById(this.selectedComponentId);
      if (existingNode) {
        this.applySelectionFromNode(existingNode);
      } else {
        this.debugHost.stopPropertyWatching();
        this.selectedComponentId = undefined;
        this.selectedElement = undefined;
        this.selectedElementAttributes = undefined;
        this.selectedBreadcrumb = [];
        this.selectedNodeType = 'custom-element';
      }
    } else {
      this.selectedBreadcrumb = [];
      this.selectedNodeType = 'custom-element';
    }
  }

  private convertFlatListToTreeNodes(components: AureliaInfo[]): AureliaComponentTreeNode[] {
    if (!components || !components.length) {
      return [];
    }

    const nodes: AureliaComponentTreeNode[] = [];
    const seenElements = new Set<string>();

    components.forEach((component, index) => {
      const elementInfo = component?.customElementInfo ?? null;
      const attrs = this.normalizeAttributes(component?.customAttributesInfo ?? [], elementInfo);

      if (elementInfo) {
        const elementId = elementInfo.key || elementInfo.name || `flat-${index}`;
        if (!seenElements.has(elementId)) {
          nodes.push({
            id: elementId,
            domPath: '',
            tagName: elementInfo.name ?? null,
            customElementInfo: elementInfo,
            customAttributesInfo: attrs,
            children: [],
          });
          seenElements.add(elementId);
        }
      } else if (attrs.length) {
        attrs.forEach((attr, attrIndex) => {
          nodes.push({
            id: `flat-attr-${index}-${attrIndex}`,
            domPath: '',
            tagName: null,
            customElementInfo: null,
            customAttributesInfo: [attr],
            children: [],
          });
        });
      }
    });

    return nodes;
  }

  private mapRawTreeToComponentNodes(rawNodes: AureliaComponentTreeNode[]): ComponentNode[] {
    if (!rawNodes || !rawNodes.length) {
      return [];
    }

    const mapped: ComponentNode[] = [];
    for (const rawNode of rawNodes) {
      mapped.push(...this.transformRawNode(rawNode, 'root'));
    }
    return this.sortComponentNodes(mapped);
  }

  private transformRawNode(rawNode: AureliaComponentTreeNode, parentId: string): ComponentNode[] {
    if (!rawNode) return [];

    const elementInfo = rawNode.customElementInfo ?? null;
    const normalizedAttributes = this.normalizeAttributes(rawNode.customAttributesInfo || [], elementInfo);
    const rawChildren = rawNode.children || [];

    if (elementInfo) {
      const baseId = rawNode.id || `${parentId}-${Math.random().toString(36).slice(2)}`;
      const elementName = elementInfo.name || rawNode.tagName || 'unknown-element';

      const elementNode: ComponentNode = {
        id: baseId,
        name: elementName,
        type: 'custom-element',
        domPath: rawNode.domPath || '',
        tagName: rawNode.tagName || null,
        children: [],
        data: {
          kind: 'element',
          raw: rawNode,
          info: {
            customElementInfo: elementInfo,
            customAttributesInfo: normalizedAttributes,
          },
        },
        expanded: false,
        hasAttributes: normalizedAttributes.length > 0,
      };

      const attributeChildren = normalizedAttributes.map((attr, index) => this.createAttributeNode(baseId, rawNode, attr, index));
      elementNode.children.push(...attributeChildren);

      for (const child of rawChildren) {
        elementNode.children.push(...this.transformRawNode(child, baseId));
      }

      elementNode.children = this.sortComponentNodes(elementNode.children);
      elementNode.hasAttributes = elementNode.children.some(child => child.type === 'custom-attribute');

      return [elementNode];
    }

    const nodes: ComponentNode[] = [];
    normalizedAttributes.forEach((attr, index) => {
      nodes.push(this.createAttributeNode(parentId, rawNode, attr, index));
    });

    for (const child of rawChildren) {
      nodes.push(...this.transformRawNode(child, parentId));
    }

    return nodes;
  }

  private createAttributeNode(parentId: string, owner: AureliaComponentTreeNode, attr: IControllerInfo, index: number): ComponentNode {
    const attrName = attr?.name || 'custom-attribute';
    const ownerIdentifier = String(owner?.id || owner?.domPath || parentId || 'attr-owner');
    const attrIdentifier = String(attr?.key || attr?.name || `attr-${index}`);
    const nodeId = `${ownerIdentifier}::${attrIdentifier}::${index}`;
    return {
      id: nodeId,
      name: attrName,
      type: 'custom-attribute',
      domPath: owner?.domPath || '',
      tagName: owner?.tagName || null,
      children: [],
      data: {
        kind: 'attribute',
        raw: attr,
        owner,
        info: {
          customElementInfo: null,
          customAttributesInfo: attr ? [attr] : [],
        },
      },
      expanded: false,
      hasAttributes: false,
    };
  }

  private flattenRawTree(rawNodes: AureliaComponentTreeNode[]): AureliaInfo[] {
    const collected: AureliaInfo[] = [];

    const walk = (nodes: AureliaComponentTreeNode[]) => {
      for (const node of nodes) {
        if (node.customElementInfo || (node.customAttributesInfo && node.customAttributesInfo.length)) {
          collected.push({
            customElementInfo: node.customElementInfo,
            customAttributesInfo: node.customAttributesInfo || [],
          });
        }
        if (node.children && node.children.length) {
          walk(node.children);
        }
      }
    };

    walk(rawNodes || []);
    return collected;
  }

  get filteredComponentTreeByTab(): ComponentNode[] {
    if (!this.isComponentTab(this.activeTab)) {
      return [];
    }

    // First apply tab filtering to the full tree
    let tabFilteredTree: ComponentNode[];

    switch (this.activeTab as ComponentTabId) {
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

  get visibleComponentNodes(): ComponentDisplayNode[] {
    const roots = this.filteredComponentTreeByTab;
    if (!roots || !roots.length) {
      return [];
    }

    const searchActive = !!this.searchQuery.trim();
    const items: ComponentDisplayNode[] = [];

    const traverse = (nodes: ComponentNode[], depth: number) => {
      for (const node of nodes) {
        items.push({ node, depth });

        const hasChildren = node.children && node.children.length > 0;
        if (!hasChildren) continue;

        const shouldShowChildren = this.viewMode === 'list' || node.expanded || searchActive;
        if (shouldShowChildren) {
          traverse(node.children, depth + 1);
        }
      }
    };

    traverse(roots, 0);
    return items;
  }

  get breadcrumbSegments(): BreadcrumbSegment[] {
    if (!this.selectedBreadcrumb || !this.selectedBreadcrumb.length) {
      return [];
    }

    return this.selectedBreadcrumb.map((node) => ({
      id: node.id,
      label: node.type === 'custom-element' ? `<${node.name}>` : `@${node.name}`,
      type: node.type,
    }));
  }

  get totalComponentNodeCount(): number {
    const countNodes = (nodes: ComponentNode[]): number => {
      return nodes.reduce((total, node) => total + 1 + countNodes(node.children || []), 0);
    };

    return countNodes(this.componentTree || []);
  }

  private normalizeAttributes(attrs: IControllerInfo[], elementInfo: IControllerInfo | null | undefined): IControllerInfo[] {
    if (!attrs || !attrs.length) {
      return [];
    }

    const seen = new Set<string>();

    return attrs.filter((attr) => {
      if (!attr) return false;
      const key = (attr.key || attr.name || '').toString().toLowerCase();
      const sameAsElement = !!(elementInfo && ((attr.key && elementInfo.key && attr.key === elementInfo.key) || (attr.name && elementInfo.name && attr.name === elementInfo.name)));
      if (sameAsElement) return false;
      if (key && seen.has(key)) return false;
      if (key) {
        seen.add(key);
      }
      return true;
    });
  }

  private sortComponentNodes(nodes: ComponentNode[]): ComponentNode[] {
    if (!nodes || !nodes.length) return [];

    const cloned = nodes.map((node) => ({
      ...node,
      children: this.sortComponentNodes(node.children || []),
    }));

    cloned.sort((a, b) => {
      if (a.type === b.type) {
        return a.name.localeCompare(b.name);
      }
      return a.type === 'custom-element' ? -1 : 1;
    });

    return cloned;
  }

  private filterTreeByType(nodes: ComponentNode[], type: 'custom-element' | 'custom-attribute'): ComponentNode[] {
    if (!nodes || !nodes.length) {
      return [];
    }

    const filtered: ComponentNode[] = [];

    for (const node of nodes) {
      const filteredChildren = this.filterTreeByType(node.children || [], type);

      if (node.type === type) {
        filtered.push({
          ...node,
          children: filteredChildren,
        });
        continue;
      }

      if (filteredChildren.length) {
        filtered.push(...filteredChildren);
      }
    }

    return filtered;
  }

  selectComponent(componentId: string) {
    const component = this.findComponentById(componentId);
    if (component) {
      this.applySelectionFromNode(component);
    }
  }

  private applySelectionFromNode(node: ComponentNode) {
    this.selectedComponentId = node.id;
    this.selectedNodeType = node.type;

    if (node.data.kind === 'attribute') {
      const attributeInfo = node.data.raw;
      this.selectedElement = attributeInfo || null;
      this.selectedElement.bindables = this.selectedElement?.bindables || [];
      this.selectedElement.properties = this.selectedElement?.properties || [];
      this.selectedElementAttributes = [];
      this.markPropertyRowsDirty();
    } else {
      const elementInfo = node.data.info.customElementInfo;
      const attributeInfos = node.data.info.customAttributesInfo || [];
      this.selectedElement = elementInfo || null;
      this.selectedElement.bindables = this.selectedElement?.bindables || [];
      this.selectedElement.properties = this.selectedElement?.properties || [];
      this.selectedElementAttributes = attributeInfos.filter((attr) => {
        try {
          if (!attr) return false;
          const sameKey = !!(attr.key && elementInfo?.key && attr.key === elementInfo.key);
          const sameName = !!(attr.name && elementInfo?.name && attr.name === elementInfo.name);
          return !(sameKey || sameName);
        } catch {
          return true;
        }
      });
      this.markPropertyRowsDirty();
    }

    const path = this.findNodePathById(node.id);
    if (path && path.length) {
      this.selectedBreadcrumb = [...path];
      path.forEach((ancestor) => {
        if (ancestor.data.kind === 'element') {
          ancestor.expanded = true;
        }
      });
    } else {
      this.selectedBreadcrumb = [node];
    }

    // Start watching the selected component for property changes
    const componentKey = this.selectedElement?.key || this.selectedElement?.name;
    if (componentKey) {
      this.debugHost.startPropertyWatching({ componentKey, pollInterval: 500 });
    }

    if (this.isExternalTabActive) {
      this.scheduleExternalPanelRefresh();
    }
    this.notifyExternalSelection();
  }

  private findNodePathById(nodeId: string): ComponentNode[] | null {
    const path: ComponentNode[] = [];

    const traverse = (nodes: ComponentNode[]): boolean => {
      for (const node of nodes) {
        path.push(node);
        if (node.id === nodeId) {
          return true;
        }
        if (node.children && node.children.length && traverse(node.children)) {
          return true;
        }
        path.pop();
      }
      return false;
    };

    const found = traverse(this.componentTree || []);
    return found ? [...path] : null;
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

  handleExpandToggle(node: ComponentNode, event?: Event) {
    event?.stopPropagation();
    if (!node?.id) {
      return;
    }
    this.toggleComponentExpansion(node.id);
  }

  toggleComponentExpansion(componentId: string) {
    const component = this.findComponentById(componentId);
    if (component) {
      component.expanded = !component.expanded;
    }
  }

  handlePropertyRowClick(property: any, event?: Event) {
    if (!property?.canExpand || property?.isEditing) {
      return;
    }

    const target = event?.target as HTMLElement | null;
    if (!target) return;

    if (target.closest('.property-value-wrapper') || target.closest('.property-editor')) {
      return;
    }

    if (target.closest('.expand-button')) {
      return;
    }

    event?.stopPropagation();
    this.togglePropertyExpansion(property);
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
    const queryVariants = getNamingVariants(query);

    for (const node of nodes) {
      const nodeVariants = getNamingVariants(node.name);
      const matchesSearch =
        nodeVariants.some((variant) =>
          queryVariants.some((q) => variant.includes(q))
        ) ||
        node.type.toLowerCase().includes(query);

      const filteredChildren = this.filterComponentTree(node.children, query);

      if (matchesSearch || filteredChildren.length > 0) {
        const filteredNode: ComponentNode = {
          ...node,
          children: filteredChildren,
          expanded: filteredChildren.length > 0 || node.expanded,
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
    const info = component.data.info;
    this.debugHost.highlightComponent({
      name: component.name,
      type: component.type,
      ...info,
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
      this.applySelectionFromNode(foundComponent);
    } else {
      // If not found, refresh components and try again
      this.loadAllComponents().then(() => {
        const foundComponentAfterRefresh =
          this.findComponentInTreeByInfo(componentInfo);
        if (foundComponentAfterRefresh) {
          this.applySelectionFromNode(foundComponentAfterRefresh);
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

  toggleViewMode() {
    const nextMode = this.viewMode === 'tree' ? 'list' : 'tree';
    this.setViewMode(nextMode);
  }

  setViewMode(mode: 'tree' | 'list') {
    if (this.viewMode === mode) {
      return;
    }
    this.viewMode = mode;
    try {
      localStorage.setItem('au-devtools.viewMode', mode);
    } catch {}
  }

  revealInElements() {
    const node = this.findComponentById(this.selectedComponentId);
    if (!node) return;
    const info = node.data.info;
    this.debugHost.revealInElements({
      name: node.name,
      type: node.type,
      ...info,
    });
  }

  private findComponentInTreeByInfo(
    componentInfo: AureliaInfo
  ): ComponentNode | undefined {
    if (!componentInfo) return undefined;

    const targetElement = componentInfo.customElementInfo || null;
    const targetAttributes = componentInfo.customAttributesInfo || [];
    const domPath = (componentInfo as any)?.__auDevtoolsDomPath as string | undefined;

    if (domPath) {
      const byPath = this.findNodeByDomPath(domPath, targetElement, targetAttributes);
      if (byPath) {
        return byPath;
      }
    }

    return this.searchNodesForMatch(this.componentTree, targetElement, targetAttributes);
  }

  private findNodeByDomPath(
    domPath: string,
    targetElement: IControllerInfo | null,
    targetAttributes: IControllerInfo[]
  ): ComponentNode | undefined {
    if (!domPath) return undefined;

    let attributeMatch: ComponentNode | undefined;
    let elementMatch: ComponentNode | undefined;

    const visit = (nodes: ComponentNode[]) => {
      for (const node of nodes) {
        if (node.domPath === domPath) {
          if (node.data.kind === 'attribute' && targetAttributes.length && this.nodeMatchesAttribute(node, targetAttributes)) {
            attributeMatch = attributeMatch || node;
          }
          if (node.data.kind === 'element' && this.nodeMatchesElement(node, targetElement)) {
            elementMatch = elementMatch || node;
          }
        }

        if (node.children?.length) {
          visit(node.children);
        }
      }
    };

    visit(this.componentTree || []);

    if (targetElement && elementMatch) {
      return elementMatch;
    }

    if (!targetElement && targetAttributes.length) {
      return attributeMatch || elementMatch;
    }

    return elementMatch || attributeMatch;
  }

  private searchNodesForMatch(
    nodes: ComponentNode[],
    targetElement: IControllerInfo | null,
    targetAttributes: IControllerInfo[]
  ): ComponentNode | undefined {
    for (const node of nodes) {
      if (this.nodeMatchesTarget(node, targetElement, targetAttributes)) {
        return node;
      }

      const foundInChildren = this.searchNodesForMatch(node.children || [], targetElement, targetAttributes);
      if (foundInChildren) {
        return foundInChildren;
      }
    }

    return undefined;
  }

  private nodeMatchesTarget(
    node: ComponentNode,
    targetElement: IControllerInfo | null,
    targetAttributes: IControllerInfo[]
  ): boolean {
    if (node.data.kind === 'element') {
      if (targetElement && this.nodeMatchesElement(node, targetElement)) {
        return true;
      }

      if (!targetElement && targetAttributes.length) {
        return this.nodeContainsAnyAttribute(node.data.info.customAttributesInfo || [], targetAttributes);
      }
    }

    if (node.data.kind === 'attribute') {
      const attrInfo = node.data.raw;
      return targetAttributes.some((candidate) => this.isSameControllerInfo(attrInfo, candidate));
    }

    return false;
  }

  private nodeMatchesElement(node: ComponentNode, targetElement: IControllerInfo | null): boolean {
    if (!targetElement || node.data.kind !== 'element') {
      return false;
    }

    const nodeElement = node.data.info.customElementInfo;
    return this.isSameControllerInfo(nodeElement, targetElement);
  }

  private nodeMatchesAttribute(node: ComponentNode, targetAttributes: IControllerInfo[]): boolean {
    if (node.data.kind !== 'attribute' || !targetAttributes?.length) {
      return false;
    }

    const attributeInfo = node.data.raw as IControllerInfo;
    return targetAttributes.some((candidate) => this.isSameControllerInfo(attributeInfo, candidate));
  }

  private nodeContainsAnyAttribute(
    nodeAttributes: IControllerInfo[],
    targetAttributes: IControllerInfo[]
  ): boolean {
    if (!nodeAttributes?.length || !targetAttributes?.length) {
      return false;
    }

    return targetAttributes.some((candidate) =>
      nodeAttributes.some((existing) => this.isSameControllerInfo(existing, candidate))
    );
  }

  private isSameControllerInfo(a: IControllerInfo | null | undefined, b: IControllerInfo | null | undefined): boolean {
    if (!a || !b) return false;

    if (a.key && b.key && a.key === b.key) {
      return true;
    }

    if (a.name && b.name && a.name === b.name) {
      return true;
    }

    const aAliases = Array.isArray(a.aliases) ? a.aliases : [];
    const bAliases = Array.isArray(b.aliases) ? b.aliases : [];

    return aAliases.some((alias: any) => alias && (alias === b.name || bAliases.includes(alias)))
      || bAliases.some((alias: any) => alias && alias === a.name);
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
    this.markPropertyRowsDirty();
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
      this.markPropertyRowsDirty();
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
            this.markPropertyRowsDirty();
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

  private markPropertyRowsDirty() {
    this.propertyRowsRevision++;
  }

  getPropertyRows(properties?: Property[], _revision: number = this.propertyRowsRevision): PropertyRow[] {
    if (!properties || !properties.length) {
      return [];
    }
    return this.flattenProperties(properties, 0);
  }

  private flattenProperties(properties: Property[], depth: number): PropertyRow[] {
    const rows: PropertyRow[] = [];
    for (const prop of properties) {
      if (!prop) continue;
      rows.push({ property: prop, depth });
      if (prop.isExpanded && prop.expandedValue?.properties?.length) {
        rows.push(...this.flattenProperties(prop.expandedValue.properties, depth + 1));
      }
    }
    return rows;
  }
}

interface BreadcrumbSegment {
  id: string;
  label: string;
  type: 'custom-element' | 'custom-attribute';
}

interface PropertyRow {
  property: Property;
  depth: number;
}

interface ComponentNode {
  id: string;
  name: string;
  type: 'custom-element' | 'custom-attribute';
  domPath: string;
  tagName: string | null;
  children: ComponentNode[];
  data: ComponentNodeData;
  expanded: boolean;
  hasAttributes: boolean;
}

type ComponentNodeData =
  | {
      kind: 'element';
      raw: AureliaComponentTreeNode;
      info: AureliaInfo;
    }
  | {
      kind: 'attribute';
      raw: IControllerInfo;
      owner: AureliaComponentTreeNode;
      info: AureliaInfo;
    };

interface ComponentDisplayNode {
  node: ComponentNode;
  depth: number;
}

type ComponentTabId = 'all' | 'components' | 'attributes';
type CoreTabId = ComponentTabId | 'interactions';

interface DevtoolsTabDefinition {
  id: string;
  label: string;
  icon: string;
  kind: 'core' | 'external';
  panelId?: string;
  description?: string;
  order?: number;
}

export class StringifyValueConverter implements ValueConverterInstance {
  toView(value: unknown) {
    return JSON.stringify(value);
  }
}

function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function toPascalCase(str: string): string {
  return str
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function getNamingVariants(name: string): string[] {
  const lower = name.toLowerCase();
  const kebab = toKebabCase(name);
  const pascal = toPascalCase(kebab);
  const camel = toCamelCase(kebab);
  const variants = new Set([lower, kebab.toLowerCase(), pascal.toLowerCase(), camel.toLowerCase()]);
  return [...variants];
}
