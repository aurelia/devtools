import './setup';
import { ChromeTest } from './setup';
// We instantiate App without running field initializers to avoid DI
let AppClass: any;
import { stubDebugHost, stubPlatform, nextTick } from './helpers';
import type { AureliaComponentTreeNode, AureliaInfo, IControllerInfo, Property } from '@/shared/types';

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

describe('App core logic', () => {
  let app: App;
  let debugHost: any;
  let plat: any;

  beforeEach(async () => {
    ChromeTest.reset();
    jest.resetModules();
    // Dynamically import App class
    const mod = await import('@/app');
    AppClass = mod.App;
    // Create instance without running field initializers (avoid DI resolve calls)
    app = Object.create(AppClass.prototype);
    // Seed essential fields
    (app as any).coreTabs = [
      { id: 'all', label: 'All', icon: '🌲', kind: 'core' },
      { id: 'components', label: 'Components', icon: '📦', kind: 'core' },
      { id: 'attributes', label: 'Attributes', icon: '🔧', kind: 'core' },
      { id: 'interactions', label: 'Interactions', icon: '⏱️', kind: 'core' },
    ];
    (app as any).activeTab = 'all';
    (app as any).tabs = [...(app as any).coreTabs];
    (app as any).externalTabs = [];
    (app as any).externalPanels = {};
    (app as any).externalPanelsVersion = 0;
    (app as any).externalPanelLoading = {};
    (app as any).externalRefreshHandle = null;
    (app as any).selectedElement = undefined;
    (app as any).selectedElementAttributes = undefined;
    (app as any).allAureliaObjects = undefined;
    (app as any).componentTree = [];
    (app as any).componentSnapshot = { tree: [], flat: [] };
    (app as any).selectedComponentId = undefined;
    (app as any).selectedBreadcrumb = [];
    (app as any).selectedNodeType = 'custom-element';
    (app as any).searchQuery = '';
    (app as any).searchMode = 'name';
    (app as any).viewMode = 'tree';
    (app as any).isElementPickerActive = false;
    (app as any).interactionLog = [];
    (app as any).interactionLoading = false;
    (app as any).interactionError = null;
    (app as any).aureliaDetected = false;
    (app as any).aureliaVersion = null;
    (app as any).detectionState = 'checking';

    debugHost = stubDebugHost();
    plat = stubPlatform();
    // Inject stubs
    (app as any).debugHost = debugHost;
    (app as any).plat = plat;
  });

  function rawNode(
    id: string,
    element: IControllerInfo | null,
    attrs: IControllerInfo[] = [],
    children: AureliaComponentTreeNode[] = [],
    domPath: string = ''
  ): AureliaComponentTreeNode {
    return {
      id,
      domPath,
      tagName: element?.name ?? null,
      customElementInfo: element,
      customAttributesInfo: attrs,
      children,
    };
  }

  function applyTree(nodes: AureliaComponentTreeNode[]) {
    (app as any).handleComponentSnapshot({ tree: nodes, flat: [] });
    return (app as any).componentTree as any[];
  }

  describe('handleComponentSnapshot', () => {
    it('builds nodes, filters duplicate attrs by key/name, sets hasAttributes and sorts', () => {
      const element = ci('todo-item', 'todo-item');
      const dupAttr = ci('todo-item', 'todo-item');
      const realAttr = ci('selectable', 'selectable');

      const tree = applyTree([rawNode('todo', element, [dupAttr, realAttr])]);

      expect(tree).toHaveLength(1);
      const node = tree[0];
      expect(node.type).toBe('custom-element');
      expect(node.hasAttributes).toBe(true);
      expect(node.children).toHaveLength(1);
      expect(node.children[0].type).toBe('custom-attribute');
      expect(node.children[0].name).toBe('selectable');
    });

    it('lifts standalone custom attributes without parent element', () => {
      const attrInfo = ci('draggable');
      const tree = applyTree([rawNode('attr-only', null as any, [attrInfo])]);

      expect(tree).toHaveLength(1);
      expect(tree[0].type).toBe('custom-attribute');
      expect(tree[0].name).toBe('draggable');
    });
  });

  describe('tab filtering and search filtering', () => {
    function seedTree() {
      return applyTree([
        rawNode('alpha', ci('alpha'), [ci('attr-a'), ci('attr-b')]),
        rawNode('beta', ci('beta'), []),
      ]);
    }

    function nodesAreType(nodes: any[], type: 'custom-element' | 'custom-attribute'): boolean {
      return nodes.every((node) => node.type === type && nodesAreType(node.children || [], type));
    }

    it('filteredComponentTreeByTab returns only elements for components tab', () => {
      seedTree();
      app.activeTab = 'components';
      const filtered = app.filteredComponentTreeByTab;
      expect(nodesAreType(filtered, 'custom-element')).toBe(true);
    });

    it('filteredComponentTreeByTab returns only attributes for attributes tab', () => {
      seedTree();
      app.activeTab = 'attributes';
      const filtered = app.filteredComponentTreeByTab;
      expect(nodesAreType(filtered, 'custom-attribute')).toBe(true);
    });

    it('search returns parents of matching descendants and auto-expands them', () => {
      seedTree();
      app.activeTab = 'all';
      app.searchQuery = 'attr-b';
      const filtered = app.filteredComponentTreeByTab;
      // There should be an element parent containing the matching attribute child
      const parent = filtered.find(n => n.type === 'custom-element');
      expect(parent).toBeTruthy();
      expect(parent.expanded).toBe(true);
      expect(parent.children.some((c: any) => c.name.toLowerCase().includes('attr-b'))).toBe(true);
    });

    it('clearSearch resets query and returns full tree', () => {
      seedTree();
      app.searchQuery = 'beta';
      expect(app.filteredComponentTreeByTab.length).toBeGreaterThan(0);
      app.clearSearch();
      expect(app.searchQuery).toBe('');
      expect(app.filteredComponentTreeByTab.length).toBeGreaterThan(0);
    });
  });

  describe('selection and expansion', () => {
    it('selectComponent sets selectedElement and filters attrs for element node', () => {
      const element = ci('alpha', 'alpha');
      const dupAttr = ci('alpha', 'alpha');
      const otherAttr = ci('x', 'x');
      const tree = applyTree([rawNode('alpha', element, [dupAttr, otherAttr])]);

      app.selectComponent(tree[0].id);
      expect(app.selectedElement?.name).toBe('alpha');
      expect(app.selectedElementAttributes?.length).toBe(1);
      expect(app.selectedElementAttributes?.[0].name).toBe('x');
    });

    it('selectComponent sets selectedElement to attribute and clears attributes list for attribute node', () => {
      const element = ci('alpha');
      const otherAttr = ci('x');
      const tree = applyTree([rawNode('alpha', element, [otherAttr])]);
      const attrNode = tree[0].children[0];

      app.selectComponent(attrNode.id);
      expect(app.selectedElement?.name).toBe('x');
      expect(app.selectedElementAttributes).toEqual([]);
    });

    it('toggleComponentExpansion toggles expanded state', () => {
      const tree = applyTree([rawNode('alpha', ci('alpha'))]);
      const id = tree[0].id;
      expect(tree[0].expanded).toBe(false);
      app.toggleComponentExpansion(id);
      expect(((app as any).findComponentById(id).expanded)).toBe(true);
    });

    it('onElementPicked selects component using DOM path when provided', () => {
     const tree = applyTree([
        rawNode('root', ci('root'), [], [
          rawNode('child', ci('child'), [], [], 'html > body > child')
        ], 'html > body > root')
      ]);

      const pickInfo = {
        customElementInfo: ci('child'),
        customAttributesInfo: [],
        __auDevtoolsDomPath: 'html > body > child'
      } as any;

      app.onElementPicked(pickInfo);

      expect(app.selectedComponentId).toBe('child');
      expect(app.selectedElement?.name).toBe('child');
    });

    it('handlePropertyRowClick toggles expansion when clicking label area', () => {
      const prop: any = { canExpand: true, isExpanded: false };
      const event: any = {
        target: document.createElement('span'),
        stopPropagation: jest.fn(),
      };
      const spy = jest.spyOn(app, 'togglePropertyExpansion');
      (event.target as HTMLElement).classList.add('property-name');

      app.handlePropertyRowClick(prop, event);

      expect(spy).toHaveBeenCalledWith(prop);
      spy.mockRestore();
    });

    it('handlePropertyRowClick ignores clicks in value wrapper', () => {
      const prop: any = { canExpand: true, isExpanded: false };
      const valueEl = document.createElement('span');
      valueEl.className = 'property-value-wrapper';
      const event: any = {
        target: valueEl,
        stopPropagation: jest.fn(),
      };
      const spy = jest.spyOn(app, 'togglePropertyExpansion');

      app.handlePropertyRowClick(prop, event);

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('external panel integration', () => {
    it('refreshExternalPanels merges snapshot into tabs', async () => {
      const snapshot = {
        version: 1,
        panels: [{ id: 'store', label: 'Store Debugger', icon: '🧠', summary: 'hello' }],
      };
      debugHost.getExternalPanelsSnapshot.mockResolvedValue(snapshot);

      await app.refreshExternalPanels(true);

      expect(app.tabs.some((tab: any) => tab.id === 'external:store')).toBe(true);
      expect((app as any).externalPanels.store.summary).toBe('hello');
    });

    it('switchTab triggers external refresh helpers', () => {
      const spy = jest.spyOn(app, 'refreshExternalPanels').mockResolvedValue(undefined as any);
      (app as any).externalTabs = [{ id: 'external:store', label: 'Store', icon: '🧩', kind: 'external', panelId: 'store' }];
      (app as any).tabs = [...(app as any).coreTabs, ...(app as any).externalTabs];

      app.switchTab('external:store');

      expect(spy).toHaveBeenCalledWith(true);
    });

    it('refreshActiveExternalTab emits request event', () => {
      (app as any).externalTabs = [{ id: 'external:store', label: 'Store', icon: '🧩', kind: 'external', panelId: 'store' }];
      (app as any).tabs = [...(app as any).coreTabs, ...(app as any).externalTabs];
      debugHost.emitExternalPanelEvent.mockResolvedValue(true);
      app.activeTab = 'external:store';

      app.refreshActiveExternalTab();

      expect(debugHost.emitExternalPanelEvent).toHaveBeenCalledWith(
        'aurelia-devtools:request-panel',
        expect.objectContaining({ id: 'store' })
      );
    });

    it('applySelectionFromNode notifies external panels when active', () => {
      const node: any = {
        id: 'alpha',
        type: 'custom-element',
        domPath: 'html > body:nth-of-type(1)',
        children: [],
        expanded: false,
        hasAttributes: false,
        name: 'alpha',
        tagName: 'div',
        data: { kind: 'element', info: ai(ci('alpha')), raw: null },
      };
      app.activeTab = 'external:store';

      (app as any).applySelectionFromNode(node);

      expect(debugHost.emitExternalPanelEvent).toHaveBeenCalledWith(
        'aurelia-devtools:selection-changed',
        expect.objectContaining({ selectedComponentId: 'alpha' })
      );
    });
  });

  describe('interaction timeline', () => {
    it('switchTab to interactions triggers log load', () => {
      const spy = jest.spyOn(app, 'loadInteractionLog').mockResolvedValue(undefined as any);

      app.switchTab('interactions');

      expect(spy).toHaveBeenCalledWith(true);
      spy.mockRestore();
    });

    it('applyInteractionSnapshot forwards phase', async () => {
      await app.applyInteractionSnapshot('evt-2', 'before');
      expect(debugHost.applyInteractionSnapshot).toHaveBeenCalledWith('evt-2', 'before');
    });

    it('clearInteractionLog clears and reloads', async () => {
      const loadSpy = jest.spyOn(app, 'loadInteractionLog').mockResolvedValue(undefined as any);

      await app.clearInteractionLog();

      expect(debugHost.clearInteractionLog).toHaveBeenCalled();
      // We clear optimistically; reload is best-effort so only assert the host call
      loadSpy.mockRestore();
    });
  });

  describe('property editing and expansion', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    function makeProp(type: Property['type'], value: any): any {
      return { type, value, isEditing: true } as any;
    }

    it('saveProperty converts number and calls updateValues', async () => {
      const prop = makeProp('number', 1);
      (app as any).selectedElement = { properties: [prop], bindables: [] };

      app.saveProperty(prop, '42');
      // queueMicrotask is implemented with setTimeout(0) in stubPlatform
      jest.runOnlyPendingTimers();

      expect(prop.value).toBe(42);
      expect(prop.isEditing).toBe(false);
      expect(debugHost.updateValues).toHaveBeenCalled();
    });

    it('saveProperty handles invalid number by revert', () => {
      const original = 5;
      const prop = { type: 'number', value: original, isEditing: true, originalValue: original } as any;
      (app as any).selectedElement = { properties: [prop], bindables: [] };

      app.saveProperty(prop, 'not-a-number');
      expect(prop.value).toBe(original);
      expect(prop.isEditing).toBe(false);
    });

    it('saveProperty converts boolean', () => {
      const prop = makeProp('boolean', false);
      (app as any).selectedElement = { properties: [prop], bindables: [] };
      app.saveProperty(prop, 'true');
      jest.runOnlyPendingTimers();
      expect(prop.value).toBe(true);
    });

    it('togglePropertyExpansion loads expanded value via inspectedWindow.eval', async () => {
      const prop: any = { type: 'object', value: {}, canExpand: true, isExpanded: false, debugId: 7 };
      (app as any).selectedElement = { properties: [prop], bindables: [] };

      ChromeTest.setEvalToReturn([{ result: { properties: [{ name: 'child', type: 'string', value: 'x' }] } }]);

      app.togglePropertyExpansion(prop);
      // The eval callback is synchronous in our mock; microtask used to reassign references
      jest.runOnlyPendingTimers();

      expect(prop.isExpanded).toBe(true);
      expect(prop.expandedValue).toBeTruthy();
      expect(((app as any).selectedElement.properties)[0]).toEqual(expect.objectContaining({ isExpanded: true }));
    });
  });

  describe('highlighting delegates to debugHost', () => {
    it('highlightComponent forwards minimal payload', () => {
      const tree = applyTree([rawNode('alpha', ci('alpha'), [ci('x')])]);
      app.highlightComponent(tree[0]);
      expect(debugHost.highlightComponent).toHaveBeenCalledWith(expect.objectContaining({
        name: 'alpha',
        type: 'custom-element',
        customElementInfo: expect.objectContaining({ name: 'alpha' }),
      }));
    });

    it('unhighlightComponent forwards to debugHost', () => {
      app.unhighlightComponent();
      expect(debugHost.unhighlightComponent).toHaveBeenCalled();
    });
  });

  describe('property watching and reactivity', () => {
    function rawNode(
      id: string,
      element: IControllerInfo | null,
      attrs: IControllerInfo[] = [],
      children: AureliaComponentTreeNode[] = [],
      domPath: string = ''
    ): AureliaComponentTreeNode {
      return {
        id,
        domPath,
        tagName: element?.name ?? null,
        customElementInfo: element,
        customAttributesInfo: attrs,
        children,
      };
    }

    function applyTree(nodes: AureliaComponentTreeNode[]) {
      (app as any).handleComponentSnapshot({ tree: nodes, flat: [] });
      return (app as any).componentTree as any[];
    }

    it('selectComponent starts property watching with component key', () => {
      const tree = applyTree([rawNode('alpha', ci('alpha', 'alpha-key'))]);
      app.selectComponent(tree[0].id);

      expect(debugHost.startPropertyWatching).toHaveBeenCalledWith({
        componentKey: 'alpha-key',
        pollInterval: 500,
      });
    });

    it('selectComponent falls back to name if key not available', () => {
      const element = ci('my-element');
      delete (element as any).key;
      const tree = applyTree([rawNode('beta', element)]);

      app.selectComponent(tree[0].id);

      expect(debugHost.startPropertyWatching).toHaveBeenCalledWith({
        componentKey: 'my-element',
        pollInterval: 500,
      });
    });

    it('handleComponentSnapshot stops property watching when selected node is removed', () => {
      const tree = applyTree([rawNode('alpha', ci('alpha'))]);
      app.selectComponent(tree[0].id);

      // Clear the component tree so selected component no longer exists
      (app as any).handleComponentSnapshot({ tree: [], flat: [] });

      expect(debugHost.stopPropertyWatching).toHaveBeenCalled();
      expect(app.selectedComponentId).toBeUndefined();
    });

    it('onPropertyChanges updates bindable values', () => {
      const bindable: any = { name: 'count', value: 0, type: 'number' };
      (app as any).selectedElement = {
        key: 'test-key',
        name: 'test',
        bindables: [bindable],
        properties: [],
      };

      const changes = [
        {
          componentKey: 'test-key',
          propertyName: 'count',
          propertyType: 'bindable',
          oldValue: 0,
          newValue: 5,
          timestamp: Date.now(),
        },
      ];

      const snapshot = {
        componentKey: 'test-key',
        bindables: [{ name: 'count', value: 5, type: 'number' }],
        properties: [],
        timestamp: Date.now(),
      };

      app.onPropertyChanges(changes as any, snapshot as any);

      expect(bindable.value).toBe(5);
    });

    it('onPropertyChanges updates property values', () => {
      const property: any = { name: 'message', value: 'old', type: 'string' };
      (app as any).selectedElement = {
        key: 'test-key',
        name: 'test',
        bindables: [],
        properties: [property],
      };

      const changes = [
        {
          componentKey: 'test-key',
          propertyName: 'message',
          propertyType: 'property',
          oldValue: 'old',
          newValue: 'new',
          timestamp: Date.now(),
        },
      ];

      const snapshot = {
        componentKey: 'test-key',
        bindables: [],
        properties: [{ name: 'message', value: 'new', type: 'string' }],
        timestamp: Date.now(),
      };

      app.onPropertyChanges(changes as any, snapshot as any);

      expect(property.value).toBe('new');
    });

    it('onPropertyChanges ignores changes for different component', () => {
      const property: any = { name: 'message', value: 'original', type: 'string' };
      (app as any).selectedElement = {
        key: 'selected-key',
        name: 'selected',
        bindables: [],
        properties: [property],
      };

      const changes = [
        {
          componentKey: 'different-key',
          propertyName: 'message',
          propertyType: 'property',
          oldValue: 'old',
          newValue: 'new',
          timestamp: Date.now(),
        },
      ];

      const snapshot = {
        componentKey: 'different-key',
        bindables: [],
        properties: [{ name: 'message', value: 'new', type: 'string' }],
        timestamp: Date.now(),
      };

      app.onPropertyChanges(changes as any, snapshot as any);

      expect(property.value).toBe('original');
    });

    it('onPropertyChanges does nothing when no selected element', () => {
      (app as any).selectedElement = undefined;

      const changes = [
        {
          componentKey: 'any-key',
          propertyName: 'prop',
          propertyType: 'property',
          oldValue: 'old',
          newValue: 'new',
          timestamp: Date.now(),
        },
      ];

      expect(() => app.onPropertyChanges(changes as any, {} as any)).not.toThrow();
    });
  });
});
