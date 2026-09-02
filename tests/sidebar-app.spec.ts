import './setup';
import { DI } from 'aurelia';
import type { AureliaInfo, IControllerInfo } from '@/shared/types';
import { SidebarApp } from '@/sidebar/sidebar-app';

function stubSidebarDebugHost(overrides: Partial<Record<string, any>> = {}) {
  return {
    attach: jest.fn(),
    detach: jest.fn(),
    isRuntimeAvailable: jest.fn().mockReturnValue(true),
    getThemeName: jest.fn().mockReturnValue('default'),
    onRuntimeMessage: jest.fn().mockReturnValue(jest.fn()),
    refreshSelection: jest.fn(),
    getDetectionState: jest.fn().mockResolvedValue({ state: 'detected', version: 2 }),
    startElementPicker: jest.fn(),
    stopElementPicker: jest.fn(),
    startPropertyWatching: jest.fn(),
    stopPropertyWatching: jest.fn(),
    updateValues: jest.fn(),
    revealInElements: jest.fn(),
    searchComponents: jest.fn().mockResolvedValue([]),
    selectComponentByKey: jest.fn(),
    getLifecycleHooks: jest.fn().mockResolvedValue(null),
    getComputedProperties: jest.fn().mockResolvedValue([]),
    getEnhancedDISnapshot: jest.fn().mockResolvedValue(null),
    getRouteInfo: jest.fn().mockResolvedValue(null),
    getSlotInfo: jest.fn().mockResolvedValue(null),
    getTemplateSnapshot: jest.fn().mockResolvedValue(null),
    getComponentTree: jest.fn().mockResolvedValue([]),
    startInteractionRecording: jest.fn().mockResolvedValue(true),
    stopInteractionRecording: jest.fn().mockResolvedValue(true),
    clearInteractionLog: jest.fn(),
    evaluateExpression: jest.fn().mockResolvedValue({ success: true, value: 1, type: 'number' }),
    getExpandedValue: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function ci(name: string, key?: string): IControllerInfo {
  return { name, key: key ?? name, aliases: [], bindables: [], properties: [] };
}

function ai(element: IControllerInfo | null, attrs: IControllerInfo[] = []): AureliaInfo {
  return { customElementInfo: element, customAttributesInfo: attrs };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SidebarApp', () => {
  let app: any;
  let debugHost: ReturnType<typeof stubSidebarDebugHost>;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    debugHost = stubSidebarDebugHost();
    app = DI.createContainer().get(SidebarApp);
    app.debugHost = debugHost;
  });

  describe('lifecycle', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('attaching wires the host, restores preferences and starts polling', async () => {
      localStorage.setItem('au-devtools.followChromeSelection', 'false');
      localStorage.setItem('au-devtools.sections', JSON.stringify({ bindables: false, bogus: true }));

      app.attaching();

      expect(debugHost.attach).toHaveBeenCalledWith(app);
      expect(app.followChromeSelection).toBe(false);
      expect(app.expandedSections.bindables).toBe(false);
      expect(app.expandedSections.bogus).toBeUndefined();
      expect(debugHost.onRuntimeMessage).toHaveBeenCalledTimes(3);
      expect(debugHost.getComponentTree).toHaveBeenCalled();

      jest.advanceTimersByTime(2000);
      expect(debugHost.getDetectionState).toHaveBeenCalledTimes(2);
    });

    it('applies the DevTools theme to the document root', () => {
      debugHost.getThemeName.mockReturnValue('dark');
      app.attaching();
      expect(document.documentElement.classList.contains('dark')).toBe(true);

      debugHost.getThemeName.mockReturnValue('default');
      app.attaching();
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(document.documentElement.classList.contains('light')).toBe(true);
    });

    it('leaves theme classes alone outside DevTools so the media query decides', () => {
      debugHost.getThemeName.mockReturnValue(null);
      app.attaching();
      expect(document.documentElement.className).toBe('');
    });

    it('detaching removes subscriptions, timers and the host binding', () => {
      const unsubscribe = jest.fn();
      debugHost.onRuntimeMessage.mockReturnValue(unsubscribe);
      app.attaching();

      app.detaching();
      jest.advanceTimersByTime(5000);

      expect(unsubscribe).toHaveBeenCalledTimes(3);
      expect(debugHost.detach).toHaveBeenCalled();
      expect(debugHost.getDetectionState).toHaveBeenCalledTimes(1);
    });

    it('routes runtime messages to the matching handlers', () => {
      const handlers: Record<string, (message: any) => void> = {};
      debugHost.onRuntimeMessage.mockImplementation((type: string, handler: any) => {
        handlers[type] = handler;
        return jest.fn();
      });
      app.attaching();
      app.isRecording = true;

      handlers['au-devtools:interaction']({ entry: { id: 'e1' } });
      expect(app.timelineEvents).toEqual([{ id: 'e1' }]);

      handlers['au-devtools:tree-change']({});
      expect(debugHost.getComponentTree).toHaveBeenCalledTimes(2);

      const bindable = { name: 'count', value: 0, type: 'number' };
      app.selectedElement = { ...ci('c', 'k'), bindables: [bindable] };
      handlers['au-devtools:property-change']({
        changes: [{ componentKey: 'k', propertyName: 'count', newValue: 3 }],
        snapshot: { componentKey: 'k' },
      });
      expect(bindable.value).toBe(3);
    });

    it('stops polling once the extension runtime is gone', () => {
      app.attaching();
      debugHost.isRuntimeAvailable.mockReturnValue(false);

      jest.advanceTimersByTime(2000);
      jest.advanceTimersByTime(2000);

      expect(app.extensionInvalidated).toBe(true);
      expect(debugHost.getDetectionState).toHaveBeenCalledTimes(1);
    });
  });

  describe('detection', () => {
    it('maps the page state into the view', async () => {
      debugHost.getDetectionState.mockResolvedValue({ state: 'detected', version: 1 });
      await app.refreshDetectionState();
      expect(app.detectionState).toBe('detected');
      expect(app.aureliaVersion).toBe(1);
      expect(app.versionLabel).toBe('Aurelia 1');

      debugHost.getDetectionState.mockResolvedValue({ state: 'disabled', version: null });
      await app.refreshDetectionState();
      expect(app.detectionState).toBe('disabled');
      expect(app.aureliaVersion).toBeNull();

      debugHost.getDetectionState.mockResolvedValue({ state: 'not-found', version: null });
      await app.refreshDetectionState();
      expect(app.detectionState).toBe('not-found');

      debugHost.getDetectionState.mockResolvedValue({ state: null, version: null });
      await app.refreshDetectionState();
      expect(app.detectionState).toBe('checking');
    });

    it('ignores a missing snapshot', async () => {
      app.detectionState = 'detected';
      debugHost.getDetectionState.mockResolvedValue(null);
      await app.refreshDetectionState();
      expect(app.detectionState).toBe('detected');
    });

    it('loads the tree and syncs selection when Aurelia appears', async () => {
      app.detectionState = 'checking';
      await app.refreshDetectionState();
      expect(debugHost.getComponentTree).toHaveBeenCalledTimes(1);
      expect(debugHost.refreshSelection).toHaveBeenCalledTimes(1);

      await app.refreshDetectionState();
      expect(debugHost.getComponentTree).toHaveBeenCalledTimes(1);
    });

    it('exposes one state flag at a time', () => {
      app.detectionState = 'checking';
      expect(app.isChecking).toBe(true);
      expect(app.isDetected).toBe(false);
      app.detectionState = 'not-found';
      expect(app.isNotFound).toBe(true);
      app.detectionState = 'disabled';
      expect(app.isDisabled).toBe(true);
      app.detectionState = 'detected';
      expect(app.isDetected).toBe(true);
      app.extensionInvalidated = true;
      expect(app.isDetected).toBe(false);
    });

    it('checkExtensionInvalidated reflects the runtime', () => {
      expect(app.checkExtensionInvalidated()).toBe(false);
      debugHost.isRuntimeAvailable.mockReturnValue(false);
      expect(app.checkExtensionInvalidated()).toBe(true);
      expect(app.extensionInvalidated).toBe(true);
    });
  });

  describe('onElementPicked', () => {
    it('selects a custom element and its attributes', () => {
      const element = ci('my-component', 'my-key');
      const attr = ci('tooltip', 'tooltip-key');

      app.onElementPicked(ai(element, [attr]));

      expect(app.selectedElement).toBe(element);
      expect(app.selectedNodeType).toBe('custom-element');
      expect(app.selectedKindLabel).toBe('custom element');
      expect(app.selectedElementAttributes).toEqual([attr]);
      expect(app.selectedTreeNodeKey).toBe('my-key');
    });

    it('falls back to the first custom attribute', () => {
      const attr = ci('my-attr', 'attr-key');
      app.onElementPicked(ai(null, [attr]));
      expect(app.selectedElement).toBe(attr);
      expect(app.selectedNodeType).toBe('custom-attribute');
      expect(app.selectedKindLabel).toBe('custom attribute');
    });

    it('fills in missing collections so the template can bind to them', () => {
      const element = { name: 'x', key: 'x', aliases: [] } as unknown as IControllerInfo;
      app.onElementPicked(ai(element));
      expect(app.selectedElement.bindables).toEqual([]);
      expect(app.selectedElement.properties).toEqual([]);
      expect(app.selectedElement.overrideContext).toEqual([]);
    });

    it('clears selection when nothing was picked', () => {
      app.selectedElement = ci('existing');
      app.onElementPicked(null);
      expect(app.selectedElement).toBeNull();
      expect(debugHost.stopPropertyWatching).toHaveBeenCalled();
    });

    it('clears selection when the payload is empty', () => {
      app.selectedElement = ci('existing');
      app.onElementPicked(ai(null, []));
      expect(app.selectedElement).toBeNull();
    });

    it('records the binding context origin', () => {
      app.onElementPicked({ ...ai(ci('parent')), __selectedElement: 'div', __isBindingContext: true });
      expect(app.selectedElementTagName).toBe('div');
      expect(app.isShowingBindingContext).toBe(true);
    });

    it('stops the picker and watches the selected component', () => {
      app.isElementPickerActive = true;
      app.onElementPicked(ai(ci('my-component', 'component-key')));
      expect(app.isElementPickerActive).toBe(false);
      expect(debugHost.stopElementPicker).toHaveBeenCalled();
      expect(debugHost.startPropertyWatching).toHaveBeenCalledWith({ componentKey: 'component-key', pollInterval: 500 });
    });

    it('prefers the instance id as the component key', () => {
      app.onElementPicked(ai({ ...ci('c', 'def-key'), instanceId: 'aui-3' }));
      expect(app.selectedComponentKey).toBe('aui-3');
    });

    it('loads the tree when it is still empty', () => {
      app.onElementPicked(ai(ci('c')));
      expect(debugHost.getComponentTree).toHaveBeenCalled();
    });
  });

  describe('clearSelection', () => {
    it('resets everything derived from the selection', () => {
      app.selectedElement = ci('test');
      app.selectedElementAttributes = [ci('attr')];
      app.selectedElementTagName = 'div';
      app.isShowingBindingContext = true;
      app.lifecycleHooks = { version: 2, hooks: [] };

      app.clearSelection();

      expect(debugHost.stopPropertyWatching).toHaveBeenCalled();
      expect(app.selectedElement).toBeNull();
      expect(app.selectedElementAttributes).toEqual([]);
      expect(app.selectedElementTagName).toBeNull();
      expect(app.isShowingBindingContext).toBe(false);
      expect(app.lifecycleHooks).toBeNull();
    });
  });

  describe('onPropertyChanges', () => {
    it('updates bindables and properties of the selected component', () => {
      const bindable = { name: 'count', value: 0, type: 'number' };
      const property = { name: 'message', value: 'old', type: 'string' };
      app.selectedElement = { ...ci('test', 'test-key'), bindables: [bindable], properties: [property] };

      app.onPropertyChanges(
        [
          { componentKey: 'test-key', propertyName: 'count', propertyType: 'bindable', oldValue: 0, newValue: 5, timestamp: 1 },
          { componentKey: 'test-key', propertyName: 'message', propertyType: 'property', oldValue: 'old', newValue: 'new', timestamp: 1 },
        ],
        { componentKey: 'test-key', bindables: [], properties: [], timestamp: 1 }
      );

      expect(bindable.value).toBe(5);
      expect(property.value).toBe('new');
    });

    it('ignores changes for another component or without selection', () => {
      const property = { name: 'message', value: 'original', type: 'string' };
      app.selectedElement = { ...ci('selected', 'selected-key'), properties: [property] };

      app.onPropertyChanges(
        [{ componentKey: 'other', propertyName: 'message', propertyType: 'property', oldValue: 'a', newValue: 'b', timestamp: 1 }],
        { componentKey: 'other', bindables: [], properties: [], timestamp: 1 }
      );
      expect(property.value).toBe('original');

      app.selectedElement = null;
      expect(() => app.onPropertyChanges([{ propertyName: 'x' }] as any, {} as any)).not.toThrow();
    });
  });

  describe('sections and toolbar', () => {
    it('toggleSection flips and persists the state', () => {
      app.toggleSection('bindables');
      expect(app.expandedSections.bindables).toBe(false);
      expect(JSON.parse(localStorage.getItem('au-devtools.sections')!).bindables).toBe(false);
      app.toggleSection('bindables');
      expect(app.expandedSections.bindables).toBe(true);
    });

    it('toggleElementPicker starts and stops the page picker', () => {
      app.toggleElementPicker();
      expect(app.isElementPickerActive).toBe(true);
      expect(debugHost.startElementPicker).toHaveBeenCalled();
      app.toggleElementPicker();
      expect(app.isElementPickerActive).toBe(false);
      expect(debugHost.stopElementPicker).toHaveBeenCalled();
    });

    it('toggleFollowChromeSelection persists and resyncs when enabled', () => {
      app.toggleFollowChromeSelection();
      expect(app.followChromeSelection).toBe(false);
      expect(localStorage.getItem('au-devtools.followChromeSelection')).toBe('false');
      expect(debugHost.refreshSelection).not.toHaveBeenCalled();

      app.toggleFollowChromeSelection();
      expect(app.followChromeSelection).toBe(true);
      expect(debugHost.refreshSelection).toHaveBeenCalled();
    });
  });

  describe('search', () => {
    it('runs a search from input and opens the dropdown', async () => {
      debugHost.searchComponents.mockResolvedValue([{ key: 'comp-1', name: 'my-component', type: 'custom-element' }]);

      app.onSearchInput({ target: { value: 'My' } } as any);
      await flush();

      expect(debugHost.searchComponents).toHaveBeenCalledWith('my');
      expect(app.isSearchOpen).toBe(true);
      expect(app.activeSearchIndex).toBe(0);
      expect(app.isActiveSearchResult(0)).toBe(true);
    });

    it('drops stale results from an earlier query', async () => {
      let resolveFirst: (v: any) => void = () => {};
      debugHost.searchComponents
        .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
        .mockResolvedValueOnce([{ key: 'b', name: 'b', type: 'custom-element' }]);

      app.onSearchInput({ target: { value: 'a' } } as any);
      app.onSearchInput({ target: { value: 'b' } } as any);
      await flush();
      resolveFirst([{ key: 'a', name: 'a', type: 'custom-element' }]);
      await flush();

      expect(app.searchResults.map((r: any) => r.key)).toEqual(['b']);
    });

    it('clears results when the query is emptied', () => {
      app.searchResults = [{ key: '1', name: 'test', type: 'custom-element' }];
      app.isSearchOpen = true;
      app.onSearchInput({ target: { value: '' } } as any);
      expect(app.searchResults).toEqual([]);
      expect(app.isSearchOpen).toBe(false);
      expect(app.activeSearchIndex).toBe(-1);
    });

    it('supports keyboard navigation and selection', () => {
      app.searchQuery = 'x';
      app.searchResults = [
        { key: 'a', name: 'a', type: 'custom-element' },
        { key: 'b', name: 'b', type: 'custom-element' },
      ];
      app.activeSearchIndex = 0;
      const key = (k: string) => ({ key: k, preventDefault: jest.fn() }) as any;

      app.onSearchKeydown(key('ArrowDown'));
      expect(app.activeSearchIndex).toBe(1);
      expect(app.isSearchOpen).toBe(true);
      app.onSearchKeydown(key('ArrowDown'));
      expect(app.activeSearchIndex).toBe(0);
      app.onSearchKeydown(key('ArrowUp'));
      expect(app.activeSearchIndex).toBe(1);

      app.onSearchKeydown(key('Enter'));
      expect(debugHost.selectComponentByKey).toHaveBeenCalledWith('b');
      expect(app.searchQuery).toBe('');
      expect(app.isSearchOpen).toBe(false);
    });

    it('Escape clears the search', () => {
      app.searchQuery = 'x';
      app.searchResults = [{ key: 'a', name: 'a', type: 'custom-element' }];
      app.isSearchOpen = true;
      app.onSearchKeydown({ key: 'Escape', preventDefault: jest.fn() } as any);
      expect(app.searchQuery).toBe('');
      expect(app.searchResults).toEqual([]);
    });

    it('selectSearchResult prevents the input from losing focus first', () => {
      const event = { preventDefault: jest.fn() } as any;
      app.selectSearchResult({ key: 'comp-key', name: 'my-comp', type: 'custom-element' }, event);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(debugHost.selectComponentByKey).toHaveBeenCalledWith('comp-key');
    });

    it('openSearch only reopens when there is something to show', () => {
      app.openSearch();
      expect(app.isSearchOpen).toBe(false);
      app.searchQuery = 'a';
      app.searchResults = [{ key: 'a', name: 'a', type: 'custom-element' }];
      app.openSearch();
      expect(app.isSearchOpen).toBe(true);
      app.closeSearch();
      expect(app.isSearchOpen).toBe(false);
    });

    it('setActiveSearchIndex updates the highlighted row', () => {
      app.setActiveSearchIndex(2);
      expect(app.activeSearchIndex).toBe(2);
    });
  });

  describe('component tree', () => {
    const tree = () => [
      { key: 'app', name: 'app', tagName: 'app', type: 'custom-element', hasChildren: true, childCount: 1, children: [
        { key: 'child', name: 'child', tagName: 'child', type: 'custom-element', hasChildren: false, childCount: 0 },
      ] },
      { key: 'footer', name: 'footer', tagName: 'footer', type: 'custom-attribute', hasChildren: false, childCount: 0 },
    ];

    it('loadComponentTree stores the tree and tolerates failures', async () => {
      debugHost.getComponentTree.mockResolvedValue(tree());
      await app.loadComponentTree();
      expect(app.componentTree).toHaveLength(2);
      expect(app.hasComponentTree).toBe(true);
      expect(app.componentTreeCount).toBe(3);

      debugHost.getComponentTree.mockRejectedValue(new Error('boom'));
      await app.loadComponentTree();
      expect(app.componentTree).toEqual([]);
      expect(app.hasComponentTree).toBe(false);
    });

    it('treeRows follows expansion state', () => {
      app.componentTree = tree();
      expect(app.treeRows.map((r: any) => r.node.key)).toEqual(['app', 'footer']);

      app.toggleTreeNode(app.componentTree[0]);
      expect(app.treeRows.map((r: any) => `${r.node.key}@${r.depth}`)).toEqual(['app@0', 'child@1', 'footer@0']);
      expect(app.isTreeNodeExpanded(app.componentTree[0])).toBe(true);

      app.toggleTreeNode(app.componentTree[0]);
      expect(app.treeRows).toHaveLength(2);
    });

    it('toggleTreeNode ignores leaves and stops propagation', () => {
      const event = { stopPropagation: jest.fn() } as any;
      app.toggleTreeNode({ key: 'leaf', hasChildren: false }, event);
      expect(event.stopPropagation).toHaveBeenCalled();
      expect(app.isTreeNodeExpanded({ key: 'leaf' })).toBe(false);
    });

    it('selectTreeNode selects through the host', () => {
      app.selectTreeNode({ key: 'my-component', name: 'MyComponent' });
      expect(app.selectedTreeNodeKey).toBe('my-component');
      expect(app.isTreeNodeSelected({ key: 'my-component' })).toBe(true);
      expect(debugHost.selectComponentByKey).toHaveBeenCalledWith('my-component');
    });

    it('supports keyboard interaction on tree rows', () => {
      const node = { key: 'app', name: 'app', hasChildren: true };
      const key = (k: string) => ({ key: k, preventDefault: jest.fn() }) as any;

      app.onTreeKeydown(key('ArrowRight'), node);
      expect(app.expandedTreeKeys.app).toBe(true);
      app.onTreeKeydown(key('ArrowLeft'), node);
      expect(app.expandedTreeKeys.app).toBe(false);
      app.onTreeKeydown(key('Enter'), node);
      expect(debugHost.selectComponentByKey).toHaveBeenCalledWith('app');
      app.onTreeKeydown(key(' '), node);
      expect(debugHost.selectComponentByKey).toHaveBeenCalledTimes(2);
    });

    it('toggleTreePanel flips the panel', () => {
      app.toggleTreePanel();
      expect(app.isTreePanelExpanded).toBe(false);
    });
  });

  describe('timeline', () => {
    it('start and stop recording talk to the page', async () => {
      await app.startRecording();
      expect(app.isRecording).toBe(true);
      expect(debugHost.startInteractionRecording).toHaveBeenCalled();
      await app.stopRecording();
      expect(app.isRecording).toBe(false);
      expect(debugHost.stopInteractionRecording).toHaveBeenCalled();
    });

    it('onInteraction only records while recording and caps the log', () => {
      app.onInteraction({ id: 'ignored' });
      expect(app.timelineEvents).toEqual([]);

      app.isRecording = true;
      for (let i = 0; i < 205; i++) app.onInteraction({ id: `e${i}` });
      expect(app.timelineEvents).toHaveLength(200);
      expect(app.timelineEvents[0].id).toBe('e5');
      expect(app.timelineEventCount).toBe(200);
      expect(app.hasTimelineEvents).toBe(true);
    });

    it('clearTimeline resets events and the page log', () => {
      app.timelineEvents = [{ id: 'evt-1' }];
      app.expandedTimelineIds['evt-1'] = true;
      app.clearTimeline();
      expect(app.timelineEvents).toEqual([]);
      expect(app.expandedTimelineIds).toEqual({});
      expect(debugHost.clearInteractionLog).toHaveBeenCalled();
    });

    it('canClearTimeline is true while recording or with events', () => {
      expect(app.canClearTimeline).toBe(false);
      app.isRecording = true;
      expect(app.canClearTimeline).toBe(true);
    });

    it('toggles event expansion', () => {
      const event = { id: 'evt-1', eventName: 'click' };
      app.toggleTimelineEvent(event);
      expect(app.isTimelineEventExpanded(event)).toBe(true);
      app.toggleTimelineEvent(event);
      expect(app.isTimelineEventExpanded(event)).toBe(false);
    });

    it('selectTimelineComponent selects the target component without toggling the row', () => {
      const domEvent = { stopPropagation: jest.fn() } as any;
      app.selectTimelineComponent({ id: 'evt-1', target: { componentKey: 'my-component' } }, domEvent);
      expect(domEvent.stopPropagation).toHaveBeenCalled();
      expect(debugHost.selectComponentByKey).toHaveBeenCalledWith('my-component');

      app.selectTimelineComponent({ id: 'evt-2', target: null });
      expect(debugHost.selectComponentByKey).toHaveBeenCalledTimes(1);
    });

    it('formats timestamps and classifies events by mode', () => {
      expect(app.formatTimelineTimestamp(new Date('2024-01-15T10:30:45.123Z').getTime())).toMatch(/\.123$/);
      expect(app.timelineEventClass({ mode: 'navigation' })).toBe('mode-navigation');
      expect(app.timelineEventClass({})).toBe('mode-unknown');
    });

    it('snapshotRows formats before/after entries', () => {
      expect(app.snapshotRows({ a: 1, b: 'x' })).toEqual([
        { key: 'a', value: '1' },
        { key: 'b', value: '"x"' },
      ]);
      expect(app.snapshotRows(null)).toEqual([]);
    });
  });

  describe('enhanced info', () => {
    it('loads every snapshot for the selected component', async () => {
      debugHost.getLifecycleHooks.mockResolvedValue({ version: 2, hooks: [{ name: 'attached', implemented: true, isAsync: false }] });
      debugHost.getComputedProperties.mockResolvedValue([{ name: 'fullName', hasGetter: true }]);
      debugHost.getEnhancedDISnapshot.mockResolvedValue({ version: 2, dependencies: [{ name: 'A' }], containerHierarchy: { current: { id: 1 }, ancestors: [{ id: 0, isRoot: true }] }, availableServices: [{ name: 'S' }] });
      debugHost.getRouteInfo.mockResolvedValue({ currentRoute: '/users', params: [] });
      debugHost.getSlotInfo.mockResolvedValue({ slots: [{ name: 'default', hasContent: true }, { name: 'x', hasContent: false }] });
      debugHost.getTemplateSnapshot.mockResolvedValue({ bindings: [], controllers: [], hasSlots: true, shadowMode: 'none', isContainerless: false });
      app.selectedElement = ci('c', 'key');

      await app.loadEnhancedInfo();

      expect(app.hasLifecycleHooks).toBe(true);
      expect(app.implementedHooksCount).toBe(1);
      expect(app.totalHooksCount).toBe(1);
      expect(app.hasComputedProperties).toBe(true);
      expect(app.isEnhancedDI).toBe(true);
      expect(app.hasEnhancedDependencies).toBe(true);
      expect(app.hasContainerHierarchy).toBe(true);
      expect(app.availableServicesCount).toBe(1);
      expect(app.hasAnyDIInfo).toBe(true);
      expect(app.containerAncestorsReversed).toEqual([{ id: 0, isRoot: true }]);
      expect(app.currentContainerLabel).toBe('current');
      expect(app.hasRouteInfo).toBe(true);
      expect(app.hasSlots).toBe(true);
      expect(app.activeSlotCount).toBe(1);
      expect(app.hasTemplateMeta).toBe(true);
      expect(app.hasTemplateInfo).toBe(false);
    });

    it('treats a v1 snapshot as plain dependencies', async () => {
      debugHost.getEnhancedDISnapshot.mockResolvedValue({ dependencies: [{ name: 'HttpClient' }], containerDepth: 1 });
      app.selectedElement = ci('c', 'key');
      await app.loadEnhancedInfo();
      expect(app.isEnhancedDI).toBe(false);
      expect(app.hasDependencies).toBe(true);
    });

    it('discards results that arrive after the selection changed', async () => {
      let resolveHooks: (v: any) => void = () => {};
      debugHost.getLifecycleHooks.mockReturnValue(new Promise((resolve) => (resolveHooks = resolve)));
      app.selectedElement = ci('first', 'first');
      const pending = app.loadEnhancedInfo();
      app.selectedElement = ci('second', 'second');
      resolveHooks({ version: 2, hooks: [{ name: 'attached', implemented: true }] });
      await pending;
      expect(app.lifecycleHooks).toBeNull();
    });

    it('clears on failure or without selection', async () => {
      app.lifecycleHooks = { version: 2, hooks: [] };
      await app.loadEnhancedInfo();
      expect(app.lifecycleHooks).toBeNull();

      app.selectedElement = ci('c', 'key');
      debugHost.getLifecycleHooks.mockRejectedValue(new Error('nope'));
      app.lifecycleHooks = { version: 2, hooks: [] };
      await app.loadEnhancedInfo();
      expect(app.lifecycleHooks).toBeNull();
    });

    it('computes has* getters from the selection', () => {
      app.selectedElement = { ...ci('c'), bindables: [{ name: 'a' }], properties: [], overrideContext: [{ name: 'x' }], controller: { properties: [{ name: 'p' }] } };
      expect(app.hasBindables).toBe(true);
      expect(app.hasProperties).toBe(false);
      expect(app.hasOverrideContext).toBe(true);
      expect(app.hasController).toBe(true);
      app.selectedElementAttributes = [ci('attr')];
      expect(app.hasCustomAttributes).toBe(true);
    });

    it('toggleAvailableServices and previewRows', () => {
      app.toggleAvailableServices();
      expect(app.showAvailableServices).toBe(true);
      expect(app.previewRows({ a: 1 })).toEqual([{ key: 'a', value: '1' }]);
      expect(app.previewRows(undefined)).toEqual([]);
    });
  });

  describe('template debugger', () => {
    it('reads bindings and controllers from the snapshot', () => {
      expect(app.templateBindings).toEqual([]);
      expect(app.templateControllers).toEqual([]);
      app.templateSnapshot = {
        bindings: [{ id: 'b1', type: 'property', expression: 'foo', target: 'bar', value: 1, valueType: 'number', isBound: true }],
        controllers: [{ id: 'c1', type: 'if', isActive: true }],
      };
      expect(app.hasTemplateInfo).toBe(true);
      expect(app.templateBindingsCount).toBe(1);
      expect(app.templateControllersCount).toBe(1);
    });

    it('toggles binding and controller details', () => {
      const binding = { id: 'b1' };
      app.toggleBindingExpand(binding);
      expect(app.isBindingExpanded(binding)).toBe(true);
      app.toggleBindingExpand(binding);
      expect(app.isBindingExpanded(binding)).toBe(false);

      const controller = { id: 'c1' };
      app.toggleControllerExpand(controller);
      expect(app.isControllerExpanded(controller)).toBe(true);
    });

    it('labels binding types and modes', () => {
      expect(app.bindingTypeLabel('property')).toBe('prop');
      expect(app.bindingTypeLabel('listener')).toBe('event');
      expect(app.bindingTypeLabel('custom')).toBe('custom');
      expect(app.bindingModeLabel('oneTime')).toBe('one-time');
      expect(app.bindingModeLabel('toView')).toBe('→');
      expect(app.bindingModeLabel('fromView')).toBe('←');
      expect(app.bindingModeLabel('twoWay')).toBe('↔');
      expect(app.bindingModeLabel(undefined)).toBe('→');
      expect(app.bindingModeClass('twoWay')).toBe('mode-two-way');
      expect(app.bindingModeClass('bogus')).toBe('mode-default');
    });

    it('formats values and classifies controllers', () => {
      expect(app.formatBindingValue({ a: 1 })).toBe('{"a":1}');
      expect(app.isConditionalController({ type: 'else' })).toBe(true);
      expect(app.isConditionalController({ type: 'repeat' })).toBe(false);
      expect(app.hasRepeatItems({ type: 'repeat', items: [{}] })).toBe(true);
      expect(app.hasRepeatItems({ type: 'repeat', items: [] })).toBe(false);
    });
  });

  describe('expression evaluation', () => {
    it('evaluates in the selected component and records history', async () => {
      app.selectedElement = ci('c', 'key');
      app.expressionInput = ' this.count ';
      expect(app.canEvaluate).toBe(true);

      await app.evaluateExpression();

      expect(debugHost.evaluateExpression).toHaveBeenCalledWith('key', 'this.count');
      expect(app.expressionResult).toBe('1');
      expect(app.expressionResultType).toBe('number');
      expect(app.expressionHistory).toEqual(['this.count']);
    });

    it('reports errors and missing selection', async () => {
      app.expressionInput = 'x';
      await app.evaluateExpression();
      expect(app.expressionError).toBe('No component selected');

      app.selectedElement = ci('c', 'key');
      debugHost.evaluateExpression.mockResolvedValue({ success: false, error: 'bad' });
      await app.evaluateExpression();
      expect(app.expressionError).toBe('bad');
      expect(app.expressionResult).toBe('');
    });

    it('caps history and avoids duplicates', async () => {
      app.selectedElement = ci('c', 'key');
      for (let i = 0; i < 12; i++) {
        app.expressionInput = `e${i}`;
        await app.evaluateExpression();
      }
      app.expressionInput = 'e11';
      await app.evaluateExpression();
      expect(app.expressionHistory).toHaveLength(10);
      expect(app.expressionHistory[0]).toBe('e11');
    });

    it('Enter triggers evaluation from the input', () => {
      const spy = jest.spyOn(app, 'evaluateExpression').mockResolvedValue(undefined);
      app.onExpressionKeydown({ key: 'Enter', preventDefault: jest.fn() } as any);
      app.onExpressionKeydown({ key: 'a', preventDefault: jest.fn() } as any);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('history selection and clearing', () => {
      app.selectHistoryExpression('this.count');
      expect(app.expressionInput).toBe('this.count');
      app.expressionResult = 'r';
      app.expressionError = 'e';
      app.clearExpressionResult();
      expect(app.expressionResult).toBe('');
      expect(app.expressionError).toBe('');
    });
  });

  describe('export and reveal', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('copies the component as JSON', async () => {
      const writeText = jest.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });
      app.selectedElement = { ...ci('comp', 'key'), bindables: [{ name: 'a', value: 1, type: 'number' }] };
      app.selectedElementAttributes = [{ ...ci('attr'), bindables: [{ name: 'b', value: 'x', type: 'string' }] }];

      await app.exportComponentAsJson();

      const payload = JSON.parse(writeText.mock.calls[0][0]);
      expect(payload.meta.name).toBe('comp');
      expect(payload.bindables).toEqual({ a: { value: 1, type: 'number' } });
      expect(payload.customAttributes[0].bindables).toEqual({ b: { value: 'x', type: 'string' } });
      expect(app.isExportCopied).toBe(true);
      jest.advanceTimersByTime(1500);
      expect(app.isExportCopied).toBe(false);
    });

    it('does nothing without a selection or when the clipboard fails', async () => {
      await app.exportComponentAsJson();
      Object.assign(navigator, { clipboard: { writeText: jest.fn().mockRejectedValue(new Error('x')) } });
      app.selectedElement = ci('comp');
      await app.exportComponentAsJson();
      expect(app.isExportCopied).toBe(false);
    });

    it('reveals the selected element or attribute', () => {
      app.selectedElement = ci('my-component', 'my-key');
      app.revealInElements();
      expect(debugHost.revealInElements).toHaveBeenCalledWith({
        name: 'my-component',
        type: 'custom-element',
        customElementInfo: app.selectedElement,
        customAttributesInfo: [],
      });

      app.selectedNodeType = 'custom-attribute';
      app.revealInElements();
      expect(debugHost.revealInElements).toHaveBeenLastCalledWith(
        expect.objectContaining({ customElementInfo: null, customAttributesInfo: [app.selectedElement] })
      );

      app.selectedElement = null;
      app.revealInElements();
      expect(debugHost.revealInElements).toHaveBeenCalledTimes(2);
    });
  });
});
