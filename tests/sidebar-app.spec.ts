import './setup';
import { ChromeTest } from './setup';
import { stubPlatform } from './helpers';
import type { AureliaInfo, IControllerInfo, Property } from '@/shared/types';

let SidebarAppClass: any;

function stubSidebarDebugHost(overrides: Partial<Record<string, any>> = {}) {
  return {
    attach: jest.fn(),
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
    getDependencies: jest.fn().mockResolvedValue(null),
    getEnhancedDISnapshot: jest.fn().mockResolvedValue(null),
    getRouteInfo: jest.fn().mockResolvedValue(null),
    getSlotInfo: jest.fn().mockResolvedValue(null),
    getComponentTree: jest.fn().mockResolvedValue([]),
    startInteractionRecording: jest.fn().mockResolvedValue(true),
    stopInteractionRecording: jest.fn().mockResolvedValue(true),
    clearInteractionLog: jest.fn(),
    getTemplateSnapshot: jest.fn().mockResolvedValue(null),
    ...overrides
  };
}

function ci(name: string, key?: string): IControllerInfo {
  return {
    name,
    key: key ?? name,
    aliases: [],
    bindables: [],
    properties: []
  } as any;
}

function ai(element: IControllerInfo | null, attrs: IControllerInfo[] = []): AureliaInfo {
  return {
    customElementInfo: element as any,
    customAttributesInfo: attrs as any
  };
}

describe('SidebarApp', () => {
  let app: any;
  let debugHost: any;
  let plat: any;

  beforeEach(async () => {
    ChromeTest.reset();
    jest.resetModules();

    const mod = await import('@/sidebar/sidebar-app');
    SidebarAppClass = mod.SidebarApp;

    app = Object.create(SidebarAppClass.prototype);

    app.isDarkTheme = false;
    app.aureliaDetected = false;
    app.aureliaVersion = null;
    app.detectionState = 'checking';
    app.extensionInvalidated = false;
    app.selectedElement = null;
    app.selectedElementAttributes = [];
    app.selectedNodeType = 'custom-element';
    app.selectedElementTagName = null;
    app.isShowingBindingContext = false;
    app.isElementPickerActive = false;
    app.followChromeSelection = true;
    app.searchQuery = '';
    app.searchResults = [];
    app.isSearchOpen = false;
    app.expandedSections = {
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
    app.componentTree = [];
    app.expandedTreeNodes = new Set();
    app.selectedTreeNodeKey = null;
    app.isTreePanelExpanded = true;
    app.treeRevision = 0;
    app.isRecording = false;
    app.timelineEvents = [];
    app.expandedTimelineEvents = new Set();
    app.templateSnapshot = null;
    app.expandedBindings = new Set();
    app.expandedControllers = new Set();
    app.lifecycleHooks = null;
    app.computedProperties = [];
    app.dependencies = null;
    app.routeInfo = null;
    app.slotInfo = null;
    app.expressionInput = '';
    app.expressionResult = '';
    app.expressionResultType = '';
    app.expressionError = '';
    app.expressionHistory = [];
    app.copiedPropertyId = null;
    app.propertyRowsRevision = 0;

    debugHost = stubSidebarDebugHost();
    plat = stubPlatform();

    (app as any).debugHost = debugHost;
    (app as any).plat = plat;
  });

  describe('onElementPicked', () => {
    it('sets selectedElement for custom element', () => {
      const element = ci('my-component', 'my-key');
      element.bindables = [{ name: 'value', value: 1, type: 'number' }] as any;
      element.properties = [{ name: 'count', value: 5, type: 'number' }] as any;

      app.onElementPicked(ai(element));

      expect(app.selectedElement).toBe(element);
      expect(app.selectedNodeType).toBe('custom-element');
      expect(app.selectedElementAttributes).toEqual([]);
    });

    it('sets selectedElement for custom attribute when no element', () => {
      const attr = ci('my-attr', 'attr-key');

      app.onElementPicked(ai(null, [attr]));

      expect(app.selectedElement).toBe(attr);
      expect(app.selectedNodeType).toBe('custom-attribute');
    });

    it('clears selection when no component info', () => {
      app.selectedElement = ci('existing');

      app.onElementPicked(null as any);

      expect(app.selectedElement).toBeNull();
    });

    it('tracks binding context info', () => {
      const element = ci('parent-component');
      const info = {
        ...ai(element),
        __selectedElement: 'div',
        __isBindingContext: true
      };

      app.onElementPicked(info);

      expect(app.selectedElementTagName).toBe('div');
      expect(app.isShowingBindingContext).toBe(true);
    });

    it('starts property watching when element selected', () => {
      const element = ci('my-component', 'component-key');

      app.onElementPicked(ai(element));

      expect(debugHost.startPropertyWatching).toHaveBeenCalledWith({
        componentKey: 'component-key',
        pollInterval: 500
      });
    });

    it('filters out duplicate attributes with same key as element', () => {
      const element = ci('my-element', 'my-key');
      const dupAttr = ci('my-element', 'my-key');
      const realAttr = ci('other-attr', 'other-key');

      app.onElementPicked(ai(element, [dupAttr, realAttr]));

      expect(app.selectedElementAttributes).toHaveLength(2);
    });
  });

  describe('clearSelection', () => {
    it('stops property watching and clears all selection state', () => {
      app.selectedElement = ci('test');
      app.selectedElementAttributes = [ci('attr')];
      app.selectedElementTagName = 'div';
      app.isShowingBindingContext = true;

      app.clearSelection();

      expect(debugHost.stopPropertyWatching).toHaveBeenCalled();
      expect(app.selectedElement).toBeNull();
      expect(app.selectedElementAttributes).toEqual([]);
      expect(app.selectedElementTagName).toBeNull();
      expect(app.isShowingBindingContext).toBe(false);
    });
  });

  describe('toggleSection', () => {
    it('toggles section expanded state', () => {
      expect(app.expandedSections.bindables).toBe(true);

      app.toggleSection('bindables');

      expect(app.expandedSections.bindables).toBe(false);

      app.toggleSection('bindables');

      expect(app.expandedSections.bindables).toBe(true);
    });
  });

  describe('toggleElementPicker', () => {
    it('starts picker when activating', () => {
      app.isElementPickerActive = false;

      app.toggleElementPicker();

      expect(app.isElementPickerActive).toBe(true);
      expect(debugHost.startElementPicker).toHaveBeenCalled();
    });

    it('stops picker when deactivating', () => {
      app.isElementPickerActive = true;

      app.toggleElementPicker();

      expect(app.isElementPickerActive).toBe(false);
      expect(debugHost.stopElementPicker).toHaveBeenCalled();
    });
  });

  describe('toggleFollowChromeSelection', () => {
    it('toggles follow state', () => {
      app.followChromeSelection = true;

      app.toggleFollowChromeSelection();

      expect(app.followChromeSelection).toBe(false);
    });
  });

  describe('search', () => {
    it('handleSearchInput opens search with results', async () => {
      debugHost.searchComponents.mockResolvedValue([
        { key: 'comp-1', name: 'my-component', type: 'custom-element' }
      ]);

      const event = { target: { value: 'my' } } as any;
      app.handleSearchInput(event);

      expect(app.searchQuery).toBe('my');
      expect(app.isSearchOpen).toBe(true);
    });

    it('handleSearchInput clears results when query empty', () => {
      app.searchResults = [{ key: '1', name: 'test', type: 'custom-element' }];
      app.isSearchOpen = true;

      const event = { target: { value: '' } } as any;
      app.handleSearchInput(event);

      expect(app.searchResults).toEqual([]);
      expect(app.isSearchOpen).toBe(false);
    });

    it('selectSearchResult calls debugHost and clears search', () => {
      const result = { key: 'comp-key', name: 'my-comp', type: 'custom-element' as const };
      app.searchQuery = 'my';
      app.isSearchOpen = true;

      app.selectSearchResult(result);

      expect(debugHost.selectComponentByKey).toHaveBeenCalledWith('comp-key');
      expect(app.searchQuery).toBe('');
      expect(app.isSearchOpen).toBe(false);
    });

    it('clearSearch resets search state', () => {
      app.searchQuery = 'test';
      app.searchResults = [{ key: '1', name: 'test', type: 'custom-element' }];
      app.isSearchOpen = true;

      app.clearSearch();

      expect(app.searchQuery).toBe('');
      expect(app.searchResults).toEqual([]);
      expect(app.isSearchOpen).toBe(false);
    });
  });

  describe('property editing', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('editProperty sets isEditing and stores original value', () => {
      const prop: any = { name: 'test', value: 'original', type: 'string' };

      app.editProperty(prop);

      expect(prop.isEditing).toBe(true);
      expect(prop.originalValue).toBe('original');
    });

    it('saveProperty converts number and calls updateValues', () => {
      const prop: any = { name: 'count', value: 1, type: 'number', isEditing: true };
      app.selectedElement = { bindables: [], properties: [prop] };

      app.saveProperty(prop, '42');
      jest.runOnlyPendingTimers();

      expect(prop.value).toBe(42);
      expect(prop.isEditing).toBe(false);
      expect(debugHost.updateValues).toHaveBeenCalled();
    });

    it('saveProperty reverts on invalid number', () => {
      const prop: any = { name: 'count', value: 5, type: 'number', isEditing: true, originalValue: 5 };
      app.selectedElement = { bindables: [], properties: [prop] };

      app.saveProperty(prop, 'not-a-number');

      expect(prop.value).toBe(5);
      expect(prop.isEditing).toBe(false);
    });

    it('saveProperty converts boolean true', () => {
      const prop: any = { name: 'active', value: false, type: 'boolean', isEditing: true };
      app.selectedElement = { bindables: [], properties: [prop] };

      app.saveProperty(prop, 'true');
      jest.runOnlyPendingTimers();

      expect(prop.value).toBe(true);
    });

    it('saveProperty converts boolean false', () => {
      const prop: any = { name: 'active', value: true, type: 'boolean', isEditing: true };
      app.selectedElement = { bindables: [], properties: [prop] };

      app.saveProperty(prop, 'false');
      jest.runOnlyPendingTimers();

      expect(prop.value).toBe(false);
    });

    it('saveProperty reverts on invalid boolean', () => {
      const prop: any = { name: 'active', value: true, type: 'boolean', isEditing: true, originalValue: true };
      app.selectedElement = { bindables: [], properties: [prop] };

      app.saveProperty(prop, 'invalid');

      expect(prop.value).toBe(true);
    });

    it('cancelPropertyEdit reverts property', () => {
      const prop: any = { name: 'test', value: 'new', type: 'string', isEditing: true, originalValue: 'original' };

      app.cancelPropertyEdit(prop);

      expect(prop.value).toBe('original');
      expect(prop.isEditing).toBe(false);
    });
  });

  describe('property expansion', () => {
    it('togglePropertyExpansion does nothing when canExpand is false', () => {
      const prop: any = { canExpand: false, isExpanded: false };

      app.togglePropertyExpansion(prop);

      expect(prop.isExpanded).toBe(false);
    });

    it('togglePropertyExpansion expands when already has expandedValue', () => {
      const prop: any = { canExpand: true, isExpanded: false, expandedValue: { properties: [] } };

      app.togglePropertyExpansion(prop);

      expect(prop.isExpanded).toBe(true);
    });

    it('togglePropertyExpansion collapses when expanded', () => {
      const prop: any = { canExpand: true, isExpanded: true };

      app.togglePropertyExpansion(prop);

      expect(prop.isExpanded).toBe(false);
    });
  });

  describe('onPropertyChanges', () => {
    it('updates bindable values', () => {
      const bindable: any = { name: 'count', value: 0, type: 'number' };
      app.selectedElement = {
        key: 'test-key',
        name: 'test',
        bindables: [bindable],
        properties: [],
      };

      const changes = [{
        componentKey: 'test-key',
        propertyName: 'count',
        propertyType: 'bindable',
        oldValue: 0,
        newValue: 5,
        timestamp: Date.now(),
      }];

      const snapshot = {
        componentKey: 'test-key',
        bindables: [{ name: 'count', value: 5, type: 'number' }],
        properties: [],
        timestamp: Date.now(),
      };

      app.onPropertyChanges(changes, snapshot);

      expect(bindable.value).toBe(5);
    });

    it('updates property values', () => {
      const property: any = { name: 'message', value: 'old', type: 'string' };
      app.selectedElement = {
        key: 'test-key',
        name: 'test',
        bindables: [],
        properties: [property],
      };

      const changes = [{
        componentKey: 'test-key',
        propertyName: 'message',
        propertyType: 'property',
        oldValue: 'old',
        newValue: 'new',
        timestamp: Date.now(),
      }];

      const snapshot = {
        componentKey: 'test-key',
        bindables: [],
        properties: [{ name: 'message', value: 'new', type: 'string' }],
        timestamp: Date.now(),
      };

      app.onPropertyChanges(changes, snapshot);

      expect(property.value).toBe('new');
    });

    it('ignores changes for different component', () => {
      const property: any = { name: 'message', value: 'original', type: 'string' };
      app.selectedElement = {
        key: 'selected-key',
        name: 'selected',
        bindables: [],
        properties: [property],
      };

      const changes = [{
        componentKey: 'different-key',
        propertyName: 'message',
        propertyType: 'property',
        oldValue: 'old',
        newValue: 'new',
        timestamp: Date.now(),
      }];

      const snapshot = {
        componentKey: 'different-key',
        bindables: [],
        properties: [],
        timestamp: Date.now(),
      };

      app.onPropertyChanges(changes, snapshot);

      expect(property.value).toBe('original');
    });

    it('does nothing when no selected element', () => {
      app.selectedElement = null;

      const changes = [{
        componentKey: 'any-key',
        propertyName: 'prop',
        propertyType: 'property',
        oldValue: 'old',
        newValue: 'new',
        timestamp: Date.now(),
      }];

      expect(() => app.onPropertyChanges(changes, {})).not.toThrow();
    });
  });

  describe('computed getters', () => {
    it('hasBindables returns true when bindables exist', () => {
      app.selectedElement = { bindables: [{ name: 'test' }], properties: [] };
      expect(app.hasBindables).toBe(true);
    });

    it('hasBindables returns false when no bindables', () => {
      app.selectedElement = { bindables: [], properties: [] };
      expect(app.hasBindables).toBe(false);
    });

    it('hasProperties returns true when properties exist', () => {
      app.selectedElement = { bindables: [], properties: [{ name: 'test' }] };
      expect(app.hasProperties).toBe(true);
    });

    it('hasCustomAttributes returns true when attributes exist', () => {
      app.selectedElementAttributes = [ci('test-attr')];
      expect(app.hasCustomAttributes).toBe(true);
    });

    it('hasLifecycleHooks returns true when hooks exist', () => {
      app.lifecycleHooks = { hooks: [{ name: 'attached', implemented: true }] };
      expect(app.hasLifecycleHooks).toBe(true);
    });

    it('implementedHooksCount counts implemented hooks', () => {
      app.lifecycleHooks = {
        hooks: [
          { name: 'attached', implemented: true },
          { name: 'detached', implemented: false },
          { name: 'bound', implemented: true },
        ]
      };
      expect(app.implementedHooksCount).toBe(2);
    });

    it('totalHooksCount returns all hooks', () => {
      app.lifecycleHooks = { hooks: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] };
      expect(app.totalHooksCount).toBe(3);
    });

    it('activeSlotCount counts slots with content', () => {
      app.slotInfo = {
        slots: [
          { name: 'default', hasContent: true },
          { name: 'header', hasContent: false },
          { name: 'footer', hasContent: true },
        ]
      };
      expect(app.activeSlotCount).toBe(2);
    });

    it('hasRouteInfo returns true when currentRoute exists', () => {
      app.routeInfo = { currentRoute: '/users' };
      expect(app.hasRouteInfo).toBe(true);
    });

    it('hasSlots returns true when slots exist', () => {
      app.slotInfo = { slots: [{ name: 'default' }] };
      expect(app.hasSlots).toBe(true);
    });

    it('hasComputedProperties returns true when computed exist', () => {
      app.computedProperties = [{ name: 'fullName', hasGetter: true }];
      expect(app.hasComputedProperties).toBe(true);
    });

    it('hasDependencies returns true when dependencies exist', () => {
      app.dependencies = { dependencies: [{ name: 'HttpClient' }] };
      expect(app.hasDependencies).toBe(true);
    });
  });

  describe('formatPropertyValue', () => {
    it('formats null', () => {
      expect(app.formatPropertyValue(null)).toBe('null');
    });

    it('formats undefined', () => {
      expect(app.formatPropertyValue(undefined)).toBe('undefined');
    });

    it('formats string with quotes', () => {
      expect(app.formatPropertyValue('hello')).toBe('"hello"');
    });

    it('formats array with length', () => {
      expect(app.formatPropertyValue([1, 2, 3])).toBe('Array(3)');
    });

    it('formats object as {...}', () => {
      expect(app.formatPropertyValue({ a: 1 })).toBe('{...}');
    });

    it('formats number as string', () => {
      expect(app.formatPropertyValue(42)).toBe('42');
    });

    it('formats boolean as string', () => {
      expect(app.formatPropertyValue(true)).toBe('true');
    });
  });

  describe('getPropertyTypeClass', () => {
    it('returns type-string for string', () => {
      expect(app.getPropertyTypeClass('string')).toBe('type-string');
    });

    it('returns type-number for number', () => {
      expect(app.getPropertyTypeClass('number')).toBe('type-number');
    });

    it('returns type-boolean for boolean', () => {
      expect(app.getPropertyTypeClass('boolean')).toBe('type-boolean');
    });

    it('returns type-null for null', () => {
      expect(app.getPropertyTypeClass('null')).toBe('type-null');
    });

    it('returns type-object for object', () => {
      expect(app.getPropertyTypeClass('object')).toBe('type-object');
    });

    it('returns type-function for function', () => {
      expect(app.getPropertyTypeClass('function')).toBe('type-function');
    });

    it('returns type-default for unknown', () => {
      expect(app.getPropertyTypeClass('unknown')).toBe('type-default');
    });
  });

  describe('getPropertyRows', () => {
    it('returns empty array for undefined properties', () => {
      expect(app.getPropertyRows(undefined)).toEqual([]);
    });

    it('returns empty array for empty properties', () => {
      expect(app.getPropertyRows([])).toEqual([]);
    });

    it('flattens properties with depth', () => {
      const props = [
        { name: 'a', value: 1 },
        { name: 'b', value: 2 },
      ];

      const rows = app.getPropertyRows(props);

      expect(rows).toHaveLength(2);
      expect(rows[0].depth).toBe(0);
      expect(rows[1].depth).toBe(0);
    });

    it('includes expanded nested properties', () => {
      const props = [
        {
          name: 'obj',
          value: {},
          isExpanded: true,
          expandedValue: {
            properties: [
              { name: 'nested', value: 'inner' }
            ]
          }
        }
      ];

      const rows = app.getPropertyRows(props);

      expect(rows).toHaveLength(2);
      expect(rows[0].property.name).toBe('obj');
      expect(rows[0].depth).toBe(0);
      expect(rows[1].property.name).toBe('nested');
      expect(rows[1].depth).toBe(1);
    });
  });

  describe('expression evaluation', () => {
    it('selectHistoryExpression sets expressionInput', () => {
      app.selectHistoryExpression('this.count');
      expect(app.expressionInput).toBe('this.count');
    });

    it('clearExpressionResult clears all result state', () => {
      app.expressionResult = 'some result';
      app.expressionResultType = 'string';
      app.expressionError = 'some error';

      app.clearExpressionResult();

      expect(app.expressionResult).toBe('');
      expect(app.expressionResultType).toBe('');
      expect(app.expressionError).toBe('');
    });
  });

  describe('revealInElements', () => {
    it('calls debugHost with component info', () => {
      app.selectedElement = ci('my-component', 'my-key');
      app.selectedNodeType = 'custom-element';
      app.selectedElementAttributes = [];

      app.revealInElements();

      expect(debugHost.revealInElements).toHaveBeenCalledWith({
        name: 'my-component',
        type: 'custom-element',
        customElementInfo: app.selectedElement,
        customAttributesInfo: [],
      });
    });

    it('does nothing when no selectedElement', () => {
      app.selectedElement = null;

      app.revealInElements();

      expect(debugHost.revealInElements).not.toHaveBeenCalled();
    });
  });

  describe('checkExtensionInvalidated', () => {
    it('returns false when chrome.runtime.id exists', () => {
      expect(app.checkExtensionInvalidated()).toBe(false);
      expect(app.extensionInvalidated).toBe(false);
    });

    it('returns true and sets flag when chrome.runtime.id missing', () => {
      const originalId = (global as any).chrome.runtime.id;
      delete (global as any).chrome.runtime.id;

      expect(app.checkExtensionInvalidated()).toBe(true);
      expect(app.extensionInvalidated).toBe(true);

      (global as any).chrome.runtime.id = originalId;
    });
  });

  describe('component tree', () => {
    it('loadComponentTree populates componentTree from debugHost', async () => {
      const mockTree = [
        { key: 'app', name: 'App', tagName: 'app', type: 'custom-element', hasChildren: true, childCount: 1 },
        { key: 'header', name: 'Header', tagName: 'header', type: 'custom-element', hasChildren: false, childCount: 0 },
      ];
      debugHost.getComponentTree.mockResolvedValue(mockTree);

      await app.loadComponentTree();

      expect(app.componentTree).toEqual(mockTree);
      expect(app.treeRevision).toBe(1);
    });

    it('loadComponentTree handles errors gracefully', async () => {
      debugHost.getComponentTree.mockRejectedValue(new Error('Network error'));

      await app.loadComponentTree();

      expect(app.componentTree).toEqual([]);
    });

    it('toggleTreePanel toggles isTreePanelExpanded', () => {
      expect(app.isTreePanelExpanded).toBe(true);

      app.toggleTreePanel();
      expect(app.isTreePanelExpanded).toBe(false);

      app.toggleTreePanel();
      expect(app.isTreePanelExpanded).toBe(true);
    });

    it('toggleTreeNode expands node with children', () => {
      const node = { key: 'app', name: 'App', hasChildren: true };

      app.toggleTreeNode(node);

      expect(app.expandedTreeNodes.has('app')).toBe(true);
      expect(app.treeRevision).toBe(1);
    });

    it('toggleTreeNode collapses already expanded node', () => {
      const node = { key: 'app', name: 'App', hasChildren: true };
      app.expandedTreeNodes.add('app');

      app.toggleTreeNode(node);

      expect(app.expandedTreeNodes.has('app')).toBe(false);
    });

    it('toggleTreeNode does nothing for node without children', () => {
      const node = { key: 'leaf', name: 'Leaf', hasChildren: false };

      app.toggleTreeNode(node);

      expect(app.expandedTreeNodes.has('leaf')).toBe(false);
    });

    it('selectTreeNode updates selection and calls debugHost', () => {
      const node = { key: 'my-component', name: 'MyComponent' };

      app.selectTreeNode(node);

      expect(app.selectedTreeNodeKey).toBe('my-component');
      expect(debugHost.selectComponentByKey).toHaveBeenCalledWith('my-component');
    });

    it('getTreeRows returns empty for empty tree', () => {
      app.componentTree = [];
      expect(app.getTreeRows()).toEqual([]);
    });

    it('getTreeRows flattens tree with depth', () => {
      app.componentTree = [
        { key: 'app', name: 'App', hasChildren: true, children: [
          { key: 'child', name: 'Child', hasChildren: false }
        ]}
      ];
      app.expandedTreeNodes.add('app');

      const rows = app.getTreeRows();

      expect(rows).toHaveLength(2);
      expect(rows[0].node.key).toBe('app');
      expect(rows[0].depth).toBe(0);
      expect(rows[1].node.key).toBe('child');
      expect(rows[1].depth).toBe(1);
    });

    it('getTreeRows excludes collapsed children', () => {
      app.componentTree = [
        { key: 'app', name: 'App', hasChildren: true, children: [
          { key: 'child', name: 'Child', hasChildren: false }
        ]}
      ];

      const rows = app.getTreeRows();

      expect(rows).toHaveLength(1);
      expect(rows[0].node.key).toBe('app');
    });

    it('isTreeNodeExpanded returns correct state', () => {
      const node = { key: 'test' };
      expect(app.isTreeNodeExpanded(node)).toBe(false);

      app.expandedTreeNodes.add('test');
      expect(app.isTreeNodeExpanded(node)).toBe(true);
    });

    it('isTreeNodeSelected returns correct state', () => {
      const node = { key: 'test' };
      expect(app.isTreeNodeSelected(node)).toBe(false);

      app.selectedTreeNodeKey = 'test';
      expect(app.isTreeNodeSelected(node)).toBe(true);
    });

    it('hasComponentTree returns true when tree has nodes', () => {
      app.componentTree = [];
      expect(app.hasComponentTree).toBe(false);

      app.componentTree = [{ key: 'app', name: 'App' }];
      expect(app.hasComponentTree).toBe(true);
    });

    it('componentTreeCount counts all nodes including nested', () => {
      app.componentTree = [
        { key: 'app', name: 'App', children: [
          { key: 'child1', name: 'Child1' },
          { key: 'child2', name: 'Child2', children: [
            { key: 'grandchild', name: 'GrandChild' }
          ]}
        ]},
        { key: 'footer', name: 'Footer' }
      ];

      expect(app.componentTreeCount).toBe(5);
    });
  });

  describe('timeline / interaction recorder', () => {
    it('startRecording sets isRecording and calls debugHost', async () => {
      await app.startRecording();

      expect(app.isRecording).toBe(true);
      expect(debugHost.startInteractionRecording).toHaveBeenCalled();
    });

    it('stopRecording clears isRecording and calls debugHost', async () => {
      app.isRecording = true;

      await app.stopRecording();

      expect(app.isRecording).toBe(false);
      expect(debugHost.stopInteractionRecording).toHaveBeenCalled();
    });

    it('clearTimeline clears events and calls debugHost', () => {
      app.timelineEvents = [{ id: 'evt-1' }, { id: 'evt-2' }] as any;
      app.expandedTimelineEvents.add('evt-1');

      app.clearTimeline();

      expect(app.timelineEvents).toEqual([]);
      expect(app.expandedTimelineEvents.size).toBe(0);
      expect(debugHost.clearInteractionLog).toHaveBeenCalled();
    });

    it('toggleTimelineEvent expands event', () => {
      const event = { id: 'evt-1', eventName: 'click' } as any;
      app.timelineEvents = [event];

      app.toggleTimelineEvent(event);

      expect(app.expandedTimelineEvents.has('evt-1')).toBe(true);
    });

    it('toggleTimelineEvent collapses already expanded event', () => {
      const event = { id: 'evt-1', eventName: 'click' } as any;
      app.timelineEvents = [event];
      app.expandedTimelineEvents.add('evt-1');

      app.toggleTimelineEvent(event);

      expect(app.expandedTimelineEvents.has('evt-1')).toBe(false);
    });

    it('isTimelineEventExpanded returns correct state', () => {
      const event = { id: 'evt-1' } as any;

      expect(app.isTimelineEventExpanded(event)).toBe(false);

      app.expandedTimelineEvents.add('evt-1');
      expect(app.isTimelineEventExpanded(event)).toBe(true);
    });

    it('selectTimelineComponent calls debugHost when target has componentKey', () => {
      const event = { id: 'evt-1', target: { componentKey: 'my-component' } } as any;

      app.selectTimelineComponent(event);

      expect(debugHost.selectComponentByKey).toHaveBeenCalledWith('my-component');
    });

    it('selectTimelineComponent does nothing when no target componentKey', () => {
      const event = { id: 'evt-1', target: null } as any;

      app.selectTimelineComponent(event);

      expect(debugHost.selectComponentByKey).not.toHaveBeenCalled();
    });

    it('hasTimelineEvents returns true when events exist', () => {
      app.timelineEvents = [];
      expect(app.hasTimelineEvents).toBe(false);

      app.timelineEvents = [{ id: 'evt-1' }] as any;
      expect(app.hasTimelineEvents).toBe(true);
    });

    it('timelineEventCount returns event count', () => {
      app.timelineEvents = [{ id: '1' }, { id: '2' }, { id: '3' }] as any;
      expect(app.timelineEventCount).toBe(3);
    });

    it('formatTimelineTimestamp formats timestamp with milliseconds', () => {
      const timestamp = new Date('2024-01-15T10:30:45.123Z').getTime();
      const result = app.formatTimelineTimestamp(timestamp);

      expect(result).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
    });

    it('getTimelineEventTypeClass returns correct class for event types', () => {
      expect(app.getTimelineEventTypeClass('property-change')).toBe('event-property');
      expect(app.getTimelineEventTypeClass('lifecycle')).toBe('event-lifecycle');
      expect(app.getTimelineEventTypeClass('interaction')).toBe('event-interaction');
      expect(app.getTimelineEventTypeClass('binding')).toBe('event-binding');
      expect(app.getTimelineEventTypeClass('unknown')).toBe('event-default');
    });
  });

  describe('template debugger', () => {
    it('hasTemplateInfo returns false when no snapshot', () => {
      app.templateSnapshot = null;
      expect(app.hasTemplateInfo).toBe(false);
    });

    it('hasTemplateInfo returns false when snapshot has no bindings or controllers', () => {
      app.templateSnapshot = {
        componentKey: 'test',
        componentName: 'test',
        bindings: [],
        controllers: [],
        instructions: [],
        hasSlots: false,
        shadowMode: 'none',
        isContainerless: false,
      };
      expect(app.hasTemplateInfo).toBe(false);
    });

    it('hasTemplateInfo returns true when snapshot has bindings', () => {
      app.templateSnapshot = {
        componentKey: 'test',
        componentName: 'test',
        bindings: [{ id: 'b1', type: 'property', expression: 'foo', target: 'bar', value: 1, valueType: 'number', isBound: true }],
        controllers: [],
        instructions: [],
        hasSlots: false,
        shadowMode: 'none',
        isContainerless: false,
      } as any;
      expect(app.hasTemplateInfo).toBe(true);
    });

    it('templateBindings returns empty array when no snapshot', () => {
      app.templateSnapshot = null;
      expect(app.templateBindings).toEqual([]);
    });

    it('templateBindings returns bindings from snapshot', () => {
      const bindings = [{ id: 'b1', type: 'property', expression: 'foo' }];
      app.templateSnapshot = { bindings } as any;
      expect(app.templateBindings).toEqual(bindings);
    });

    it('templateControllers returns empty array when no snapshot', () => {
      app.templateSnapshot = null;
      expect(app.templateControllers).toEqual([]);
    });

    it('templateControllers returns controllers from snapshot', () => {
      const controllers = [{ id: 'c1', type: 'if', isActive: true }];
      app.templateSnapshot = { controllers } as any;
      expect(app.templateControllers).toEqual(controllers);
    });

    it('toggleBindingExpand adds binding to expandedBindings', () => {
      app.templateSnapshot = { bindings: [], controllers: [] } as any;
      const binding = { id: 'b1' } as any;

      app.toggleBindingExpand(binding);

      expect(app.expandedBindings.has('b1')).toBe(true);
    });

    it('toggleBindingExpand removes binding from expandedBindings', () => {
      app.templateSnapshot = { bindings: [], controllers: [] } as any;
      app.expandedBindings.add('b1');
      const binding = { id: 'b1' } as any;

      app.toggleBindingExpand(binding);

      expect(app.expandedBindings.has('b1')).toBe(false);
    });

    it('isBindingExpanded returns correct state', () => {
      const binding = { id: 'b1' } as any;

      expect(app.isBindingExpanded(binding)).toBe(false);

      app.expandedBindings.add('b1');
      expect(app.isBindingExpanded(binding)).toBe(true);
    });

    it('toggleControllerExpand adds controller to expandedControllers', () => {
      app.templateSnapshot = { bindings: [], controllers: [] } as any;
      const controller = { id: 'c1' } as any;

      app.toggleControllerExpand(controller);

      expect(app.expandedControllers.has('c1')).toBe(true);
    });

    it('isControllerExpanded returns correct state', () => {
      const controller = { id: 'c1' } as any;

      expect(app.isControllerExpanded(controller)).toBe(false);

      app.expandedControllers.add('c1');
      expect(app.isControllerExpanded(controller)).toBe(true);
    });

    it('getBindingTypeIcon returns correct icons', () => {
      expect(app.getBindingTypeIcon('property')).toBe('&#8594;');
      expect(app.getBindingTypeIcon('listener')).toBe('&#9889;');
      expect(app.getBindingTypeIcon('interpolation')).toBe('&#36;{}');
      expect(app.getBindingTypeIcon('unknown')).toBe('&#8226;');
    });

    it('getBindingModeClass returns correct classes', () => {
      expect(app.getBindingModeClass('oneTime')).toBe('mode-one-time');
      expect(app.getBindingModeClass('toView')).toBe('mode-to-view');
      expect(app.getBindingModeClass('fromView')).toBe('mode-from-view');
      expect(app.getBindingModeClass('twoWay')).toBe('mode-two-way');
      expect(app.getBindingModeClass('default')).toBe('mode-default');
    });

    it('getBindingModeLabel returns correct labels', () => {
      expect(app.getBindingModeLabel('oneTime')).toBe('one-time');
      expect(app.getBindingModeLabel('toView')).toBe('→');
      expect(app.getBindingModeLabel('fromView')).toBe('←');
      expect(app.getBindingModeLabel('twoWay')).toBe('↔');
    });

    it('getControllerTypeIcon returns correct icons', () => {
      expect(app.getControllerTypeIcon('if')).toBe('&#10067;');
      expect(app.getControllerTypeIcon('repeat')).toBe('&#8635;');
      expect(app.getControllerTypeIcon('unknown')).toBe('&#9670;');
    });

    it('formatBindingValue formats values correctly', () => {
      expect(app.formatBindingValue(undefined)).toBe('undefined');
      expect(app.formatBindingValue(null)).toBe('null');
      expect(app.formatBindingValue('hello')).toBe('"hello"');
      expect(app.formatBindingValue(42)).toBe('42');
      expect(app.formatBindingValue({ a: 1 })).toBe('{"a":1}');
    });
  });
});
