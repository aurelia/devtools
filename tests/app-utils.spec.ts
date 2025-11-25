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
  app.followChromeSelection = true;

  const debugHost = stubDebugHost();
  const plat = stubPlatform();
  app.debugHost = debugHost;
  app.plat = plat;

  return { app, debugHost, plat };
}

describe('App view mode management', () => {
  let app: any;

  beforeEach(async () => {
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;
  });

  it('toggleViewMode switches between tree and list', () => {
    expect(app.viewMode).toBe('tree');
    app.toggleViewMode();
    expect(app.viewMode).toBe('list');
    app.toggleViewMode();
    expect(app.viewMode).toBe('tree');
  });

  it('setViewMode sets mode and persists to localStorage', () => {
    const setItem = jest.spyOn(window.localStorage.__proto__, 'setItem');
    app.setViewMode('list');
    expect(app.viewMode).toBe('list');
    expect(setItem).toHaveBeenCalledWith('au-devtools.viewMode', 'list');
    setItem.mockRestore();
  });

  it('setViewMode does nothing when mode is same', () => {
    const setItem = jest.spyOn(window.localStorage.__proto__, 'setItem');
    app.setViewMode('tree');
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});

describe('App search mode management', () => {
  let app: any;

  beforeEach(async () => {
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;
  });

  it('setSearchMode changes search mode', () => {
    expect(app.searchMode).toBe('name');
    app.setSearchMode('property');
    expect(app.searchMode).toBe('property');
    app.setSearchMode('all');
    expect(app.searchMode).toBe('all');
  });

  it('cycleSearchMode cycles through modes', () => {
    expect(app.searchMode).toBe('name');
    app.cycleSearchMode();
    expect(app.searchMode).toBe('property');
    app.cycleSearchMode();
    expect(app.searchMode).toBe('all');
    app.cycleSearchMode();
    expect(app.searchMode).toBe('name');
  });

  it('searchModeLabel returns correct labels', () => {
    app.searchMode = 'name';
    expect(app.searchModeLabel).toBe('Name');
    app.searchMode = 'property';
    expect(app.searchModeLabel).toBe('Props');
    app.searchMode = 'all';
    expect(app.searchModeLabel).toBe('All');
  });

  it('searchPlaceholder returns correct placeholders', () => {
    app.searchMode = 'name';
    expect(app.searchPlaceholder).toBe('Search components...');
    app.searchMode = 'property';
    expect(app.searchPlaceholder).toBe('Search property values...');
    app.searchMode = 'all';
    expect(app.searchPlaceholder).toBe('Search names & properties...');
  });
});

describe('App expression panel', () => {
  let app: any;

  beforeEach(async () => {
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;
  });

  it('toggleExpressionPanel toggles panel state', () => {
    expect(app.isExpressionPanelOpen).toBe(false);
    app.toggleExpressionPanel();
    expect(app.isExpressionPanelOpen).toBe(true);
    app.toggleExpressionPanel();
    expect(app.isExpressionPanelOpen).toBe(false);
  });

  it('clearExpressionResult clears all expression state', () => {
    app.expressionResult = 'test result';
    app.expressionResultType = 'string';
    app.expressionError = 'some error';
    app.clearExpressionResult();
    expect(app.expressionResult).toBe('');
    expect(app.expressionResultType).toBe('');
    expect(app.expressionError).toBe('');
  });

  it('selectHistoryExpression sets input', () => {
    app.selectHistoryExpression('this.count');
    expect(app.expressionInput).toBe('this.count');
  });
});

describe('App flat list conversion', () => {
  let app: any;

  beforeEach(async () => {
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;
  });

  it('convertFlatListToTreeNodes handles empty input', () => {
    const result = app.convertFlatListToTreeNodes([]);
    expect(result).toEqual([]);
  });

  it('convertFlatListToTreeNodes handles null input', () => {
    const result = app.convertFlatListToTreeNodes(null);
    expect(result).toEqual([]);
  });

  it('convertFlatListToTreeNodes creates nodes from elements', () => {
    const flat = [
      { customElementInfo: { name: 'comp-a', key: 'comp-a', bindables: [], properties: [], aliases: [] }, customAttributesInfo: [] },
      { customElementInfo: { name: 'comp-b', key: 'comp-b', bindables: [], properties: [], aliases: [] }, customAttributesInfo: [] },
    ];
    const result = app.convertFlatListToTreeNodes(flat);
    expect(result).toHaveLength(2);
    expect(result[0].customElementInfo.name).toBe('comp-a');
    expect(result[1].customElementInfo.name).toBe('comp-b');
  });

  it('convertFlatListToTreeNodes deduplicates by key', () => {
    const flat = [
      { customElementInfo: { name: 'comp-a', key: 'same-key', bindables: [], properties: [], aliases: [] }, customAttributesInfo: [] },
      { customElementInfo: { name: 'comp-a', key: 'same-key', bindables: [], properties: [], aliases: [] }, customAttributesInfo: [] },
    ];
    const result = app.convertFlatListToTreeNodes(flat);
    expect(result).toHaveLength(1);
  });

  it('convertFlatListToTreeNodes creates attribute-only nodes', () => {
    const flat = [
      { customElementInfo: null, customAttributesInfo: [{ name: 'draggable', key: 'draggable', bindables: [], properties: [], aliases: [] }] },
    ];
    const result = app.convertFlatListToTreeNodes(flat);
    expect(result).toHaveLength(1);
    expect(result[0].customElementInfo).toBeNull();
    expect(result[0].customAttributesInfo).toHaveLength(1);
  });
});

describe('App property value search', () => {
  let app: any;

  beforeEach(async () => {
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;
  });

  it('propertyValueToSearchString handles null', () => {
    expect(app.propertyValueToSearchString(null)).toBe('null');
  });

  it('propertyValueToSearchString handles undefined', () => {
    expect(app.propertyValueToSearchString(undefined)).toBe('undefined');
  });

  it('propertyValueToSearchString handles strings', () => {
    expect(app.propertyValueToSearchString('hello')).toBe('hello');
  });

  it('propertyValueToSearchString handles numbers', () => {
    expect(app.propertyValueToSearchString(42)).toBe('42');
  });

  it('propertyValueToSearchString handles booleans', () => {
    expect(app.propertyValueToSearchString(true)).toBe('true');
    expect(app.propertyValueToSearchString(false)).toBe('false');
  });

  it('propertyValueToSearchString handles arrays', () => {
    expect(app.propertyValueToSearchString([1, 2, 3])).toBe('[3 items]');
  });

  it('propertyValueToSearchString handles objects', () => {
    const result = app.propertyValueToSearchString({ foo: 'bar' });
    expect(result).toContain('foo');
    expect(result).toContain('bar');
  });

  it('searchInProperties finds property by name', () => {
    const info = {
      bindables: [{ name: 'searchableValue', value: 'test', type: 'string' }],
      properties: [],
    };
    const result = app.searchInProperties(info, 'searchable');
    expect(result).toBe('searchableValue');
  });

  it('searchInProperties finds property by value', () => {
    const info = {
      bindables: [],
      properties: [{ name: 'message', value: 'hello world', type: 'string' }],
    };
    const result = app.searchInProperties(info, 'hello');
    expect(result).toBe('message');
  });

  it('searchInProperties returns null when not found', () => {
    const info = {
      bindables: [{ name: 'count', value: 10, type: 'number' }],
      properties: [],
    };
    const result = app.searchInProperties(info, 'nonexistent');
    expect(result).toBeNull();
  });
});

describe('App breadcrumb and node count', () => {
  let app: any;

  beforeEach(async () => {
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;
  });

  it('breadcrumbSegments returns empty for no selection', () => {
    app.selectedBreadcrumb = [];
    expect(app.breadcrumbSegments).toEqual([]);
  });

  it('breadcrumbSegments formats element and attribute labels', () => {
    app.selectedBreadcrumb = [
      { id: 'e1', name: 'my-element', type: 'custom-element' },
      { id: 'a1', name: 'my-attr', type: 'custom-attribute' },
    ];
    const segments = app.breadcrumbSegments;
    expect(segments).toHaveLength(2);
    expect(segments[0].label).toBe('<my-element>');
    expect(segments[1].label).toBe('@my-attr');
  });

  it('totalComponentNodeCount counts all nodes recursively', () => {
    app.componentTree = [
      {
        id: 'root',
        name: 'root',
        children: [
          { id: 'child1', name: 'child1', children: [] },
          { id: 'child2', name: 'child2', children: [
            { id: 'grandchild', name: 'grandchild', children: [] }
          ] },
        ],
      },
    ];
    expect(app.totalComponentNodeCount).toBe(4);
  });

  it('totalComponentNodeCount returns 0 for empty tree', () => {
    app.componentTree = [];
    expect(app.totalComponentNodeCount).toBe(0);
  });
});

describe('App external panel helpers', () => {
  let app: any;

  beforeEach(async () => {
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;
  });

  it('isExternalTabActive returns false for core tabs', () => {
    app.activeTab = 'all';
    expect(app.isExternalTabActive).toBe(false);
    app.activeTab = 'components';
    expect(app.isExternalTabActive).toBe(false);
  });

  it('isExternalTabActive returns true for external tabs', () => {
    app.externalTabs = [{ id: 'external:store', panelId: 'store' }];
    app.activeTab = 'external:store';
    expect(app.isExternalTabActive).toBe(true);
  });

  it('activeExternalIcon returns default when no panel', () => {
    app.activeTab = 'all';
    expect(app.activeExternalIcon).toBe('🧩');
  });

  it('activeExternalTitle returns default when no panel', () => {
    app.activeTab = 'all';
    expect(app.activeExternalTitle).toBe('Inspector');
  });

  it('activeExternalError returns null for non-error panels', () => {
    app.externalTabs = [{ id: 'external:store', panelId: 'store' }];
    app.externalPanels = { store: { id: 'store', status: 'ready' } };
    app.activeTab = 'external:store';
    expect(app.activeExternalError).toBeNull();
  });

  it('activeExternalError returns error message for errored panels', () => {
    app.externalTabs = [{ id: 'external:store', panelId: 'store' }];
    app.externalPanels = { store: { id: 'store', status: 'error', error: 'Failed to load' } };
    app.activeTab = 'external:store';
    expect(app.activeExternalError).toBe('Failed to load');
  });
});

describe('App interaction helpers', () => {
  let app: any;

  beforeEach(async () => {
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;
  });

  it('hasInteractions returns false for empty log', () => {
    app.interactionLog = [];
    expect(app.hasInteractions).toBe(false);
  });

  it('hasInteractions returns true for non-empty log', () => {
    app.interactionLog = [{ id: 'evt-1' }];
    expect(app.hasInteractions).toBe(true);
  });

  it('formattedInteractionLog returns log or empty array', () => {
    app.interactionLog = [{ id: 'evt-1' }];
    expect(app.formattedInteractionLog).toEqual([{ id: 'evt-1' }]);
    app.interactionLog = null;
    expect(app.formattedInteractionLog).toEqual([]);
  });
});

describe('App property rows', () => {
  let app: any;

  beforeEach(async () => {
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;
  });

  it('getPropertyRows returns empty for no properties', () => {
    expect(app.getPropertyRows([])).toEqual([]);
    expect(app.getPropertyRows(null)).toEqual([]);
    expect(app.getPropertyRows(undefined)).toEqual([]);
  });

  it('getPropertyRows flattens properties with depth', () => {
    const props = [
      { name: 'a', value: 1 },
      { name: 'b', value: 2 },
    ];
    const rows = app.getPropertyRows(props);
    expect(rows).toHaveLength(2);
    expect(rows[0].property.name).toBe('a');
    expect(rows[0].depth).toBe(0);
  });

  it('getPropertyRows includes expanded nested properties', () => {
    const props = [
      {
        name: 'parent',
        value: {},
        isExpanded: true,
        expandedValue: {
          properties: [
            { name: 'child', value: 'nested' }
          ]
        }
      }
    ];
    const rows = app.getPropertyRows(props);
    expect(rows).toHaveLength(2);
    expect(rows[0].depth).toBe(0);
    expect(rows[1].property.name).toBe('child');
    expect(rows[1].depth).toBe(1);
  });
});

describe('App visible component nodes', () => {
  let app: any;

  beforeEach(async () => {
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;
  });

  it('visibleComponentNodes returns empty for no tree', () => {
    app.componentTree = [];
    expect(app.visibleComponentNodes).toEqual([]);
  });

  it('visibleComponentNodes includes all in list mode', () => {
    app.viewMode = 'list';
    app.componentTree = [
      {
        id: 'root',
        name: 'root',
        type: 'custom-element',
        expanded: false,
        children: [{ id: 'child', name: 'child', type: 'custom-element', children: [] }]
      }
    ];
    const nodes = app.visibleComponentNodes;
    expect(nodes).toHaveLength(2);
  });

  it('visibleComponentNodes respects expanded state in tree mode', () => {
    app.viewMode = 'tree';
    app.componentTree = [
      {
        id: 'root',
        name: 'root',
        type: 'custom-element',
        expanded: false,
        children: [{ id: 'child', name: 'child', type: 'custom-element', children: [] }]
      }
    ];
    let nodes = app.visibleComponentNodes;
    expect(nodes).toHaveLength(1);

    app.componentTree[0].expanded = true;
    nodes = app.visibleComponentNodes;
    expect(nodes).toHaveLength(2);
  });

  it('visibleComponentNodes expands all during search', () => {
    app.viewMode = 'tree';
    app.searchQuery = 'child';
    app.componentTree = [
      {
        id: 'root',
        name: 'root',
        type: 'custom-element',
        expanded: false,
        children: [{ id: 'child', name: 'child', type: 'custom-element', children: [] }]
      }
    ];
    const nodes = app.visibleComponentNodes;
    expect(nodes).toHaveLength(2);
  });
});

describe('App filter tree by type', () => {
  let app: any;

  beforeEach(async () => {
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;
  });

  it('filterTreeByType filters elements only', () => {
    const tree = [
      { id: 'e1', type: 'custom-element', children: [
        { id: 'a1', type: 'custom-attribute', children: [] }
      ] }
    ];
    const filtered = app.filterTreeByType(tree, 'custom-element');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].type).toBe('custom-element');
    expect(filtered[0].children).toHaveLength(0);
  });

  it('filterTreeByType filters attributes only', () => {
    const tree = [
      { id: 'e1', type: 'custom-element', children: [
        { id: 'a1', type: 'custom-attribute', children: [] }
      ] }
    ];
    const filtered = app.filterTreeByType(tree, 'custom-attribute');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].type).toBe('custom-attribute');
  });

  it('filterTreeByType lifts nested matching types', () => {
    const tree = [
      { id: 'e1', type: 'custom-element', children: [
        { id: 'e2', type: 'custom-element', children: [
          { id: 'a1', type: 'custom-attribute', children: [] }
        ] }
      ] }
    ];
    const filtered = app.filterTreeByType(tree, 'custom-attribute');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('a1');
  });
});

describe('App isSameControllerInfo', () => {
  let app: any;

  beforeEach(async () => {
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;
  });

  it('returns false for null inputs', () => {
    expect(app.isSameControllerInfo(null, null)).toBe(false);
    expect(app.isSameControllerInfo({ name: 'a' }, null)).toBe(false);
    expect(app.isSameControllerInfo(null, { name: 'b' })).toBe(false);
  });

  it('matches by key', () => {
    const a = { key: 'comp-key', name: 'comp' };
    const b = { key: 'comp-key', name: 'different' };
    expect(app.isSameControllerInfo(a, b)).toBe(true);
  });

  it('matches by name when keys missing', () => {
    const a = { name: 'comp' };
    const b = { name: 'comp' };
    expect(app.isSameControllerInfo(a, b)).toBe(true);
  });

  it('matches by alias', () => {
    const a = { name: 'comp-a', aliases: ['alias-shared'] };
    const b = { name: 'comp-b', aliases: ['alias-shared'] };
    expect(app.isSameControllerInfo(a, b)).toBe(true);
  });

  it('does not match different controllers', () => {
    const a = { key: 'key-a', name: 'comp-a' };
    const b = { key: 'key-b', name: 'comp-b' };
    expect(app.isSameControllerInfo(a, b)).toBe(false);
  });
});
