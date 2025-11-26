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
  app.interactionSignature = '';
  app.aureliaDetected = false;
  app.aureliaVersion = null;
  app.detectionState = 'checking';
  app.isRefreshing = false;
  app.copiedPropertyId = null;
  app.propertyRowsRevision = 0;

  const debugHost = stubDebugHost();
  const plat = stubPlatform();
  app.debugHost = debugHost;
  app.plat = plat;

  return { app, debugHost, plat };
}

describe('App interaction log loading', () => {
  let app: any;
  let debugHost: any;

  beforeEach(async () => {
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;
    debugHost = result.debugHost;
  });

  it('loadInteractionLog fetches and sorts log', async () => {
    debugHost.getInteractionLog.mockResolvedValue([
      { id: 'evt-1', timestamp: 100 },
      { id: 'evt-2', timestamp: 200 },
    ]);

    await app.loadInteractionLog();

    expect(app.interactionLog).toHaveLength(2);
    expect(app.interactionLog[0].id).toBe('evt-2');
    expect(app.interactionLog[1].id).toBe('evt-1');
  });

  it('loadInteractionLog sets loading state', async () => {
    let resolvePromise: Function;
    debugHost.getInteractionLog.mockReturnValue(new Promise(r => { resolvePromise = r; }));

    const promise = app.loadInteractionLog();
    expect(app.interactionLoading).toBe(true);

    resolvePromise!([]);
    await promise;
    expect(app.interactionLoading).toBe(false);
  });

  it('loadInteractionLog handles errors', async () => {
    debugHost.getInteractionLog.mockRejectedValue(new Error('Network error'));

    await app.loadInteractionLog();

    expect(app.interactionError).toBe('Network error');
    expect(app.interactionLog).toEqual([]);
  });

  it('loadInteractionLog silent mode does not update loading state', async () => {
    debugHost.getInteractionLog.mockResolvedValue([]);
    app.interactionLoading = false;

    await app.loadInteractionLog(false, true);

    expect(app.interactionLoading).toBe(false);
  });

  it('loadInteractionLog skips reload if signature unchanged', async () => {
    debugHost.getInteractionLog.mockResolvedValue([
      { id: 'evt-1', timestamp: 100 }
    ]);

    await app.loadInteractionLog();
    const firstLog = app.interactionLog;

    await app.loadInteractionLog();
    expect(app.interactionLog).toBe(firstLog);
  });
});

describe('App interaction replay and snapshot', () => {
  let app: any;
  let debugHost: any;

  beforeEach(async () => {
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;
    debugHost = result.debugHost;
  });

  it('replayInteraction calls debugHost', async () => {
    debugHost.replayInteraction.mockResolvedValue(true);

    await app.replayInteraction('evt-1');

    expect(debugHost.replayInteraction).toHaveBeenCalledWith('evt-1');
  });

  it('replayInteraction does nothing for empty id', async () => {
    await app.replayInteraction('');
    await app.replayInteraction(null);

    expect(debugHost.replayInteraction).not.toHaveBeenCalled();
  });

  it('replayInteraction handles errors gracefully', async () => {
    debugHost.replayInteraction.mockRejectedValue(new Error('Replay failed'));

    await expect(app.replayInteraction('evt-1')).resolves.toBeUndefined();
  });

  it('applyInteractionSnapshot calls debugHost with phase', async () => {
    debugHost.applyInteractionSnapshot.mockResolvedValue(true);

    await app.applyInteractionSnapshot('evt-1', 'before');

    expect(debugHost.applyInteractionSnapshot).toHaveBeenCalledWith('evt-1', 'before');
  });

  it('applyInteractionSnapshot does nothing for empty id', async () => {
    await app.applyInteractionSnapshot('', 'before');

    expect(debugHost.applyInteractionSnapshot).not.toHaveBeenCalled();
  });

  it('clearInteractionLog clears log optimistically and calls debugHost', async () => {
    app.interactionLog = [{ id: 'evt-1' }];
    app.interactionSignature = 'evt-1:100';
    debugHost.clearInteractionLog.mockResolvedValue(true);

    await app.clearInteractionLog();

    expect(app.interactionLog).toEqual([]);
    expect(app.interactionSignature).toBe('');
    expect(debugHost.clearInteractionLog).toHaveBeenCalled();
  });
});

describe('App incoming interaction handling', () => {
  let app: any;

  beforeEach(async () => {
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;
  });

  it('handleIncomingInteraction adds new entries', () => {
    app.interactionLog = [];
    app.handleIncomingInteraction({ id: 'evt-1', timestamp: 100 });

    expect(app.interactionLog).toHaveLength(1);
    expect(app.interactionLog[0].id).toBe('evt-1');
  });

  it('handleIncomingInteraction ignores duplicates', () => {
    app.interactionLog = [{ id: 'evt-1', timestamp: 100 }];
    app.handleIncomingInteraction({ id: 'evt-1', timestamp: 100 });

    expect(app.interactionLog).toHaveLength(1);
  });

  it('handleIncomingInteraction ignores invalid entries', () => {
    app.interactionLog = [];
    app.handleIncomingInteraction(null);
    app.handleIncomingInteraction({});
    app.handleIncomingInteraction({ id: '' });

    expect(app.interactionLog).toHaveLength(0);
  });

  it('handleIncomingInteraction sorts by timestamp descending', () => {
    app.interactionLog = [{ id: 'evt-1', timestamp: 100 }];
    app.handleIncomingInteraction({ id: 'evt-2', timestamp: 200 });

    expect(app.interactionLog[0].id).toBe('evt-2');
    expect(app.interactionLog[1].id).toBe('evt-1');
  });

  it('handleIncomingInteraction updates signature', () => {
    app.interactionLog = [];
    app.interactionSignature = '';
    app.handleIncomingInteraction({ id: 'evt-1', timestamp: 100 });

    expect(app.interactionSignature).toContain('evt-1');
  });
});

describe('App property editing', () => {
  let app: any;
  let debugHost: any;
  let plat: any;

  beforeEach(async () => {
    jest.useFakeTimers();
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;
    debugHost = result.debugHost;
    plat = result.plat;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('editProperty sets editing state for editable types', () => {
    const prop = { type: 'string', value: 'hello', isEditing: false };
    app.editProperty(prop);
    expect(prop.isEditing).toBe(true);
    expect(prop.originalValue).toBe('hello');
  });

  it('editProperty does not edit non-editable types', () => {
    const prop = { type: 'function', value: () => {}, isEditing: false };
    app.editProperty(prop);
    expect(prop.isEditing).toBe(false);
  });

  it('cancelPropertyEdit reverts value and clears editing state', () => {
    const prop = { type: 'string', value: 'new', isEditing: true, originalValue: 'old' };
    app.cancelPropertyEdit(prop);
    expect(prop.value).toBe('old');
    expect(prop.isEditing).toBe(false);
    expect(prop.originalValue).toBeUndefined();
  });

  it('saveProperty handles null conversion', () => {
    const prop = { type: 'null', value: null, isEditing: true, originalValue: null };
    app.selectedElement = { properties: [prop], bindables: [] };

    app.saveProperty(prop, 'null');

    expect(prop.value).toBeNull();
    expect(prop.isEditing).toBe(false);
  });

  it('saveProperty converts null input to string when not null', () => {
    const prop = { type: 'null', value: null, isEditing: true, originalValue: null };
    app.selectedElement = { properties: [prop], bindables: [] };

    app.saveProperty(prop, 'some text');

    expect(prop.value).toBe('some text');
    expect(prop.type).toBe('string');
  });

  it('saveProperty handles undefined conversion', () => {
    const prop = { type: 'undefined', value: undefined, isEditing: true, originalValue: undefined };
    app.selectedElement = { properties: [prop], bindables: [] };

    app.saveProperty(prop, 'undefined');

    expect(prop.value).toBeUndefined();
    expect(prop.isEditing).toBe(false);
  });

  it('saveProperty converts undefined input to string when not undefined', () => {
    const prop = { type: 'undefined', value: undefined, isEditing: true, originalValue: undefined };
    app.selectedElement = { properties: [prop], bindables: [] };

    app.saveProperty(prop, 'new value');

    expect(prop.value).toBe('new value');
    expect(prop.type).toBe('string');
  });

  it('saveProperty reverts on invalid boolean', () => {
    const prop = { type: 'boolean', value: true, isEditing: true, originalValue: true };
    app.selectedElement = { properties: [prop], bindables: [] };

    app.saveProperty(prop, 'not-a-boolean');

    expect(prop.value).toBe(true);
    expect(prop.isEditing).toBe(false);
  });
});

describe('App property copying', () => {
  let app: any;

  beforeEach(async () => {
    jest.useFakeTimers();
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;

    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('copyPropertyValue copies null as string', async () => {
    const prop = { name: 'test', value: null, debugId: '1' };
    await app.copyPropertyValue(prop);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('null');
  });

  it('copyPropertyValue copies undefined as string', async () => {
    const prop = { name: 'test', value: undefined, debugId: '1' };
    await app.copyPropertyValue(prop);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('undefined');
  });

  it('copyPropertyValue copies objects as JSON', async () => {
    const prop = { name: 'test', value: { foo: 'bar' }, debugId: '1' };
    await app.copyPropertyValue(prop);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(JSON.stringify({ foo: 'bar' }, null, 2));
  });

  it('copyPropertyValue copies primitives as strings', async () => {
    const prop = { name: 'test', value: 42, debugId: '1' };
    await app.copyPropertyValue(prop);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('42');
  });

  it('copyPropertyValue sets copied state temporarily', async () => {
    const prop = { name: 'test', value: 'hello', debugId: '1' };
    await app.copyPropertyValue(prop);

    expect(app.copiedPropertyId).toBe('test-1');

    jest.advanceTimersByTime(1600);
    expect(app.copiedPropertyId).toBeNull();
  });

  it('isPropertyCopied returns correct state', async () => {
    const prop = { name: 'test', value: 'hello', debugId: '1' };
    expect(app.isPropertyCopied(prop)).toBe(false);

    await app.copyPropertyValue(prop);
    expect(app.isPropertyCopied(prop)).toBe(true);
  });

  it('copyPropertyValue stops event propagation', async () => {
    const prop = { name: 'test', value: 'hello', debugId: '1' };
    const event = { stopPropagation: jest.fn() };

    await app.copyPropertyValue(prop, event);

    expect(event.stopPropagation).toHaveBeenCalled();
  });
});

describe('App component export', () => {
  let app: any;

  beforeEach(async () => {
    jest.useFakeTimers();
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;

    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('exportComponentAsJson does nothing without selected element', async () => {
    app.selectedElement = undefined;
    await app.exportComponentAsJson();

    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('exportComponentAsJson copies JSON to clipboard', async () => {
    app.selectedElement = {
      name: 'my-component',
      key: 'my-key',
      aliases: [],
      bindables: [{ name: 'count', value: 5, type: 'number' }],
      properties: [],
    };
    app.selectedNodeType = 'custom-element';
    app.selectedElementAttributes = [];

    await app.exportComponentAsJson();

    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    const calledWith = (navigator.clipboard.writeText as jest.Mock).mock.calls[0][0];
    const parsed = JSON.parse(calledWith);
    expect(parsed.meta.name).toBe('my-component');
    expect(parsed.bindables.count.value).toBe(5);
  });

  it('isExportCopied returns correct state', async () => {
    app.selectedElement = { name: 'comp', bindables: [], properties: [] };
    app.selectedElementAttributes = [];

    expect(app.isExportCopied).toBe(false);

    await app.exportComponentAsJson();
    expect(app.isExportCopied).toBe(true);

    jest.advanceTimersByTime(1600);
    expect(app.isExportCopied).toBe(false);
  });
});

describe('App component refresh', () => {
  let app: any;
  let debugHost: any;

  beforeEach(async () => {
    jest.useFakeTimers();
    ChromeTest.reset();
    const result = await createApp();
    app = result.app;
    debugHost = result.debugHost;
    debugHost.getAllComponents.mockResolvedValue({ tree: [], flat: [] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('refreshComponents sets isRefreshing during load', async () => {
    expect(app.isRefreshing).toBe(false);

    app.refreshComponents();
    expect(app.isRefreshing).toBe(true);

    jest.runAllTimers();
    await Promise.resolve();
    await Promise.resolve();
    jest.runAllTimers();

    expect(app.isRefreshing).toBe(false);
  });

  it('refreshComponents does not run if already refreshing', () => {
    app.isRefreshing = true;
    app.refreshComponents();

    expect(debugHost.getAllComponents).not.toHaveBeenCalled();
  });
});
