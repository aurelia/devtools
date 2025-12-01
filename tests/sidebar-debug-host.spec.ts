import './setup';
import { ChromeTest } from './setup';

let SidebarDebugHostClass: any;

function createMockConsumer() {
  return {
    followChromeSelection: true,
    onElementPicked: jest.fn(),
    onPropertyChanges: jest.fn(),
  };
}

describe('SidebarDebugHost', () => {
  let host: any;
  let consumer: any;

  beforeEach(async () => {
    ChromeTest.reset();
    jest.resetModules();
    jest.useFakeTimers();

    const mod = await import('@/sidebar/sidebar-debug-host');
    SidebarDebugHostClass = mod.SidebarDebugHost;

    host = new SidebarDebugHostClass();
    consumer = createMockConsumer();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('attach', () => {
    it('sets consumer reference', () => {
      host.attach(consumer);
      expect(host.consumer).toBe(consumer);
    });

    it('registers selection changed listener', () => {
      host.attach(consumer);

      expect((global as any).chrome.devtools.panels.elements.onSelectionChanged.hasListeners()).toBe(true);
    });
  });

  describe('updateValues', () => {
    it('calls inspectedWindow.eval with correct arguments', () => {
      const componentInfo = { name: 'test', key: 'test-key' };
      const property = { name: 'value', value: 42 };

      host.updateValues(componentInfo, property);

      expect((global as any).chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();
      const call = (global as any).chrome.devtools.inspectedWindow.eval.mock.calls[0][0];
      expect(call).toContain('updateValues');
    });
  });

  describe('element picker', () => {
    beforeEach(() => {
      host.attach(consumer);
    });

    it('startElementPicker injects picker code', () => {
      host.startElementPicker();

      expect((global as any).chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();
      const code = (global as any).chrome.devtools.inspectedWindow.eval.mock.calls[0][0];
      expect(code).toContain('aurelia-picker');
    });

    it('startElementPicker starts polling', () => {
      host.startElementPicker();

      expect(host.pickerPollingInterval).not.toBeNull();
    });

    it('stopElementPicker stops polling', () => {
      host.startElementPicker();
      host.stopElementPicker();

      expect(host.pickerPollingInterval).toBeNull();
    });

    it('stopElementPicker calls cleanup function', () => {
      host.stopElementPicker();

      expect((global as any).chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();
      const code = (global as any).chrome.devtools.inspectedWindow.eval.mock.calls[0][0];
      expect(code).toContain('__aureliaDevtoolsStopPicker');
    });
  });

  describe('property watching', () => {
    beforeEach(() => {
      host.attach(consumer);
    });

    it('startPropertyWatching sets watching state', async () => {
      ChromeTest.setEvalToReturn([
        { result: false },
        { result: null }
      ]);

      host.startPropertyWatching({ componentKey: 'test-key', pollInterval: 500 });

      expect(host.watchingComponentKey).toBe('test-key');

      await Promise.resolve();
      await Promise.resolve();

      expect(host.propertyWatchInterval).not.toBeNull();
    });

    it('startPropertyWatching uses event-driven watching when available', async () => {
      ChromeTest.setEvalToReturn([{ result: true }]);

      host.startPropertyWatching({ componentKey: 'test-key', pollInterval: 500 });

      await Promise.resolve();
      await Promise.resolve();

      expect(host.watchingComponentKey).toBe('test-key');
      expect((host as any).useEventDrivenWatching).toBe(true);
      expect(host.propertyWatchInterval).toBeNull();
    });

    it('stopPropertyWatching clears watching state', async () => {
      ChromeTest.setEvalToReturn([
        { result: false },
        { result: null }
      ]);
      host.startPropertyWatching({ componentKey: 'test-key', pollInterval: 500 });

      await Promise.resolve();
      await Promise.resolve();

      host.stopPropertyWatching();

      expect(host.watchingComponentKey).toBeNull();
      expect(host.propertyWatchInterval).toBeNull();
    });

    it('stopPropertyWatching detaches event-driven watchers', async () => {
      ChromeTest.setEvalToReturn([{ result: true }]);
      host.startPropertyWatching({ componentKey: 'test-key' });

      await Promise.resolve();
      await Promise.resolve();

      ChromeTest.setEvalToReturn([{ result: undefined }]);
      host.stopPropertyWatching();

      expect((global as any).chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();
      expect(host.watchingComponentKey).toBeNull();
      expect((host as any).useEventDrivenWatching).toBe(false);
    });
  });

  describe('searchComponents', () => {
    it('returns empty array when no chrome.devtools', async () => {
      ChromeTest.removeChrome();

      const results = await host.searchComponents('test');

      expect(results).toEqual([]);

      ChromeTest.restoreChrome();
    });

    it('calls inspectedWindow.eval with search query', async () => {
      ChromeTest.setEvalToReturn([{
        result: [
          { key: 'comp-1', name: 'my-component', type: 'custom-element' }
        ]
      }]);

      const promise = host.searchComponents('my');

      const results = await promise;

      expect((global as any).chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('my-component');
    });

    it('returns empty array when result is not array', async () => {
      ChromeTest.setEvalToReturn([{ result: null }]);

      const results = await host.searchComponents('test');

      expect(results).toEqual([]);
    });
  });

  describe('selectComponentByKey', () => {
    beforeEach(() => {
      host.attach(consumer);
    });

    it('calls inspectedWindow.eval with component key', () => {
      ChromeTest.setEvalToReturn([{ result: null }]);

      host.selectComponentByKey('my-key');

      expect((global as any).chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();
      const code = (global as any).chrome.devtools.inspectedWindow.eval.mock.calls[0][0];
      expect(code).toContain('my-key');
    });

    it('notifies consumer when component found', () => {
      const componentInfo = {
        customElementInfo: { name: 'test', key: 'test-key' },
        customAttributesInfo: []
      };
      ChromeTest.setEvalToReturn([{ result: componentInfo }]);

      host.selectComponentByKey('test-key');

      expect(consumer.onElementPicked).toHaveBeenCalledWith(componentInfo);
    });
  });

  describe('revealInElements', () => {
    it('calls inspectedWindow.eval with component info', () => {
      ChromeTest.setEvalToReturn([{ result: true }]);

      const componentInfo = {
        name: 'test',
        type: 'custom-element',
        customElementInfo: { name: 'test' },
        customAttributesInfo: []
      };

      host.revealInElements(componentInfo);

      expect((global as any).chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();
      const code = (global as any).chrome.devtools.inspectedWindow.eval.mock.calls[0][0];
      expect(code).toContain('findElementByComponentInfo');
      expect(code).toContain('inspect');
    });
  });

  describe('enhanced info methods', () => {
    it('getLifecycleHooks calls hook method', async () => {
      ChromeTest.setEvalToReturn([{
        result: { hooks: [{ name: 'attached', implemented: true }] }
      }]);

      const result = await host.getLifecycleHooks('test-key');

      expect((global as any).chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();
      const code = (global as any).chrome.devtools.inspectedWindow.eval.mock.calls[0][0];
      expect(code).toContain('getLifecycleHooks');
      expect(result.hooks).toHaveLength(1);
    });

    it('getComputedProperties returns array', async () => {
      ChromeTest.setEvalToReturn([{
        result: [{ name: 'fullName', hasGetter: true }]
      }]);

      const result = await host.getComputedProperties('test-key');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('fullName');
    });

    it('getComputedProperties returns empty array on null', async () => {
      ChromeTest.setEvalToReturn([{ result: null }]);

      const result = await host.getComputedProperties('test-key');

      expect(result).toEqual([]);
    });

    it('getDependencies calls hook method', async () => {
      ChromeTest.setEvalToReturn([{
        result: { dependencies: [{ name: 'HttpClient', type: 'class' }] }
      }]);

      const result = await host.getDependencies('test-key');

      expect(result.dependencies).toHaveLength(1);
    });

    it('getRouteInfo calls hook method', async () => {
      ChromeTest.setEvalToReturn([{
        result: { currentRoute: '/users', params: [] }
      }]);

      const result = await host.getRouteInfo('test-key');

      expect(result.currentRoute).toBe('/users');
    });

    it('getSlotInfo calls hook method', async () => {
      ChromeTest.setEvalToReturn([{
        result: { slots: [{ name: 'default', hasContent: true }] }
      }]);

      const result = await host.getSlotInfo('test-key');

      expect(result.slots).toHaveLength(1);
    });
  });

  describe('getPropertySnapshot', () => {
    it('returns null when no chrome.devtools', async () => {
      ChromeTest.removeChrome();

      const result = await host.getPropertySnapshot('test-key');

      expect(result).toBeNull();

      ChromeTest.restoreChrome();
    });

    it('returns snapshot from eval', async () => {
      const snapshot = {
        componentKey: 'test-key',
        bindables: [{ name: 'value', value: 1, type: 'number' }],
        properties: [],
        timestamp: Date.now()
      };
      ChromeTest.setEvalToReturn([{ result: snapshot }]);

      const result = await host.getPropertySnapshot('test-key');

      expect(result).toEqual(snapshot);
    });
  });

  describe('property snapshot diffing', () => {
    it('detects changes between snapshots', () => {
      const oldSnap = {
        componentKey: 'test',
        bindables: [{ name: 'count', value: 1, type: 'number' }],
        properties: [],
        timestamp: 1000
      };

      const newSnap = {
        componentKey: 'test',
        bindables: [{ name: 'count', value: 2, type: 'number' }],
        properties: [],
        timestamp: 2000
      };

      const changes = host.diffPropertySnapshots(oldSnap, newSnap);

      expect(changes).toHaveLength(1);
      expect(changes[0].propertyName).toBe('count');
      expect(changes[0].oldValue).toBe(1);
      expect(changes[0].newValue).toBe(2);
    });

    it('returns empty array when no changes', () => {
      const oldSnap = {
        componentKey: 'test',
        bindables: [{ name: 'count', value: 1, type: 'number' }],
        properties: [],
        timestamp: 1000
      };

      const newSnap = {
        componentKey: 'test',
        bindables: [{ name: 'count', value: 1, type: 'number' }],
        properties: [],
        timestamp: 2000
      };

      const changes = host.diffPropertySnapshots(oldSnap, newSnap);

      expect(changes).toHaveLength(0);
    });
  });

  describe('valuesEqual', () => {
    it('returns true for identical primitives', () => {
      expect(host.valuesEqual(1, 1)).toBe(true);
      expect(host.valuesEqual('test', 'test')).toBe(true);
      expect(host.valuesEqual(true, true)).toBe(true);
    });

    it('returns false for different primitives', () => {
      expect(host.valuesEqual(1, 2)).toBe(false);
      expect(host.valuesEqual('a', 'b')).toBe(false);
    });

    it('returns true for equal objects', () => {
      expect(host.valuesEqual({ a: 1 }, { a: 1 })).toBe(true);
    });

    it('returns false for different objects', () => {
      expect(host.valuesEqual({ a: 1 }, { a: 2 })).toBe(false);
    });

    it('handles null values', () => {
      expect(host.valuesEqual(null, null)).toBe(true);
      expect(host.valuesEqual(null, 1)).toBe(false);
    });
  });

  describe('getComponentTree', () => {
    it('returns component tree from hook', async () => {
      const mockTree = [
        { key: 'app', name: 'App', tagName: 'app', type: 'custom-element', hasChildren: true },
        { key: 'header', name: 'Header', tagName: 'header', type: 'custom-element', hasChildren: false },
      ];
      ChromeTest.setEvalToReturn([{ result: mockTree }]);

      const result = await host.getComponentTree();

      expect((global as any).chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();
      const code = (global as any).chrome.devtools.inspectedWindow.eval.mock.calls[0][0];
      expect(code).toContain('getSimplifiedComponentTree');
      expect(result).toEqual(mockTree);
    });

    it('returns empty array when result is not array', async () => {
      ChromeTest.setEvalToReturn([{ result: null }]);

      const result = await host.getComponentTree();

      expect(result).toEqual([]);
    });

    it('returns empty array when chrome.devtools unavailable', async () => {
      const original = (global as any).chrome.devtools;
      delete (global as any).chrome.devtools;

      const result = await host.getComponentTree();

      expect(result).toEqual([]);

      (global as any).chrome.devtools = original;
    });
  });

  describe('timeline / interaction recording', () => {
    it('startInteractionRecording calls hook and returns true on success', async () => {
      ChromeTest.setEvalToReturn([{ result: true }]);

      const result = await host.startInteractionRecording();

      expect((global as any).chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();
      const code = (global as any).chrome.devtools.inspectedWindow.eval.mock.calls[0][0];
      expect(code).toContain('startInteractionRecording');
      expect(result).toBe(true);
    });

    it('startInteractionRecording returns false on failure', async () => {
      ChromeTest.setEvalToReturn([{ result: false }]);

      const result = await host.startInteractionRecording();

      expect(result).toBe(false);
    });

    it('startInteractionRecording returns false when chrome.devtools unavailable', async () => {
      const original = (global as any).chrome.devtools;
      delete (global as any).chrome.devtools;

      const result = await host.startInteractionRecording();

      expect(result).toBe(false);

      (global as any).chrome.devtools = original;
    });

    it('stopInteractionRecording calls hook and returns true on success', async () => {
      ChromeTest.setEvalToReturn([{ result: true }]);

      const result = await host.stopInteractionRecording();

      expect((global as any).chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();
      const code = (global as any).chrome.devtools.inspectedWindow.eval.mock.calls[0][0];
      expect(code).toContain('stopInteractionRecording');
      expect(result).toBe(true);
    });

    it('stopInteractionRecording returns false on failure', async () => {
      ChromeTest.setEvalToReturn([{ result: false }]);

      const result = await host.stopInteractionRecording();

      expect(result).toBe(false);
    });

    it('clearInteractionLog calls hook method', () => {
      ChromeTest.setEvalToReturn([{ result: undefined }]);

      host.clearInteractionLog();

      expect((global as any).chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();
      const code = (global as any).chrome.devtools.inspectedWindow.eval.mock.calls[0][0];
      expect(code).toContain('clearInteractionLog');
    });

    it('clearInteractionLog does nothing when chrome.devtools unavailable', () => {
      const original = (global as any).chrome.devtools;
      delete (global as any).chrome.devtools;

      expect(() => host.clearInteractionLog()).not.toThrow();

      (global as any).chrome.devtools = original;
    });
  });

  describe('getTemplateSnapshot', () => {
    it('returns template snapshot from hook', async () => {
      const mockSnapshot = {
        componentKey: 'test-key',
        componentName: 'test',
        bindings: [{ id: 'b1', type: 'property', expression: 'foo' }],
        controllers: [],
        instructions: [],
        hasSlots: false,
        shadowMode: 'none',
        isContainerless: false,
      };
      ChromeTest.setEvalToReturn([{ result: mockSnapshot }]);

      const result = await host.getTemplateSnapshot('test-key');

      expect((global as any).chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();
      const code = (global as any).chrome.devtools.inspectedWindow.eval.mock.calls[0][0];
      expect(code).toContain('getTemplateSnapshot');
      expect(result).toEqual(mockSnapshot);
    });

    it('returns null when no result', async () => {
      ChromeTest.setEvalToReturn([{ result: null }]);

      const result = await host.getTemplateSnapshot('test-key');

      expect(result).toBeNull();
    });
  });
});
