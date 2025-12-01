import { ICustomElementViewModel, IPlatform } from 'aurelia';
import { resolve } from '@aurelia/kernel';
import { SidebarDebugHost } from './sidebar-debug-host';
import {
  AureliaInfo,
  ComponentTreeNode,
  ComponentTreeRow,
  ComputedPropertyInfo,
  DISnapshot,
  EnhancedDISnapshot,
  EventInteractionRecord,
  IControllerInfo,
  LifecycleHooksSnapshot,
  Property,
  PropertyChangeRecord,
  PropertySnapshot,
  RouteSnapshot,
  SlotSnapshot,
  TemplateBinding,
  TemplateControllerInfo,
  TemplateSnapshot,
} from '../shared/types';

export class SidebarApp implements ICustomElementViewModel {
  isDarkTheme = false;

  // Detection state
  aureliaDetected = false;
  aureliaVersion: number | null = null;
  detectionState: 'checking' | 'detected' | 'not-found' | 'disabled' = 'checking';
  extensionInvalidated = false;

  // Selected component
  selectedElement: IControllerInfo | null = null;
  selectedElementAttributes: IControllerInfo[] = [];
  selectedNodeType: 'custom-element' | 'custom-attribute' = 'custom-element';
  selectedElementTagName: string | null = null;
  isShowingBindingContext = false;

  // Element picker
  isElementPickerActive = false;
  followChromeSelection = true;

  // Component tree
  componentTree: ComponentTreeNode[] = [];
  expandedTreeNodes: Set<string> = new Set();
  selectedTreeNodeKey: string | null = null;
  isTreePanelExpanded = true;
  treeRevision = 0;

  // Timeline / Interaction recorder
  isRecording = false;
  timelineEvents: EventInteractionRecord[] = [];
  expandedTimelineEvents: Set<string> = new Set();
  private interactionListener: ((msg: any) => void) | null = null;

  // Search
  searchQuery = '';
  searchResults: SearchResult[] = [];
  isSearchOpen = false;

  // Collapsible sections state - use object for Aurelia reactivity
  expandedSections: Record<string, boolean> = {
    bindables: true,
    properties: true,
    controller: false,
    attributes: false,
    lifecycle: false,
    computed: false,
    dependencies: false,
    route: false,
    slots: false,
    expression: false,
    timeline: false,
    template: false,
  };

  // Enhanced inspection
  lifecycleHooks: LifecycleHooksSnapshot | null = null;
  computedProperties: ComputedPropertyInfo[] = [];
  dependencies: DISnapshot | null = null;
  routeInfo: RouteSnapshot | null = null;
  slotInfo: SlotSnapshot | null = null;

  // Template debugger
  templateSnapshot: TemplateSnapshot | null = null;
  expandedBindings: Set<string> = new Set();
  expandedControllers: Set<string> = new Set();

  // Enhanced DI inspection (Aurelia 2 only)
  enhancedDI: EnhancedDISnapshot | null = null;
  showAvailableServices = false;

  // Expression evaluation
  expressionInput = '';
  expressionResult = '';
  expressionResultType = '';
  expressionError = '';
  expressionHistory: string[] = [];

  // Property editing
  copiedPropertyId: string | null = null;
  propertyRowsRevision = 0;

  // Property change listener
  private propertyChangeListener: ((msg: any, sender: any) => void) | null = null;

  private debugHost: SidebarDebugHost = resolve(SidebarDebugHost);
  private plat: IPlatform = resolve(IPlatform);

  attaching() {
    this.debugHost.attach(this);
    this.isDarkTheme = (chrome?.devtools?.panels as any)?.themeName === 'dark';

    if (this.isDarkTheme) {
      document.documentElement.classList.add('dark');
    }

    // Restore preferences
    try {
      const persisted = localStorage.getItem('au-devtools.followChromeSelection');
      if (persisted != null) this.followChromeSelection = persisted === 'true';
    } catch {}

    // Register property change listener
    this.registerPropertyChangeStream();

    // Register interaction listener for timeline
    this.registerInteractionStream();

    // Check detection state
    this.checkDetectionState();

    // Start detection polling
    this.startDetectionPolling();

    // Load component tree
    this.loadComponentTree();
  }

  detaching() {
    if (this.propertyChangeListener && chrome?.runtime?.onMessage?.removeListener) {
      chrome.runtime.onMessage.removeListener(this.propertyChangeListener);
    }
    if (this.interactionListener && chrome?.runtime?.onMessage?.removeListener) {
      chrome.runtime.onMessage.removeListener(this.interactionListener);
    }
  }

  private registerPropertyChangeStream() {
    if (!(chrome?.runtime?.onMessage?.addListener)) return;
    this.propertyChangeListener = (message: any) => {
      if (message?.type === 'au-devtools:property-change') {
        this.onPropertyChanges(message.changes, message.snapshot);
      }
    };
    chrome.runtime.onMessage.addListener(this.propertyChangeListener);
  }

  private registerInteractionStream() {
    if (!(chrome?.runtime?.onMessage?.addListener)) return;
    this.interactionListener = (message: any) => {
      if (message?.type === 'au-devtools:interaction' && this.isRecording) {
        this.timelineEvents = [...this.timelineEvents, message.entry];
      }
    };
    chrome.runtime.onMessage.addListener(this.interactionListener);
  }

  onPropertyChanges(changes: PropertyChangeRecord[], snapshot: PropertySnapshot) {
    if (!changes?.length || !this.selectedElement) return;

    const selectedKey = this.selectedElement.key || this.selectedElement.name;
    if (!selectedKey || snapshot?.componentKey !== selectedKey) return;

    let hasUpdates = false;

    for (const change of changes) {
      const bindable = this.selectedElement.bindables?.find(b => b.name === change.propertyName);
      if (bindable) {
        bindable.value = change.newValue;
        hasUpdates = true;
        continue;
      }

      const property = this.selectedElement.properties?.find(p => p.name === change.propertyName);
      if (property) {
        property.value = change.newValue;
        hasUpdates = true;
      }
    }

    if (hasUpdates) {
      this.markPropertyRowsDirty();
    }
  }

  checkDetectionState() {
    if (chrome?.devtools) {
      chrome.devtools.inspectedWindow.eval(
        `({
          state: window.__AURELIA_DEVTOOLS_DETECTION_STATE__,
          version: window.__AURELIA_DEVTOOLS_VERSION__
        })`,
        (result: { state: string; version: number }, isException?: any) => {
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
    setInterval(() => {
      if (this.checkExtensionInvalidated()) return;
      this.checkDetectionState();
    }, 2000);
  }

  checkExtensionInvalidated(): boolean {
    try {
      if (!chrome?.runtime?.id) {
        this.extensionInvalidated = true;
        return true;
      }
    } catch {
      this.extensionInvalidated = true;
      return true;
    }
    return false;
  }

  // Called by debug host when element is selected in Elements panel
  onElementPicked(componentInfo: AureliaInfo) {
    this.isElementPickerActive = false;
    this.debugHost.stopElementPicker();

    if (!componentInfo) {
      this.clearSelection();
      return;
    }

    const elementInfo = componentInfo.customElementInfo;
    const attributesInfo = componentInfo.customAttributesInfo || [];

    // Track the actual selected element and whether we're showing inherited binding context
    this.selectedElementTagName = (componentInfo as any).__selectedElement || null;
    this.isShowingBindingContext = !!(componentInfo as any).__isBindingContext;

    if (elementInfo) {
      this.selectedElement = elementInfo;
      this.selectedElement.bindables = this.selectedElement.bindables || [];
      this.selectedElement.properties = this.selectedElement.properties || [];
      this.selectedElementAttributes = attributesInfo;
      this.selectedNodeType = 'custom-element';
    } else if (attributesInfo.length > 0) {
      this.selectedElement = attributesInfo[0];
      this.selectedElement.bindables = this.selectedElement.bindables || [];
      this.selectedElement.properties = this.selectedElement.properties || [];
      this.selectedElementAttributes = [];
      this.selectedNodeType = 'custom-attribute';
    } else {
      this.clearSelection();
      return;
    }

    // Start watching for property changes
    const componentKey = this.selectedElement?.key || this.selectedElement?.name;
    if (componentKey) {
      this.debugHost.startPropertyWatching({ componentKey, pollInterval: 500 });
      this.selectedTreeNodeKey = componentKey;
    }

    // Load enhanced info
    this.loadEnhancedInfo();
    this.markPropertyRowsDirty();

    // Refresh tree if needed
    if (!this.componentTree?.length) {
      this.loadComponentTree();
    }
  }

  clearSelection() {
    this.debugHost.stopPropertyWatching();
    this.selectedElement = null;
    this.selectedElementAttributes = [];
    this.selectedElementTagName = null;
    this.isShowingBindingContext = false;
    this.clearEnhancedInfo();
  }

  // Section expansion
  toggleSection(sectionId: string) {
    this.expandedSections[sectionId] = !this.expandedSections[sectionId];
  }

  // Element picker
  toggleElementPicker() {
    this.isElementPickerActive = !this.isElementPickerActive;

    if (this.isElementPickerActive) {
      this.debugHost.startElementPicker();
    } else {
      this.debugHost.stopElementPicker();
    }
  }

  toggleFollowChromeSelection() {
    this.followChromeSelection = !this.followChromeSelection;
    try {
      localStorage.setItem('au-devtools.followChromeSelection', String(this.followChromeSelection));
    } catch {}
  }

  // Component tree
  async loadComponentTree(): Promise<void> {
    try {
      const tree = await this.debugHost.getComponentTree();
      this.componentTree = tree;
      this.treeRevision++;
    } catch {
      this.componentTree = [];
    }
  }

  toggleTreePanel(): void {
    this.isTreePanelExpanded = !this.isTreePanelExpanded;
  }

  toggleTreeNode(node: ComponentTreeNode, event?: Event): void {
    event?.stopPropagation();
    if (!node.hasChildren) return;

    const key = node.key;
    if (this.expandedTreeNodes.has(key)) {
      this.expandedTreeNodes.delete(key);
    } else {
      this.expandedTreeNodes.add(key);
    }
    this.treeRevision++;
  }

  selectTreeNode(node: ComponentTreeNode): void {
    this.selectedTreeNodeKey = node.key;
    this.debugHost.selectComponentByKey(node.key);
  }

  getTreeRows(_revision: number = this.treeRevision): ComponentTreeRow[] {
    if (!this.componentTree?.length) return [];
    return this.flattenTreeNodes(this.componentTree, 0);
  }

  private flattenTreeNodes(nodes: ComponentTreeNode[], depth: number): ComponentTreeRow[] {
    const rows: ComponentTreeRow[] = [];
    for (const node of nodes) {
      if (!node) continue;
      rows.push({ node, depth });
      if (this.expandedTreeNodes.has(node.key) && node.children?.length) {
        rows.push(...this.flattenTreeNodes(node.children, depth + 1));
      }
    }
    return rows;
  }

  isTreeNodeExpanded(node: ComponentTreeNode): boolean {
    return this.expandedTreeNodes.has(node.key);
  }

  isTreeNodeSelected(node: ComponentTreeNode): boolean {
    return this.selectedTreeNodeKey === node.key;
  }

  get hasComponentTree(): boolean {
    return this.componentTree.length > 0;
  }

  get componentTreeCount(): number {
    const countNodes = (nodes: ComponentTreeNode[]): number => {
      let count = 0;
      for (const node of nodes) {
        count++;
        if (node.children?.length) {
          count += countNodes(node.children);
        }
      }
      return count;
    };
    return countNodes(this.componentTree);
  }

  // Timeline / Interaction Recorder
  async startRecording(): Promise<void> {
    this.isRecording = true;
    await this.debugHost.startInteractionRecording();
  }

  async stopRecording(): Promise<void> {
    this.isRecording = false;
    await this.debugHost.stopInteractionRecording();
  }

  clearTimeline(): void {
    this.timelineEvents = [];
    this.expandedTimelineEvents.clear();
    this.debugHost.clearInteractionLog();
  }

  toggleTimelineEvent(event: EventInteractionRecord): void {
    const id = event.id;
    if (this.expandedTimelineEvents.has(id)) {
      this.expandedTimelineEvents.delete(id);
    } else {
      this.expandedTimelineEvents.add(id);
    }
    this.timelineEvents = [...this.timelineEvents];
  }

  isTimelineEventExpanded(event: EventInteractionRecord): boolean {
    return this.expandedTimelineEvents.has(event.id);
  }

  selectTimelineComponent(event: EventInteractionRecord): void {
    if (event.target?.componentKey) {
      this.debugHost.selectComponentByKey(event.target.componentKey);
    }
  }

  get hasTimelineEvents(): boolean {
    return this.timelineEvents.length > 0;
  }

  get timelineEventCount(): number {
    return this.timelineEvents.length;
  }

  formatTimelineTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const time = date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${time}.${ms}`;
  }

  getTimelineEventTypeClass(type: string): string {
    const typeMap: Record<string, string> = {
      'property-change': 'event-property',
      'lifecycle': 'event-lifecycle',
      'interaction': 'event-interaction',
      'binding': 'event-binding',
    };
    return typeMap[type] || 'event-default';
  }

  // Template Debugger
  get hasTemplateInfo(): boolean {
    return this.templateSnapshot !== null &&
           (this.templateSnapshot.bindings.length > 0 ||
            this.templateSnapshot.controllers.length > 0);
  }

  get templateBindings(): TemplateBinding[] {
    return this.templateSnapshot?.bindings || [];
  }

  get templateControllers(): TemplateControllerInfo[] {
    return this.templateSnapshot?.controllers || [];
  }

  get templateBindingsCount(): number {
    return this.templateSnapshot?.bindings?.length || 0;
  }

  get templateControllersCount(): number {
    return this.templateSnapshot?.controllers?.length || 0;
  }

  toggleBindingExpand(binding: TemplateBinding): void {
    if (this.expandedBindings.has(binding.id)) {
      this.expandedBindings.delete(binding.id);
    } else {
      this.expandedBindings.add(binding.id);
    }
    this.templateSnapshot = { ...this.templateSnapshot! };
  }

  isBindingExpanded(binding: TemplateBinding): boolean {
    return this.expandedBindings.has(binding.id);
  }

  toggleControllerExpand(controller: TemplateControllerInfo): void {
    if (this.expandedControllers.has(controller.id)) {
      this.expandedControllers.delete(controller.id);
    } else {
      this.expandedControllers.add(controller.id);
    }
    this.templateSnapshot = { ...this.templateSnapshot! };
  }

  isControllerExpanded(controller: TemplateControllerInfo): boolean {
    return this.expandedControllers.has(controller.id);
  }

  getBindingTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      'property': '&#8594;',
      'attribute': '&#64;',
      'interpolation': '&#36;{}',
      'listener': '&#9889;',
      'ref': '&#128279;',
      'let': '&#119897;',
    };
    return icons[type] || '&#8226;';
  }

  getBindingModeClass(mode: string): string {
    const classes: Record<string, string> = {
      'oneTime': 'mode-one-time',
      'toView': 'mode-to-view',
      'fromView': 'mode-from-view',
      'twoWay': 'mode-two-way',
      'default': 'mode-default',
    };
    return classes[mode] || 'mode-default';
  }

  getBindingModeLabel(mode: string): string {
    const labels: Record<string, string> = {
      'oneTime': 'one-time',
      'toView': '→',
      'fromView': '←',
      'twoWay': '↔',
      'default': '→',
    };
    return labels[mode] || '→';
  }

  getControllerTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      'if': '&#10067;',
      'else': '&#10068;',
      'repeat': '&#8635;',
      'with': '&#128230;',
      'switch': '&#9898;',
      'case': '&#9899;',
      'au-slot': '&#128193;',
      'portal': '&#128316;',
    };
    return icons[type] || '&#9670;';
  }

  formatBindingValue(value: unknown): string {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'string') return `"${value}"`;
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  // Search
  handleSearchInput(event: Event) {
    const input = event.target as HTMLInputElement;
    this.searchQuery = input.value;

    if (this.searchQuery.trim()) {
      this.performSearch();
      this.isSearchOpen = true;
    } else {
      this.searchResults = [];
      this.isSearchOpen = false;
    }
  }

  async performSearch() {
    const query = this.searchQuery.toLowerCase().trim();
    if (!query) {
      this.searchResults = [];
      return;
    }

    const results = await this.debugHost.searchComponents(query);
    this.searchResults = results;
  }

  selectSearchResult(result: SearchResult) {
    this.debugHost.selectComponentByKey(result.key);
    this.searchQuery = '';
    this.searchResults = [];
    this.isSearchOpen = false;
  }

  clearSearch() {
    this.searchQuery = '';
    this.searchResults = [];
    this.isSearchOpen = false;
  }

  // Enhanced info
  async loadEnhancedInfo(): Promise<void> {
    const componentKey = this.selectedElement?.key || this.selectedElement?.name;
    if (!componentKey) {
      this.clearEnhancedInfo();
      return;
    }

    try {
      const [hooks, computed, enhancedDI, route, slots, template] = await Promise.all([
        this.debugHost.getLifecycleHooks(componentKey),
        this.debugHost.getComputedProperties(componentKey),
        this.debugHost.getEnhancedDISnapshot(componentKey),
        this.debugHost.getRouteInfo(componentKey),
        this.debugHost.getSlotInfo(componentKey),
        this.debugHost.getTemplateSnapshot(componentKey),
      ]);

      this.lifecycleHooks = hooks;
      this.computedProperties = computed || [];
      this.routeInfo = route;
      this.slotInfo = slots;
      this.templateSnapshot = template;
      this.expandedBindings.clear();
      this.expandedControllers.clear();

      if (enhancedDI && 'version' in enhancedDI && enhancedDI.version === 2) {
        this.enhancedDI = enhancedDI as EnhancedDISnapshot;
        this.dependencies = null;
      } else {
        this.enhancedDI = null;
        this.dependencies = enhancedDI as DISnapshot;
      }
    } catch {
      this.clearEnhancedInfo();
    }
  }

  clearEnhancedInfo() {
    this.lifecycleHooks = null;
    this.computedProperties = [];
    this.dependencies = null;
    this.enhancedDI = null;
    this.showAvailableServices = false;
    this.routeInfo = null;
    this.slotInfo = null;
    this.templateSnapshot = null;
    this.expandedBindings.clear();
    this.expandedControllers.clear();
  }

  get implementedHooksCount(): number {
    if (!this.lifecycleHooks?.hooks) return 0;
    return this.lifecycleHooks.hooks.filter(h => h.implemented).length;
  }

  get totalHooksCount(): number {
    return this.lifecycleHooks?.hooks?.length || 0;
  }

  get activeSlotCount(): number {
    if (!this.slotInfo?.slots) return 0;
    return this.slotInfo.slots.filter(s => s.hasContent).length;
  }

  get hasBindables(): boolean {
    return (this.selectedElement?.bindables?.length ?? 0) > 0;
  }

  get hasProperties(): boolean {
    return (this.selectedElement?.properties?.length ?? 0) > 0;
  }

  get hasController(): boolean {
    return !!(this.selectedElement as any)?.controller?.properties?.length;
  }

  get hasCustomAttributes(): boolean {
    return this.selectedElementAttributes.length > 0;
  }

  get hasLifecycleHooks(): boolean {
    return (this.lifecycleHooks?.hooks?.length ?? 0) > 0;
  }

  get hasComputedProperties(): boolean {
    return this.computedProperties.length > 0;
  }

  get hasDependencies(): boolean {
    return (this.dependencies?.dependencies?.length ?? 0) > 0;
  }

  get isEnhancedDI(): boolean {
    return this.enhancedDI?.version === 2;
  }

  get hasEnhancedDependencies(): boolean {
    return (this.enhancedDI?.dependencies?.length ?? 0) > 0;
  }

  get hasContainerHierarchy(): boolean {
    return !!this.enhancedDI?.containerHierarchy;
  }

  get availableServicesCount(): number {
    return this.enhancedDI?.availableServices?.length ?? 0;
  }

  get containerAncestorsReversed(): Array<{ id: number; depth: number; isRoot: boolean; registrationCount: number }> {
    if (!this.enhancedDI?.containerHierarchy?.ancestors) return [];
    return [...this.enhancedDI.containerHierarchy.ancestors].reverse();
  }

  toggleAvailableServices(): void {
    this.showAvailableServices = !this.showAvailableServices;
  }

  formatResolvedValue(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return `"${value}"`;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'object') {
      if ('__type__' in (value as object)) {
        const typed = value as { __type__: string };
        return `${typed.__type__} {...}`;
      }
      return JSON.stringify(value).slice(0, 50) + (JSON.stringify(value).length > 50 ? '...' : '');
    }
    return String(value);
  }

  get hasRouteInfo(): boolean {
    return !!(this.routeInfo?.currentRoute);
  }

  get hasSlots(): boolean {
    return (this.slotInfo?.slots?.length ?? 0) > 0;
  }

  // Property editing
  editProperty(property: Property & { originalValue?: unknown }) {
    const editableTypes = ['string', 'number', 'boolean', 'bigint', 'null', 'undefined'];
    if (editableTypes.includes(property.type) || property.canEdit) {
      property.isEditing = true;
      (property as any).originalValue = property.value;
    }
  }

  saveProperty(property: Property, newValue: string) {
    const originalType = property.type;
    let convertedValue: unknown = newValue;

    try {
      switch (originalType) {
        case 'number': {
          const numValue = Number(newValue);
          if (isNaN(numValue)) {
            this.revertProperty(property);
            return;
          }
          convertedValue = numValue;
          break;
        }
        case 'boolean': {
          const lower = newValue.toLowerCase();
          if (lower !== 'true' && lower !== 'false') {
            this.revertProperty(property);
            return;
          }
          convertedValue = lower === 'true';
          break;
        }
        case 'null':
          convertedValue = newValue === 'null' || newValue === '' ? null : newValue;
          if (convertedValue !== null) property.type = 'string';
          break;
        case 'undefined':
          convertedValue = newValue === 'undefined' || newValue === '' ? undefined : newValue;
          if (convertedValue !== undefined) property.type = 'string';
          break;
        default:
          convertedValue = newValue;
          property.type = 'string';
          break;
      }

      property.value = convertedValue;
      property.isEditing = false;
      delete (property as any).originalValue;

      this.plat.queueMicrotask(() => {
        this.debugHost.updateValues(this.selectedElement!, property);
        this.markPropertyRowsDirty();
      });
    } catch {
      this.revertProperty(property);
    }
  }

  cancelPropertyEdit(property: Property) {
    this.revertProperty(property);
  }

  private revertProperty(property: Property) {
    property.value = (property as any).originalValue;
    property.isEditing = false;
    delete (property as any).originalValue;
  }

  async copyPropertyValue(property: Property, event?: Event) {
    event?.stopPropagation();

    let valueToCopy: string;
    if (property.value === null) {
      valueToCopy = 'null';
    } else if (property.value === undefined) {
      valueToCopy = 'undefined';
    } else if (typeof property.value === 'object') {
      try {
        valueToCopy = JSON.stringify(property.value, null, 2);
      } catch {
        valueToCopy = String(property.value);
      }
    } else {
      valueToCopy = String(property.value);
    }

    try {
      await navigator.clipboard.writeText(valueToCopy);
      this.copiedPropertyId = `${property.name}-${property.debugId || ''}`;
      setTimeout(() => {
        this.copiedPropertyId = null;
      }, 1500);
    } catch {}
  }

  isPropertyCopied(property: Property): boolean {
    return this.copiedPropertyId === `${property.name}-${property.debugId || ''}`;
  }

  // Property expansion
  togglePropertyExpansion(property: Property) {
    if (!property.canExpand) return;

    if (!property.isExpanded) {
      if (!property.expandedValue) {
        this.loadExpandedPropertyValue(property);
      } else {
        property.isExpanded = true;
      }
    } else {
      property.isExpanded = false;
    }
    this.markPropertyRowsDirty();
  }

  private loadExpandedPropertyValue(property: Property) {
    if (property.debugId && chrome?.devtools) {
      const code = `window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__.getExpandedDebugValueForId(${property.debugId})`;

      chrome.devtools.inspectedWindow.eval(code, (result: any, isException?: any) => {
        if (isException) return;

        property.expandedValue = result;
        property.isExpanded = true;
        this.markPropertyRowsDirty();
      });
    }
  }

  private markPropertyRowsDirty() {
    this.propertyRowsRevision++;
  }

  getPropertyRows(properties?: Property[], _revision: number = this.propertyRowsRevision): PropertyRow[] {
    if (!properties?.length) return [];
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

  // Expression evaluation
  async evaluateExpression() {
    const expression = this.expressionInput.trim();
    if (!expression || !this.selectedElement) return;

    this.expressionError = '';
    this.expressionResult = '';
    this.expressionResultType = '';

    if (!this.expressionHistory.includes(expression)) {
      this.expressionHistory = [expression, ...this.expressionHistory.slice(0, 9)];
    }

    const componentKey = this.selectedElement.key || this.selectedElement.name;
    if (!componentKey) {
      this.expressionError = 'No component selected';
      return;
    }

    const code = `
      (function() {
        try {
          var hook = window.__AURELIA_DEVTOOLS_GLOBAL_HOOK__;
          if (!hook || !hook.evaluateInComponentContext) {
            return { error: 'DevTools hook not available' };
          }
          var result = hook.evaluateInComponentContext(${JSON.stringify(componentKey)}, ${JSON.stringify(expression)});
          return result;
        } catch (e) {
          return { error: e.message || String(e) };
        }
      })()
    `;

    if (chrome?.devtools?.inspectedWindow) {
      chrome.devtools.inspectedWindow.eval(code, (result: any, isException?: any) => {
        if (isException) {
          this.expressionError = String(isException);
          return;
        }

        if (result?.error) {
          this.expressionError = result.error;
          return;
        }

        if (result?.success) {
          this.expressionResultType = result.type || typeof result.value;
          try {
            if (result.value === undefined) {
              this.expressionResult = 'undefined';
            } else if (result.value === null) {
              this.expressionResult = 'null';
            } else if (typeof result.value === 'object') {
              this.expressionResult = JSON.stringify(result.value, null, 2);
            } else {
              this.expressionResult = String(result.value);
            }
          } catch {
            this.expressionResult = String(result.value);
          }
        } else {
          this.expressionError = 'Unknown response format';
        }
      });
    }
  }

  selectHistoryExpression(expr: string) {
    this.expressionInput = expr;
  }

  clearExpressionResult() {
    this.expressionResult = '';
    this.expressionResultType = '';
    this.expressionError = '';
  }

  // Export
  async exportComponentAsJson() {
    if (!this.selectedElement) return;

    const exportData = {
      meta: {
        name: this.selectedElement.name,
        type: this.selectedNodeType,
        key: this.selectedElement.key,
        exportedAt: new Date().toISOString(),
      },
      bindables: this.serializeProperties(this.selectedElement.bindables || []),
      properties: this.serializeProperties(this.selectedElement.properties || []),
      customAttributes: this.selectedElementAttributes.map(attr => ({
        name: attr.name,
        bindables: this.serializeProperties(attr.bindables || []),
        properties: this.serializeProperties(attr.properties || []),
      })),
    };

    const jsonString = JSON.stringify(exportData, null, 2);

    try {
      await navigator.clipboard.writeText(jsonString);
      this.copiedPropertyId = '__export__';
      setTimeout(() => {
        this.copiedPropertyId = null;
      }, 1500);
    } catch {}
  }

  private serializeProperties(properties: Property[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const prop of properties) {
      if (prop?.name) {
        result[prop.name] = { value: prop.value, type: prop.type };
      }
    }
    return result;
  }

  get isExportCopied(): boolean {
    return this.copiedPropertyId === '__export__';
  }

  // Reveal in Elements
  revealInElements() {
    if (!this.selectedElement) return;
    this.debugHost.revealInElements({
      name: this.selectedElement.name,
      type: this.selectedNodeType,
      customElementInfo: this.selectedNodeType === 'custom-element' ? this.selectedElement : null,
      customAttributesInfo: this.selectedNodeType === 'custom-attribute' ? [this.selectedElement] : this.selectedElementAttributes,
    });
  }

  // Format property value for display
  formatPropertyValue(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return `"${value}"`;
    if (typeof value === 'object') {
      if (Array.isArray(value)) return `Array(${value.length})`;
      return '{...}';
    }
    return String(value);
  }

  getPropertyTypeClass(type: string): string {
    const typeMap: Record<string, string> = {
      string: 'type-string',
      number: 'type-number',
      boolean: 'type-boolean',
      null: 'type-null',
      undefined: 'type-null',
      object: 'type-object',
      array: 'type-object',
      function: 'type-function',
    };
    return typeMap[type] || 'type-default';
  }
}

interface SearchResult {
  key: string;
  name: string;
  type: 'custom-element' | 'custom-attribute';
}

interface PropertyRow {
  property: Property;
  depth: number;
}
