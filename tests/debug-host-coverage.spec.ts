import './setup';
import { ChromeTest } from './setup';

describe('DebugHost additional coverage', () => {
  let DebugHost: any;
  let debugHost: any;
  let mockConsumer: any;

  beforeEach(async () => {
    ChromeTest.restoreChrome();
    jest.resetModules();
    ChromeTest.reset();

    const mod = await import('@/backend/debug-host');
    DebugHost = mod.DebugHost;
    debugHost = new DebugHost();

    mockConsumer = {
      handleComponentSnapshot: jest.fn(),
      onElementPicked: jest.fn(),
      selectedElement: null,
      selectedElementAttributes: null,
      followChromeSelection: true,
      onPropertyChanges: jest.fn(),
    };
  });

  afterEach(() => {
    ChromeTest.restoreChrome();
  });

  describe('attach with navigation and selection', () => {
    it('handles navigation event when attached', async () => {
      ChromeTest.setEvalToReturn([{ result: { kind: 'tree', data: [] } }]);

      debugHost.attach(mockConsumer);

      ChromeTest.triggerNavigated('http://localhost/new-page');
      await Promise.resolve();

      expect(chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();
    });

    it('skips selection when followChromeSelection is false', () => {
      mockConsumer.followChromeSelection = false;
      debugHost.attach(mockConsumer);

      ChromeTest.triggerSelectionChanged();

      expect(chrome.devtools.inspectedWindow.eval).not.toHaveBeenCalled();
    });

    it('handles selection with debugObject using onElementPicked', () => {
      debugHost.attach(mockConsumer);

      const debugObject = {
        customElementInfo: { name: 'my-element' },
        customAttributesInfo: [{ name: 'my-attr' }],
      };

      ChromeTest.setEvalImplementation((_expr: string, cb: Function) => {
        cb(debugObject);
      });

      ChromeTest.triggerSelectionChanged();

      expect(mockConsumer.onElementPicked).toHaveBeenCalledWith(debugObject);
    });

    it('handles selection with null debugObject', () => {
      debugHost.attach(mockConsumer);

      ChromeTest.setEvalImplementation((_expr: string, cb: Function) => {
        cb(null);
      });

      ChromeTest.triggerSelectionChanged();

      expect(mockConsumer.onElementPicked).not.toHaveBeenCalled();
    });

    it('falls back to direct property assignment when onElementPicked not available', () => {
      const simpleConsumer = {
        handleComponentSnapshot: jest.fn(),
        selectedElement: null,
        selectedElementAttributes: null,
        followChromeSelection: true,
      };

      debugHost.attach(simpleConsumer);

      const debugObject = {
        customElementInfo: { name: 'my-element' },
        customAttributesInfo: [{ name: 'my-attr' }],
      };

      ChromeTest.setEvalImplementation((_expr: string, cb: Function) => {
        cb(debugObject);
      });

      ChromeTest.triggerSelectionChanged();

      expect(simpleConsumer.selectedElement).toEqual({ name: 'my-element' });
      expect(simpleConsumer.selectedElementAttributes).toEqual([{ name: 'my-attr' }]);
    });
  });

  describe('getAllComponents edge cases', () => {
    it('handles null result from eval', async () => {
      debugHost.consumer = mockConsumer;
      ChromeTest.setEvalImplementation((_expr: string, cb: Function) => {
        cb(null);
      });

      const result = await debugHost.getAllComponents();

      expect(result).toEqual({ tree: [], flat: [] });
    });

    it('handles flat data result', async () => {
      debugHost.consumer = mockConsumer;
      ChromeTest.setEvalImplementation((_expr: string, cb: Function) => {
        cb({ kind: 'flat', data: [{ name: 'comp1' }, { name: 'comp2' }] });
      });

      const result = await debugHost.getAllComponents();

      expect(result).toEqual({ tree: [], flat: [{ name: 'comp1' }, { name: 'comp2' }] });
    });

    it('handles tree data result', async () => {
      debugHost.consumer = mockConsumer;
      ChromeTest.setEvalImplementation((_expr: string, cb: Function) => {
        cb({ kind: 'tree', data: [{ id: 'root', children: [] }] });
      });

      const result = await debugHost.getAllComponents();

      expect(result).toEqual({ tree: [{ id: 'root', children: [] }], flat: [] });
    });

    it('handles non-array data gracefully', async () => {
      debugHost.consumer = mockConsumer;
      ChromeTest.setEvalImplementation((_expr: string, cb: Function) => {
        cb({ kind: 'tree', data: 'not-an-array' });
      });

      const result = await debugHost.getAllComponents();

      expect(result).toEqual({ tree: [], flat: [] });
    });

    it('returns empty when chrome is not available', async () => {
      ChromeTest.removeChrome();
      debugHost.consumer = mockConsumer;

      const result = await debugHost.getAllComponents();

      expect(result).toEqual({ tree: [], flat: [] });
      ChromeTest.restoreChrome();
    });
  });

  describe('updateValues', () => {
    it('calls eval with correct code', () => {
      debugHost.consumer = mockConsumer;

      const value = { name: 'comp', key: 'comp-key' };
      const property = { name: 'count', value: 5 };

      debugHost.updateValues(value, property);

      expect(chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();
      const code = (chrome.devtools.inspectedWindow.eval as jest.Mock).mock.calls[0][0];
      expect(code).toContain('updateValues');
      expect(code).toContain('comp');
    });
  });

  describe('updateDebugValue', () => {
    it('wraps string values in quotes', () => {
      debugHost.consumer = mockConsumer;

      const debugInfo = { debugId: 1, value: 'hello', type: 'string' };
      debugHost.updateDebugValue(debugInfo);

      expect(chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();
      const code = (chrome.devtools.inspectedWindow.eval as jest.Mock).mock.calls[0][0];
      expect(code).toContain("'hello'");
    });

    it('does not wrap non-string values', () => {
      debugHost.consumer = mockConsumer;

      const debugInfo = { debugId: 1, value: 42, type: 'number' };
      debugHost.updateDebugValue(debugInfo);

      expect(chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();
      const code = (chrome.devtools.inspectedWindow.eval as jest.Mock).mock.calls[0][0];
      expect(code).toContain('42');
      expect(code).not.toContain("'42'");
    });
  });

  describe('toggleDebugValueExpansion', () => {
    it('expands expandable property without existing value', () => {
      debugHost.consumer = mockConsumer;

      const debugInfo = { debugId: 1, canExpand: true, isExpanded: false, expandedValue: null };

      ChromeTest.setEvalImplementation((_expr: string, cb: Function) => {
        cb({ properties: [{ name: 'child', value: 'test' }] });
      });

      debugHost.toggleDebugValueExpansion(debugInfo);

      expect(debugInfo.isExpanded).toBe(true);
      expect(chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();
    });

    it('collapses already expanded property', () => {
      debugHost.consumer = mockConsumer;

      const debugInfo = {
        debugId: 1,
        canExpand: true,
        isExpanded: true,
        expandedValue: { properties: [] },
      };

      debugHost.toggleDebugValueExpansion(debugInfo);

      expect(debugInfo.isExpanded).toBe(false);
    });

    it('does nothing for non-expandable property', () => {
      debugHost.consumer = mockConsumer;

      const debugInfo = { debugId: 1, canExpand: false, isExpanded: false };

      debugHost.toggleDebugValueExpansion(debugInfo);

      expect(debugInfo.isExpanded).toBe(false);
      expect(chrome.devtools.inspectedWindow.eval).not.toHaveBeenCalled();
    });
  });

  describe('revealInElements', () => {
    it('calls eval with inspect code', () => {
      debugHost.consumer = mockConsumer;

      const componentInfo = { name: 'my-element', key: 'my-key' };
      debugHost.revealInElements(componentInfo);

      expect(chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();
      const code = (chrome.devtools.inspectedWindow.eval as jest.Mock).mock.calls[0][0];
      expect(code).toContain('findElementByComponentInfo');
      expect(code).toContain('inspect');
    });
  });

  describe('property watching', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('starts property watching with specified interval', async () => {
      debugHost.consumer = mockConsumer;

      ChromeTest.setEvalToReturn([{ result: { componentKey: 'comp-key', bindables: [], properties: [], timestamp: 1 } }]);

      debugHost.startPropertyWatching({ componentKey: 'comp-key', pollInterval: 200 });

      expect(debugHost.watchingComponentKey).toBe('comp-key');

      jest.advanceTimersByTime(200);

      expect(chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();

      debugHost.stopPropertyWatching();
    });

    it('stops property watching and clears state', () => {
      debugHost.consumer = mockConsumer;
      debugHost.watchingComponentKey = 'comp-key';
      debugHost.propertyWatchInterval = setInterval(() => {}, 1000);

      debugHost.stopPropertyWatching();

      expect(debugHost.watchingComponentKey).toBeNull();
      expect(debugHost.propertyWatchInterval).toBeNull();
    });

    it('detects property changes and notifies consumer', async () => {
      debugHost.consumer = mockConsumer;
      debugHost.watchingComponentKey = 'comp-key';

      const oldSnapshot = {
        componentKey: 'comp-key',
        bindables: [{ name: 'count', value: 1, type: 'number' }],
        properties: [],
        timestamp: 1,
      };
      const newSnapshot = {
        componentKey: 'comp-key',
        bindables: [{ name: 'count', value: 2, type: 'number' }],
        properties: [],
        timestamp: 2,
      };

      debugHost.lastPropertySnapshot = oldSnapshot;

      ChromeTest.setEvalToReturn([{ result: newSnapshot }]);

      await debugHost.checkForPropertyChanges();

      expect(mockConsumer.onPropertyChanges).toHaveBeenCalled();
      const [changes] = mockConsumer.onPropertyChanges.mock.calls[0];
      expect(changes).toHaveLength(1);
      expect(changes[0].propertyName).toBe('count');
      expect(changes[0].oldValue).toBe(1);
      expect(changes[0].newValue).toBe(2);
    });

    it('does not notify when no changes', async () => {
      debugHost.consumer = mockConsumer;
      debugHost.watchingComponentKey = 'comp-key';

      const snapshot = {
        componentKey: 'comp-key',
        bindables: [{ name: 'count', value: 1, type: 'number' }],
        properties: [],
        timestamp: 1,
      };

      debugHost.lastPropertySnapshot = snapshot;

      ChromeTest.setEvalToReturn([{ result: snapshot }]);

      await debugHost.checkForPropertyChanges();

      expect(mockConsumer.onPropertyChanges).not.toHaveBeenCalled();
    });

    it('handles null snapshot during change check', async () => {
      debugHost.consumer = mockConsumer;
      debugHost.watchingComponentKey = 'comp-key';
      debugHost.lastPropertySnapshot = null;

      ChromeTest.setEvalToReturn([{ result: null }]);

      await debugHost.checkForPropertyChanges();

      expect(mockConsumer.onPropertyChanges).not.toHaveBeenCalled();
    });
  });

  describe('refreshSelectedComponent', () => {
    it('returns null when no component is being watched', async () => {
      debugHost.consumer = mockConsumer;
      debugHost.watchingComponentKey = null;

      const result = await debugHost.refreshSelectedComponent();

      expect(result).toBeNull();
    });

    it('returns component info when watching', async () => {
      debugHost.consumer = mockConsumer;
      debugHost.watchingComponentKey = 'comp-key';

      const componentInfo = { name: 'my-component', key: 'comp-key' };
      ChromeTest.setEvalToReturn([{ result: componentInfo }]);

      const result = await debugHost.refreshSelectedComponent();

      expect(result).toEqual(componentInfo);
    });

    it('returns null when chrome is not available', async () => {
      ChromeTest.removeChrome();
      debugHost.consumer = mockConsumer;
      debugHost.watchingComponentKey = 'comp-key';

      const result = await debugHost.refreshSelectedComponent();

      expect(result).toBeNull();
      ChromeTest.restoreChrome();
    });
  });

  describe('checkComponentTreeChanges', () => {
    it('returns true when tree signature changes', async () => {
      debugHost.consumer = mockConsumer;
      debugHost.componentTreeSignature = 'old-signature';

      ChromeTest.setEvalToReturn([{ result: 'new-signature' }]);

      const result = await debugHost.checkComponentTreeChanges();

      expect(result).toBe(true);
      expect(debugHost.componentTreeSignature).toBe('new-signature');
    });

    it('returns false when tree signature unchanged', async () => {
      debugHost.consumer = mockConsumer;
      debugHost.componentTreeSignature = 'same-signature';

      ChromeTest.setEvalToReturn([{ result: 'same-signature' }]);

      const result = await debugHost.checkComponentTreeChanges();

      expect(result).toBe(false);
    });

    it('returns false when chrome is not available', async () => {
      ChromeTest.removeChrome();
      debugHost.consumer = mockConsumer;

      const result = await debugHost.checkComponentTreeChanges();

      expect(result).toBe(false);
      ChromeTest.restoreChrome();
    });
  });

  describe('valuesEqual', () => {
    it('returns true for identical primitives', () => {
      expect(debugHost.valuesEqual(1, 1)).toBe(true);
      expect(debugHost.valuesEqual('a', 'a')).toBe(true);
      expect(debugHost.valuesEqual(true, true)).toBe(true);
    });

    it('returns false for different primitives', () => {
      expect(debugHost.valuesEqual(1, 2)).toBe(false);
      expect(debugHost.valuesEqual('a', 'b')).toBe(false);
    });

    it('returns false for different types', () => {
      expect(debugHost.valuesEqual(1, '1')).toBe(false);
      expect(debugHost.valuesEqual(null, undefined)).toBe(false);
    });

    it('returns true for equal objects', () => {
      expect(debugHost.valuesEqual({ a: 1 }, { a: 1 })).toBe(true);
    });

    it('returns false for different objects', () => {
      expect(debugHost.valuesEqual({ a: 1 }, { a: 2 })).toBe(false);
    });

    it('handles null values', () => {
      expect(debugHost.valuesEqual(null, null)).toBe(true);
      expect(debugHost.valuesEqual(null, {})).toBe(false);
    });
  });

  describe('diffPropertySnapshots', () => {
    it('detects new properties', () => {
      const oldSnapshot = {
        componentKey: 'comp',
        bindables: [],
        properties: [],
        timestamp: 1,
      };
      const newSnapshot = {
        componentKey: 'comp',
        bindables: [{ name: 'newProp', value: 1, type: 'number' }],
        properties: [],
        timestamp: 2,
      };

      const changes = debugHost.diffPropertySnapshots(oldSnapshot, newSnapshot);

      expect(changes).toHaveLength(1);
      expect(changes[0].propertyName).toBe('newProp');
      expect(changes[0].oldValue).toBeUndefined();
      expect(changes[0].newValue).toBe(1);
    });

    it('detects changed properties in both bindables and properties', () => {
      const oldSnapshot = {
        componentKey: 'comp',
        bindables: [{ name: 'a', value: 1, type: 'number' }],
        properties: [{ name: 'b', value: 'old', type: 'string' }],
        timestamp: 1,
      };
      const newSnapshot = {
        componentKey: 'comp',
        bindables: [{ name: 'a', value: 2, type: 'number' }],
        properties: [{ name: 'b', value: 'new', type: 'string' }],
        timestamp: 2,
      };

      const changes = debugHost.diffPropertySnapshots(oldSnapshot, newSnapshot);

      expect(changes).toHaveLength(2);
      expect(changes.map(c => c.propertyName)).toContain('a');
      expect(changes.map(c => c.propertyName)).toContain('b');
    });
  });
});

describe('SelectionChanged class', () => {
  it('stores debugInfo in constructor', async () => {
    const mod = await import('@/backend/debug-host');
    const debugInfo = { name: 'component', key: 'comp-key' };

    const event = new mod.SelectionChanged(debugInfo as any);

    expect(event.debugInfo).toBe(debugInfo);
  });
});
