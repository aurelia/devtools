import './setup';
import { ChromeTest } from './setup';
import { stubDebugHost, stubPlatform } from './helpers';

let AppClass: any;

async function createApp() {
  jest.resetModules();
  const mod = await import('@/app');
  AppClass = mod.App;
  const app = Object.create(AppClass.prototype);

  app.coreTabs = [
    { id: 'all', label: 'All', icon: '🌲', kind: 'core' },
    { id: 'components', label: 'Components', icon: '📦', kind: 'core' },
    { id: 'attributes', label: 'Attributes', icon: '🔧', kind: 'core' },
    { id: 'interactions', label: 'Interactions', icon: '⏱️', kind: 'core' },
  ];
  app.activeTab = 'all';
  app.tabs = [...app.coreTabs];
  app.externalTabs = [];
  app.externalPanels = {};
  app.externalPanelsVersion = 0;
  app.externalPanelLoading = {};
  app.externalRefreshHandle = null;
  app.selectedElement = undefined;
  app.selectedElementAttributes = undefined;
  app.allAureliaObjects = undefined;
  app.componentTree = [];
  app.componentSnapshot = { tree: [], flat: [] };
  app.selectedComponentId = undefined;
  app.selectedBreadcrumb = [];
  app.selectedNodeType = 'custom-element';
  app.searchQuery = '';
  app.searchMode = 'name';
  app.viewMode = 'tree';
  app.isElementPickerActive = false;
  app.interactionLog = [];
  app.interactionLoading = false;
  app.interactionError = null;
  app.aureliaDetected = false;
  app.aureliaVersion = null;
  app.detectionState = 'checking';
  app.isRefreshing = false;
  app.expressionInput = '';
  app.expressionResult = '';
  app.expressionResultType = '';
  app.expressionError = '';
  app.expressionHistory = [];
  app.isExpressionPanelOpen = false;
  app.copiedPropertyId = null;
  app.propertyRowsRevision = 0;

  const debugHost = stubDebugHost();
  const plat = stubPlatform();
  app.debugHost = debugHost;
  app.plat = plat;

  return { app, debugHost, plat };
}

describe('App expression evaluation', () => {
  let app: any;

  beforeEach(async () => {
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;
  });

  it('evaluateExpression does nothing with empty input', async () => {
    app.expressionInput = '';
    app.selectedElement = { name: 'comp', key: 'comp-key' };

    await app.evaluateExpression();

    expect(app.expressionError).toBe('');
    expect(app.expressionResult).toBe('');
  });

  it('evaluateExpression does nothing without selected element', async () => {
    app.expressionInput = 'this.count';
    app.selectedElement = undefined;

    await app.evaluateExpression();

    expect(chrome.devtools.inspectedWindow.eval).not.toHaveBeenCalled();
  });

  it('evaluateExpression sets error when no component key', async () => {
    app.expressionInput = 'this.count';
    app.selectedElement = {};

    await app.evaluateExpression();

    expect(app.expressionError).toBe('No component selected');
  });

  it('evaluateExpression adds to history', async () => {
    app.expressionInput = 'this.count';
    app.selectedElement = { name: 'comp', key: 'comp-key' };
    app.expressionHistory = [];
    ChromeTest.setEvalToReturn([{ result: { success: true, value: 42, type: 'number' } }]);

    await app.evaluateExpression();

    expect(app.expressionHistory).toContain('this.count');
  });

  it('evaluateExpression does not duplicate history', async () => {
    app.expressionInput = 'this.count';
    app.selectedElement = { name: 'comp', key: 'comp-key' };
    app.expressionHistory = ['this.count'];
    ChromeTest.setEvalToReturn([{ result: { success: true, value: 42, type: 'number' } }]);

    await app.evaluateExpression();

    expect(app.expressionHistory.filter((h: string) => h === 'this.count')).toHaveLength(1);
  });

  it('evaluateExpression handles eval exception', async () => {
    app.expressionInput = 'this.count';
    app.selectedElement = { name: 'comp', key: 'comp-key' };
    ChromeTest.setEvalImplementation((_expr: string, cb: Function) => {
      cb(undefined, 'Syntax Error');
    });

    await app.evaluateExpression();

    expect(app.expressionError).toBe('Syntax Error');
  });

  it('evaluateExpression handles result error', async () => {
    app.expressionInput = 'this.count';
    app.selectedElement = { name: 'comp', key: 'comp-key' };
    ChromeTest.setEvalToReturn([{ result: { error: 'Component not found' } }]);

    await app.evaluateExpression();

    expect(app.expressionError).toBe('Component not found');
  });

  it('evaluateExpression handles successful number result', async () => {
    app.expressionInput = 'this.count';
    app.selectedElement = { name: 'comp', key: 'comp-key' };
    ChromeTest.setEvalToReturn([{ result: { success: true, value: 42, type: 'number' } }]);

    await app.evaluateExpression();

    expect(app.expressionResult).toBe('42');
    expect(app.expressionResultType).toBe('number');
    expect(app.expressionError).toBe('');
  });

  it('evaluateExpression handles successful string result', async () => {
    app.expressionInput = 'this.name';
    app.selectedElement = { name: 'comp', key: 'comp-key' };
    ChromeTest.setEvalToReturn([{ result: { success: true, value: 'hello', type: 'string' } }]);

    await app.evaluateExpression();

    expect(app.expressionResult).toBe('hello');
    expect(app.expressionResultType).toBe('string');
  });

  it('evaluateExpression handles undefined result', async () => {
    app.expressionInput = 'this.missing';
    app.selectedElement = { name: 'comp', key: 'comp-key' };
    ChromeTest.setEvalToReturn([{ result: { success: true, value: undefined, type: 'undefined' } }]);

    await app.evaluateExpression();

    expect(app.expressionResult).toBe('undefined');
  });

  it('evaluateExpression handles null result', async () => {
    app.expressionInput = 'this.nullable';
    app.selectedElement = { name: 'comp', key: 'comp-key' };
    ChromeTest.setEvalToReturn([{ result: { success: true, value: null, type: 'object' } }]);

    await app.evaluateExpression();

    expect(app.expressionResult).toBe('null');
  });

  it('evaluateExpression handles object result', async () => {
    app.expressionInput = 'this.data';
    app.selectedElement = { name: 'comp', key: 'comp-key' };
    ChromeTest.setEvalToReturn([{ result: { success: true, value: { foo: 'bar' }, type: 'object' } }]);

    await app.evaluateExpression();

    expect(app.expressionResult).toContain('foo');
    expect(app.expressionResult).toContain('bar');
  });

  it('evaluateExpression handles unknown response format', async () => {
    app.expressionInput = 'this.count';
    app.selectedElement = { name: 'comp', key: 'comp-key' };
    ChromeTest.setEvalToReturn([{ result: {} }]);

    await app.evaluateExpression();

    expect(app.expressionError).toBe('Unknown response format');
  });
});

describe('App property expansion', () => {
  let app: any;
  let plat: any;

  beforeEach(async () => {
    jest.useFakeTimers();
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;
    plat = result.plat;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('togglePropertyExpansion expands expandable properties', () => {
    const prop = { canExpand: true, isExpanded: false, debugId: 1, expandedValue: { properties: [] } };
    app.selectedElement = { bindables: [prop], properties: [] };

    app.togglePropertyExpansion(prop);

    expect(prop.isExpanded).toBe(true);
  });

  it('togglePropertyExpansion collapses expanded properties', () => {
    const prop = { canExpand: true, isExpanded: true, debugId: 1, expandedValue: { properties: [] } };
    app.selectedElement = { bindables: [prop], properties: [] };

    app.togglePropertyExpansion(prop);

    expect(prop.isExpanded).toBe(false);
  });

  it('togglePropertyExpansion does nothing for non-expandable', () => {
    const prop = { canExpand: false, isExpanded: false };
    app.selectedElement = { bindables: [prop], properties: [] };

    app.togglePropertyExpansion(prop);

    expect(prop.isExpanded).toBe(false);
  });

  it('loadExpandedPropertyValue fetches expanded value via eval', () => {
    const prop = { canExpand: true, isExpanded: false, debugId: 42, expandedValue: null };
    app.selectedElement = { bindables: [prop], properties: [] };

    ChromeTest.setEvalToReturn([{ result: { properties: [{ name: 'child', value: 'test' }] } }]);

    app.loadExpandedPropertyValue(prop);

    expect(chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();
    const code = (chrome.devtools.inspectedWindow.eval as jest.Mock).mock.calls[0][0];
    expect(code).toContain('getExpandedDebugValueForId(42)');
  });

  it('loadExpandedPropertyValue handles eval exception', () => {
    const prop = { canExpand: true, isExpanded: false, debugId: 42, expandedValue: null };
    app.selectedElement = { bindables: [], properties: [prop] };

    ChromeTest.setEvalImplementation((_expr: string, cb: Function) => {
      cb(undefined, 'Error loading');
    });

    app.loadExpandedPropertyValue(prop);

    expect(prop.isExpanded).toBe(false);
    expect(prop.expandedValue).toBeNull();
  });

  it('markPropertyRowsDirty increments revision', () => {
    const initial = app.propertyRowsRevision;
    app.markPropertyRowsDirty();
    expect(app.propertyRowsRevision).toBe(initial + 1);
  });
});

describe('App node path finding', () => {
  let app: any;

  beforeEach(async () => {
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;
  });

  it('findNodePathById returns path to nested node', () => {
    app.componentTree = [
      {
        id: 'root',
        name: 'root',
        children: [
          {
            id: 'child',
            name: 'child',
            children: [
              { id: 'grandchild', name: 'grandchild', children: [] }
            ]
          }
        ]
      }
    ];

    const path = app.findNodePathById('grandchild');

    expect(path).toHaveLength(3);
    expect(path[0].id).toBe('root');
    expect(path[1].id).toBe('child');
    expect(path[2].id).toBe('grandchild');
  });

  it('findNodePathById returns null for non-existent node', () => {
    app.componentTree = [{ id: 'root', name: 'root', children: [] }];

    const path = app.findNodePathById('nonexistent');

    expect(path).toBeNull();
  });

  it('findNodePathById handles empty tree', () => {
    app.componentTree = [];

    const path = app.findNodePathById('any');

    expect(path).toBeNull();
  });
});

describe('App component matching', () => {
  let app: any;

  beforeEach(async () => {
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;
  });

  it('nodeMatchesElement returns false for non-element nodes', () => {
    const node = { data: { kind: 'attribute' } };
    const target = { name: 'comp', key: 'comp-key' };

    expect(app.nodeMatchesElement(node, target)).toBe(false);
  });

  it('nodeMatchesElement returns false without target', () => {
    const node = { data: { kind: 'element', info: { customElementInfo: { name: 'comp' } } } };

    expect(app.nodeMatchesElement(node, null)).toBe(false);
  });

  it('nodeMatchesAttribute returns false for non-attribute nodes', () => {
    const node = { data: { kind: 'element' } };

    expect(app.nodeMatchesAttribute(node, [{ name: 'attr' }])).toBe(false);
  });

  it('nodeMatchesAttribute returns false without target attributes', () => {
    const node = { data: { kind: 'attribute', raw: { name: 'attr' } } };

    expect(app.nodeMatchesAttribute(node, [])).toBe(false);
    expect(app.nodeMatchesAttribute(node, null)).toBe(false);
  });

  it('nodeContainsAnyAttribute returns false for empty arrays', () => {
    expect(app.nodeContainsAnyAttribute([], [{ name: 'attr' }])).toBe(false);
    expect(app.nodeContainsAnyAttribute([{ name: 'attr' }], [])).toBe(false);
    expect(app.nodeContainsAnyAttribute(null, [{ name: 'attr' }])).toBe(false);
  });

  it('searchNodesForMatch finds matching element', () => {
    const nodes = [
      {
        id: 'comp1',
        data: { kind: 'element', info: { customElementInfo: { name: 'target', key: 'target-key' }, customAttributesInfo: [] } },
        children: []
      }
    ];
    const target = { name: 'target', key: 'target-key' };

    const found = app.searchNodesForMatch(nodes, target, []);

    expect(found).toBeDefined();
    expect(found.id).toBe('comp1');
  });

  it('searchNodesForMatch searches children', () => {
    const nodes = [
      {
        id: 'parent',
        data: { kind: 'element', info: { customElementInfo: { name: 'parent' }, customAttributesInfo: [] } },
        children: [
          {
            id: 'child',
            data: { kind: 'element', info: { customElementInfo: { name: 'target', key: 'target-key' }, customAttributesInfo: [] } },
            children: []
          }
        ]
      }
    ];
    const target = { name: 'target', key: 'target-key' };

    const found = app.searchNodesForMatch(nodes, target, []);

    expect(found).toBeDefined();
    expect(found.id).toBe('child');
  });
});

describe('App handleExpandToggle', () => {
  let app: any;

  beforeEach(async () => {
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;
  });

  it('stops event propagation', () => {
    const node = { id: 'test', expanded: false };
    app.componentTree = [node];
    const event = { stopPropagation: jest.fn() };

    app.handleExpandToggle(node, event);

    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it('does nothing for node without id', () => {
    const node = { expanded: false };
    app.componentTree = [];
    const spy = jest.spyOn(app, 'toggleComponentExpansion');

    app.handleExpandToggle(node);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does nothing for null node', () => {
    const spy = jest.spyOn(app, 'toggleComponentExpansion');

    app.handleExpandToggle(null);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
