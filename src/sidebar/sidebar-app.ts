import { ICustomElementViewModel, resolve } from 'aurelia';
import { SidebarDebugHost, SearchResult } from './sidebar-debug-host';
import { formatExpandedValue, formatTimestamp, serializeProperties } from './format';
import {
  AureliaInfo,
  ComponentTreeNode,
  ComponentTreeRow,
  ComputedPropertyInfo,
  ContainerInfo,
  DISnapshot,
  EnhancedDISnapshot,
  EventInteractionRecord,
  IControllerInfo,
  LifecycleHooksSnapshot,
  PropertyChangeRecord,
  PropertySnapshot,
  RouteSnapshot,
  SlotSnapshot,
  TemplateBinding,
  TemplateControllerInfo,
  TemplateSnapshot,
} from '../shared/types';

export type DetectionState = 'checking' | 'detected' | 'not-found' | 'disabled';
export type SelectedNodeType = 'custom-element' | 'custom-attribute';
export type SectionId =
  | 'bindables'
  | 'properties'
  | 'context'
  | 'controller'
  | 'attributes'
  | 'lifecycle'
  | 'computed'
  | 'dependencies'
  | 'route'
  | 'slots'
  | 'template'
  | 'expression'
  | 'timeline';

export interface PickedElementInfo extends AureliaInfo {
  __selectedElement?: string | null;
  __isBindingContext?: boolean;
}

export interface SnapshotRow {
  key: string;
  value: string;
}

const FOLLOW_SELECTION_KEY = 'au-devtools.followChromeSelection';
const SECTIONS_KEY = 'au-devtools.sections';
const DETECTION_POLL_MS = 2000;
const PROPERTY_POLL_MS = 500;
const COPIED_FEEDBACK_MS = 1500;
const EXPRESSION_HISTORY_LIMIT = 10;
const TIMELINE_LIMIT = 200;

const DEFAULT_SECTIONS: Record<SectionId, boolean> = {
  bindables: true,
  properties: true,
  context: true,
  controller: false,
  attributes: true,
  lifecycle: false,
  computed: false,
  dependencies: false,
  route: false,
  slots: false,
  template: false,
  expression: false,
  timeline: false,
};

const BINDING_TYPE_LABELS: Record<string, string> = {
  property: 'prop',
  attribute: 'attr',
  interpolation: '${}',
  listener: 'event',
  ref: 'ref',
  let: 'let',
};

const BINDING_MODE_LABELS: Record<string, string> = {
  oneTime: 'one-time',
  toView: '→',
  fromView: '←',
  twoWay: '↔',
  default: '→',
};

const BINDING_MODE_CLASSES: Record<string, string> = {
  oneTime: 'mode-one-time',
  toView: 'mode-to-view',
  fromView: 'mode-from-view',
  twoWay: 'mode-two-way',
  default: 'mode-default',
};

export class SidebarApp implements ICustomElementViewModel {
  detectionState: DetectionState = 'checking';
  aureliaVersion: number | null = null;
  extensionInvalidated = false;

  selectedElement: IControllerInfo | null = null;
  selectedElementAttributes: IControllerInfo[] = [];
  selectedNodeType: SelectedNodeType = 'custom-element';
  selectedElementTagName: string | null = null;
  isShowingBindingContext = false;

  isElementPickerActive = false;
  followChromeSelection = true;

  componentTree: ComponentTreeNode[] = [];
  expandedTreeKeys: Record<string, boolean> = {};
  selectedTreeNodeKey: string | null = null;
  isTreePanelExpanded = true;

  isRecording = false;
  timelineEvents: EventInteractionRecord[] = [];
  expandedTimelineIds: Record<string, boolean> = {};

  searchQuery = '';
  searchResults: SearchResult[] = [];
  isSearchOpen = false;
  activeSearchIndex = -1;

  expandedSections: Record<SectionId, boolean> = { ...DEFAULT_SECTIONS };

  lifecycleHooks: LifecycleHooksSnapshot | null = null;
  computedProperties: ComputedPropertyInfo[] = [];
  dependencies: DISnapshot | null = null;
  enhancedDI: EnhancedDISnapshot | null = null;
  showAvailableServices = false;
  routeInfo: RouteSnapshot | null = null;
  slotInfo: SlotSnapshot | null = null;
  templateSnapshot: TemplateSnapshot | null = null;
  expandedBindingIds: Record<string, boolean> = {};
  expandedControllerIds: Record<string, boolean> = {};

  expressionInput = '';
  expressionResult = '';
  expressionResultType = '';
  expressionError = '';
  expressionHistory: string[] = [];

  isExportCopied = false;

  private readonly debugHost: SidebarDebugHost = resolve(SidebarDebugHost);
  private detectionTimer: ReturnType<typeof setInterval> | null = null;
  private exportCopiedTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribers: Array<() => void> = [];
  private searchSequence = 0;

  attaching(): void {
    this.applyTheme();
    this.restorePreferences();

    this.unsubscribers.push(
      this.debugHost.onRuntimeMessage('au-devtools:property-change', (message) =>
        this.onPropertyChanges(message.changes, message.snapshot)
      ),
      this.debugHost.onRuntimeMessage('au-devtools:interaction', (message) => this.onInteraction(message.entry)),
      this.debugHost.onRuntimeMessage('au-devtools:tree-change', () => this.loadComponentTree())
    );

    this.debugHost.attach(this);
    this.refreshDetectionState();
    this.detectionTimer = setInterval(() => this.pollDetection(), DETECTION_POLL_MS);
    this.loadComponentTree();
  }

  detaching(): void {
    if (this.detectionTimer) {
      clearInterval(this.detectionTimer);
      this.detectionTimer = null;
    }
    if (this.exportCopiedTimer) {
      clearTimeout(this.exportCopiedTimer);
      this.exportCopiedTimer = null;
    }
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.debugHost.detach();
  }

  private applyTheme(): void {
    const theme = this.debugHost.getThemeName();
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.classList.toggle('light', theme !== null && theme !== 'dark');
  }

  private restorePreferences(): void {
    try {
      const follow = localStorage.getItem(FOLLOW_SELECTION_KEY);
      if (follow != null) this.followChromeSelection = follow === 'true';

      const sections = localStorage.getItem(SECTIONS_KEY);
      if (sections) {
        const parsed = JSON.parse(sections) as Partial<Record<SectionId, boolean>>;
        for (const id of Object.keys(DEFAULT_SECTIONS) as SectionId[]) {
          if (typeof parsed[id] === 'boolean') this.expandedSections[id] = parsed[id] as boolean;
        }
      }
    } catch {
      /* preferences are optional */
    }
  }

  private persist(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* preferences are optional */
    }
  }

  // Detection

  get isChecking(): boolean {
    return !this.extensionInvalidated && this.detectionState === 'checking';
  }

  get isNotFound(): boolean {
    return !this.extensionInvalidated && this.detectionState === 'not-found';
  }

  get isDisabled(): boolean {
    return !this.extensionInvalidated && this.detectionState === 'disabled';
  }

  get isDetected(): boolean {
    return !this.extensionInvalidated && this.detectionState === 'detected';
  }

  get versionLabel(): string {
    return this.aureliaVersion ? `Aurelia ${this.aureliaVersion}` : 'Aurelia';
  }

  async refreshDetectionState(): Promise<void> {
    const snapshot = await this.debugHost.getDetectionState();
    if (!snapshot) return;

    const previous = this.detectionState;
    switch (snapshot.state) {
      case 'detected':
        this.aureliaVersion = snapshot.version;
        this.detectionState = 'detected';
        break;
      case 'disabled':
        this.aureliaVersion = null;
        this.detectionState = 'disabled';
        break;
      case 'not-found':
        this.aureliaVersion = null;
        this.detectionState = 'not-found';
        break;
      default:
        this.detectionState = 'checking';
    }

    if (previous !== 'detected' && this.detectionState === 'detected') {
      this.loadComponentTree();
      if (this.followChromeSelection) this.debugHost.refreshSelection();
    }
  }

  private pollDetection(): void {
    if (this.checkExtensionInvalidated()) {
      if (this.detectionTimer) clearInterval(this.detectionTimer);
      this.detectionTimer = null;
      return;
    }
    this.refreshDetectionState();
  }

  checkExtensionInvalidated(): boolean {
    if (this.debugHost.isRuntimeAvailable()) return false;
    this.extensionInvalidated = true;
    return true;
  }

  // Selection

  onElementPicked(info: PickedElementInfo | null): void {
    this.isElementPickerActive = false;
    this.debugHost.stopElementPicker();

    if (!info) {
      this.clearSelection();
      return;
    }

    const element = info.customElementInfo;
    const attributes = info.customAttributesInfo ?? [];

    this.selectedElementTagName = info.__selectedElement ?? null;
    this.isShowingBindingContext = info.__isBindingContext === true;

    if (element) {
      this.selectedElement = normalizeControllerInfo(element);
      this.selectedElementAttributes = attributes;
      this.selectedNodeType = 'custom-element';
    } else if (attributes.length > 0) {
      this.selectedElement = normalizeControllerInfo(attributes[0]);
      this.selectedElementAttributes = [];
      this.selectedNodeType = 'custom-attribute';
    } else {
      this.clearSelection();
      return;
    }

    const componentKey = this.selectedComponentKey;
    if (componentKey) {
      this.debugHost.startPropertyWatching({ componentKey, pollInterval: PROPERTY_POLL_MS });
      this.selectedTreeNodeKey = componentKey;
    }

    this.loadEnhancedInfo();

    if (!this.componentTree.length) {
      this.loadComponentTree();
    }
  }

  get selectedComponentKey(): string | null {
    if (!this.selectedElement) return null;
    return this.selectedElement.instanceId || this.selectedElement.key || this.selectedElement.name || null;
  }

  get selectedKindLabel(): string {
    return this.selectedNodeType === 'custom-attribute' ? 'custom attribute' : 'custom element';
  }

  clearSelection(): void {
    this.debugHost.stopPropertyWatching();
    this.selectedElement = null;
    this.selectedElementAttributes = [];
    this.selectedElementTagName = null;
    this.isShowingBindingContext = false;
    this.clearEnhancedInfo();
  }

  onPropertyChanges(changes: PropertyChangeRecord[] | undefined, snapshot: PropertySnapshot | undefined): void {
    if (!changes?.length || !this.selectedElement) return;

    const selectedKey = this.selectedComponentKey;
    if (!selectedKey || snapshot?.componentKey !== selectedKey) return;

    for (const change of changes) {
      const bindable = this.selectedElement.bindables?.find((b) => b.name === change.propertyName);
      if (bindable) {
        bindable.value = change.newValue;
        continue;
      }
      const property = this.selectedElement.properties?.find((p) => p.name === change.propertyName);
      if (property) {
        property.value = change.newValue;
      }
    }
  }

  // Sections

  toggleSection(id: SectionId): void {
    this.expandedSections[id] = !this.expandedSections[id];
    this.persist(SECTIONS_KEY, JSON.stringify(this.expandedSections));
  }

  // Toolbar

  toggleElementPicker(): void {
    this.isElementPickerActive = !this.isElementPickerActive;
    if (this.isElementPickerActive) {
      this.debugHost.startElementPicker();
    } else {
      this.debugHost.stopElementPicker();
    }
  }

  toggleFollowChromeSelection(): void {
    this.followChromeSelection = !this.followChromeSelection;
    this.persist(FOLLOW_SELECTION_KEY, String(this.followChromeSelection));
    if (this.followChromeSelection) {
      this.debugHost.refreshSelection();
    }
  }

  // Search

  onSearchInput(event: Event): void {
    this.searchQuery = (event.target as HTMLInputElement).value;
    this.runSearch();
  }

  async runSearch(): Promise<void> {
    const query = this.searchQuery.trim().toLowerCase();
    const sequence = ++this.searchSequence;

    if (!query) {
      this.searchResults = [];
      this.isSearchOpen = false;
      this.activeSearchIndex = -1;
      return;
    }

    const results = await this.debugHost.searchComponents(query);
    if (sequence !== this.searchSequence) return;

    this.searchResults = results;
    this.isSearchOpen = true;
    this.activeSearchIndex = results.length ? 0 : -1;
  }

  openSearch(): void {
    if (this.searchQuery.trim() && this.searchResults.length) {
      this.isSearchOpen = true;
    }
  }

  closeSearch(): void {
    this.isSearchOpen = false;
  }

  onSearchKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.openSearch();
        this.moveSearchSelection(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.moveSearchSelection(-1);
        break;
      case 'Enter': {
        const result = this.searchResults[this.activeSearchIndex] ?? this.searchResults[0];
        if (result) {
          event.preventDefault();
          this.selectSearchResult(result);
        }
        break;
      }
      case 'Escape':
        event.preventDefault();
        this.clearSearch();
        break;
    }
  }

  private moveSearchSelection(delta: number): void {
    const count = this.searchResults.length;
    if (!count) return;
    this.activeSearchIndex = (this.activeSearchIndex + delta + count) % count;
  }

  setActiveSearchIndex(index: number): void {
    this.activeSearchIndex = index;
  }

  isActiveSearchResult(index: number): boolean {
    return this.activeSearchIndex === index;
  }

  selectSearchResult(result: SearchResult, event?: Event): void {
    event?.preventDefault();
    this.debugHost.selectComponentByKey(result.key);
    this.clearSearch();
  }

  clearSearch(): void {
    this.searchSequence++;
    this.searchQuery = '';
    this.searchResults = [];
    this.isSearchOpen = false;
    this.activeSearchIndex = -1;
  }

  // Component tree

  async loadComponentTree(): Promise<void> {
    try {
      this.componentTree = await this.debugHost.getComponentTree();
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

    this.expandedTreeKeys[node.key] = !this.expandedTreeKeys[node.key];
  }

  selectTreeNode(node: ComponentTreeNode): void {
    this.selectedTreeNodeKey = node.key;
    this.debugHost.selectComponentByKey(node.key);
  }

  onTreeKeydown(event: KeyboardEvent, node: ComponentTreeNode): void {
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.selectTreeNode(node);
        break;
      case 'ArrowRight':
        if (node.hasChildren && !this.expandedTreeKeys[node.key]) {
          event.preventDefault();
          this.expandedTreeKeys[node.key] = true;
        }
        break;
      case 'ArrowLeft':
        if (this.expandedTreeKeys[node.key]) {
          event.preventDefault();
          this.expandedTreeKeys[node.key] = false;
        }
        break;
    }
  }

  get treeRows(): ComponentTreeRow[] {
    return this.flattenTreeNodes(this.componentTree, 0);
  }

  private flattenTreeNodes(nodes: ComponentTreeNode[], depth: number): ComponentTreeRow[] {
    const rows: ComponentTreeRow[] = [];
    for (const node of nodes) {
      if (!node) continue;
      rows.push({ node, depth });
      if (this.expandedTreeKeys[node.key] && node.children?.length) {
        rows.push(...this.flattenTreeNodes(node.children, depth + 1));
      }
    }
    return rows;
  }

  isTreeNodeExpanded(node: ComponentTreeNode): boolean {
    return this.expandedTreeKeys[node.key] === true;
  }

  isTreeNodeSelected(node: ComponentTreeNode): boolean {
    return this.selectedTreeNodeKey === node.key;
  }

  get hasComponentTree(): boolean {
    return this.componentTree.length > 0;
  }

  get componentTreeCount(): number {
    const countNodes = (nodes: ComponentTreeNode[]): number =>
      nodes.reduce((total, node) => total + 1 + (node.children?.length ? countNodes(node.children) : 0), 0);
    return countNodes(this.componentTree);
  }

  // Timeline

  async startRecording(): Promise<void> {
    this.isRecording = true;
    await this.debugHost.startInteractionRecording();
  }

  async stopRecording(): Promise<void> {
    this.isRecording = false;
    await this.debugHost.stopInteractionRecording();
  }

  onInteraction(entry: EventInteractionRecord | undefined): void {
    if (!this.isRecording || !entry) return;
    this.timelineEvents.push(entry);
    if (this.timelineEvents.length > TIMELINE_LIMIT) {
      this.timelineEvents.splice(0, this.timelineEvents.length - TIMELINE_LIMIT);
    }
  }

  clearTimeline(): void {
    this.timelineEvents = [];
    this.expandedTimelineIds = {};
    this.debugHost.clearInteractionLog();
  }

  toggleTimelineEvent(event: EventInteractionRecord): void {
    this.expandedTimelineIds[event.id] = !this.expandedTimelineIds[event.id];
  }

  isTimelineEventExpanded(event: EventInteractionRecord): boolean {
    return this.expandedTimelineIds[event.id] === true;
  }

  selectTimelineComponent(event: EventInteractionRecord, domEvent?: Event): void {
    domEvent?.stopPropagation();
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

  get canClearTimeline(): boolean {
    return this.hasTimelineEvents || this.isRecording;
  }

  formatTimelineTimestamp(timestamp: number): string {
    return formatTimestamp(timestamp);
  }

  timelineEventClass(event: EventInteractionRecord): string {
    return `mode-${event.mode || 'unknown'}`;
  }

  snapshotRows(snapshot: Record<string, unknown> | null | undefined): SnapshotRow[] {
    if (!snapshot) return [];
    return Object.entries(snapshot).map(([key, value]) => ({ key, value: formatExpandedValue(value) }));
  }

  // Template debugger

  get hasTemplateInfo(): boolean {
    return this.templateBindingsCount > 0 || this.templateControllersCount > 0;
  }

  get templateBindings(): TemplateBinding[] {
    return this.templateSnapshot?.bindings ?? [];
  }

  get templateControllers(): TemplateControllerInfo[] {
    return this.templateSnapshot?.controllers ?? [];
  }

  get templateBindingsCount(): number {
    return this.templateSnapshot?.bindings?.length ?? 0;
  }

  get templateControllersCount(): number {
    return this.templateSnapshot?.controllers?.length ?? 0;
  }

  get hasTemplateMeta(): boolean {
    const snapshot = this.templateSnapshot;
    return !!snapshot && (snapshot.hasSlots || snapshot.shadowMode !== 'none' || snapshot.isContainerless);
  }

  toggleBindingExpand(binding: TemplateBinding): void {
    this.expandedBindingIds[binding.id] = !this.expandedBindingIds[binding.id];
  }

  isBindingExpanded(binding: TemplateBinding): boolean {
    return this.expandedBindingIds[binding.id] === true;
  }

  toggleControllerExpand(controller: TemplateControllerInfo): void {
    this.expandedControllerIds[controller.id] = !this.expandedControllerIds[controller.id];
  }

  isControllerExpanded(controller: TemplateControllerInfo): boolean {
    return this.expandedControllerIds[controller.id] === true;
  }

  bindingTypeLabel(type: string): string {
    return BINDING_TYPE_LABELS[type] ?? type;
  }

  bindingModeLabel(mode: string | undefined): string {
    return BINDING_MODE_LABELS[mode ?? 'default'] ?? BINDING_MODE_LABELS.default;
  }

  bindingModeClass(mode: string | undefined): string {
    return BINDING_MODE_CLASSES[mode ?? 'default'] ?? BINDING_MODE_CLASSES.default;
  }

  formatBindingValue(value: unknown): string {
    return formatExpandedValue(value);
  }

  isConditionalController(controller: TemplateControllerInfo): boolean {
    return controller.type === 'if' || controller.type === 'else';
  }

  hasRepeatItems(controller: TemplateControllerInfo): boolean {
    return controller.type === 'repeat' && (controller.items?.length ?? 0) > 0;
  }

  // Enhanced info

  async loadEnhancedInfo(): Promise<void> {
    const componentKey = this.selectedComponentKey;
    if (!componentKey) {
      this.clearEnhancedInfo();
      return;
    }

    try {
      const [hooks, computed, di, route, slots, template] = await Promise.all([
        this.debugHost.getLifecycleHooks(componentKey),
        this.debugHost.getComputedProperties(componentKey),
        this.debugHost.getEnhancedDISnapshot(componentKey),
        this.debugHost.getRouteInfo(componentKey),
        this.debugHost.getSlotInfo(componentKey),
        this.debugHost.getTemplateSnapshot(componentKey),
      ]);

      if (componentKey !== this.selectedComponentKey) return;

      this.lifecycleHooks = hooks;
      this.computedProperties = computed ?? [];
      this.routeInfo = route;
      this.slotInfo = slots;
      this.templateSnapshot = template;
      this.expandedBindingIds = {};
      this.expandedControllerIds = {};

      if (di && 'version' in di && di.version === 2) {
        this.enhancedDI = di as EnhancedDISnapshot;
        this.dependencies = null;
      } else {
        this.enhancedDI = null;
        this.dependencies = (di as DISnapshot | null) ?? null;
      }
    } catch {
      this.clearEnhancedInfo();
    }
  }

  clearEnhancedInfo(): void {
    this.lifecycleHooks = null;
    this.computedProperties = [];
    this.dependencies = null;
    this.enhancedDI = null;
    this.showAvailableServices = false;
    this.routeInfo = null;
    this.slotInfo = null;
    this.templateSnapshot = null;
    this.expandedBindingIds = {};
    this.expandedControllerIds = {};
  }

  get implementedHooksCount(): number {
    return this.lifecycleHooks?.hooks?.filter((h) => h.implemented).length ?? 0;
  }

  get totalHooksCount(): number {
    return this.lifecycleHooks?.hooks?.length ?? 0;
  }

  get activeSlotCount(): number {
    return this.slotInfo?.slots?.filter((s) => s.hasContent).length ?? 0;
  }

  get hasBindables(): boolean {
    return (this.selectedElement?.bindables?.length ?? 0) > 0;
  }

  get hasProperties(): boolean {
    return (this.selectedElement?.properties?.length ?? 0) > 0;
  }

  get hasOverrideContext(): boolean {
    return (this.selectedElement?.overrideContext?.length ?? 0) > 0;
  }

  get hasController(): boolean {
    return (this.selectedElement?.controller?.properties?.length ?? 0) > 0;
  }

  get hasCustomAttributes(): boolean {
    return this.selectedElementAttributes.length > 0;
  }

  get hasLifecycleHooks(): boolean {
    return this.totalHooksCount > 0;
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

  get hasAnyDIInfo(): boolean {
    return this.hasEnhancedDependencies || this.hasContainerHierarchy || this.availableServicesCount > 0;
  }

  get availableServicesCount(): number {
    return this.enhancedDI?.availableServices?.length ?? 0;
  }

  get containerAncestorsReversed(): ContainerInfo[] {
    const ancestors = this.enhancedDI?.containerHierarchy?.ancestors ?? [];
    return [...ancestors].reverse();
  }

  get currentContainerLabel(): string {
    return this.enhancedDI?.containerHierarchy?.current?.ownerName || 'current';
  }

  toggleAvailableServices(): void {
    this.showAvailableServices = !this.showAvailableServices;
  }

  previewRows(preview: Record<string, unknown> | undefined): SnapshotRow[] {
    return this.snapshotRows(preview);
  }

  get hasRouteInfo(): boolean {
    return !!this.routeInfo?.currentRoute;
  }

  get hasSlots(): boolean {
    return (this.slotInfo?.slots?.length ?? 0) > 0;
  }

  // Expression evaluation

  get canEvaluate(): boolean {
    return !!this.selectedComponentKey && this.expressionInput.trim().length > 0;
  }

  onExpressionKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.evaluateExpression();
    }
  }

  async evaluateExpression(): Promise<void> {
    const expression = this.expressionInput.trim();
    const componentKey = this.selectedComponentKey;
    if (!expression) return;

    this.expressionError = '';
    this.expressionResult = '';
    this.expressionResultType = '';

    if (!componentKey) {
      this.expressionError = 'No component selected';
      return;
    }

    if (!this.expressionHistory.includes(expression)) {
      this.expressionHistory = [expression, ...this.expressionHistory.slice(0, EXPRESSION_HISTORY_LIMIT - 1)];
    }

    const result = await this.debugHost.evaluateExpression(componentKey, expression);
    if (!result.success) {
      this.expressionError = result.error || 'Evaluation failed';
      return;
    }

    this.expressionResultType = result.type || typeof result.value;
    this.expressionResult = formatExpandedValue(result.value);
  }

  selectHistoryExpression(expression: string): void {
    this.expressionInput = expression;
  }

  clearExpressionResult(): void {
    this.expressionResult = '';
    this.expressionResultType = '';
    this.expressionError = '';
  }

  // Export and reveal

  async exportComponentAsJson(): Promise<void> {
    if (!this.selectedElement) return;

    const exportData = {
      meta: {
        name: this.selectedElement.name,
        type: this.selectedNodeType,
        key: this.selectedElement.key,
        exportedAt: new Date().toISOString(),
      },
      bindables: serializeProperties(this.selectedElement.bindables),
      properties: serializeProperties(this.selectedElement.properties),
      overrideContext: serializeProperties(this.selectedElement.overrideContext),
      customAttributes: this.selectedElementAttributes.map((attr) => ({
        name: attr.name,
        bindables: serializeProperties(attr.bindables),
        properties: serializeProperties(attr.properties),
      })),
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));
    } catch {
      return;
    }

    this.isExportCopied = true;
    if (this.exportCopiedTimer) clearTimeout(this.exportCopiedTimer);
    this.exportCopiedTimer = setTimeout(() => {
      this.isExportCopied = false;
      this.exportCopiedTimer = null;
    }, COPIED_FEEDBACK_MS);
  }

  revealInElements(): void {
    if (!this.selectedElement) return;
    this.debugHost.revealInElements({
      name: this.selectedElement.name,
      type: this.selectedNodeType,
      customElementInfo: this.selectedNodeType === 'custom-element' ? this.selectedElement : null,
      customAttributesInfo:
        this.selectedNodeType === 'custom-attribute' ? [this.selectedElement] : this.selectedElementAttributes,
    });
  }
}

function normalizeControllerInfo(info: IControllerInfo): IControllerInfo {
  info.bindables = info.bindables ?? [];
  info.properties = info.properties ?? [];
  info.overrideContext = info.overrideContext ?? [];
  return info;
}
