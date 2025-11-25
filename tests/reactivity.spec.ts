import './setup';
import { ChromeTest } from './setup';
import { DebugHost } from '@/backend/debug-host';
import { PropertyChangeRecord, PropertySnapshot } from '@/shared/types';

class ConsumerStub {
  followChromeSelection = false;
  onElementPicked = jest.fn();
  handleComponentSnapshot = jest.fn();
  onPropertyChanges = jest.fn();
  componentSnapshot = { tree: [], flat: [] };
}

describe('DebugHost property watching', () => {
  let host: DebugHost;
  let consumer: ConsumerStub;

  beforeEach(() => {
    ChromeTest.reset();
    consumer = new ConsumerStub();
    host = new DebugHost();
    // @ts-ignore
    host.attach(consumer as any);
    jest.useFakeTimers();
  });

  afterEach(() => {
    host.stopPropertyWatching();
    jest.useRealTimers();
  });

  describe('startPropertyWatching', () => {
    it('should start polling for property changes', () => {
      const evalMock = chrome.devtools.inspectedWindow.eval as jest.Mock;
      evalMock.mockClear();

      host.startPropertyWatching({ componentKey: 'test-component' });

      // Initial snapshot fetch
      expect(evalMock).toHaveBeenCalled();

      // Advance timer to trigger polling
      jest.advanceTimersByTime(600);
      expect(evalMock.mock.calls.length).toBeGreaterThan(1);
    });

    it('should stop previous watcher when starting new one', () => {
      host.startPropertyWatching({ componentKey: 'component-1' });
      const intervalsBefore = jest.getTimerCount();

      host.startPropertyWatching({ componentKey: 'component-2' });

      // Should not have more intervals than before
      expect(jest.getTimerCount()).toBeLessThanOrEqual(intervalsBefore);
    });

    it('should respect custom poll interval', () => {
      const evalMock = chrome.devtools.inspectedWindow.eval as jest.Mock;
      evalMock.mockClear();

      host.startPropertyWatching({ componentKey: 'test', pollInterval: 1000 });

      // Initial call
      const initialCalls = evalMock.mock.calls.length;

      // Advance less than poll interval
      jest.advanceTimersByTime(500);
      expect(evalMock.mock.calls.length).toBe(initialCalls);

      // Advance past poll interval
      jest.advanceTimersByTime(600);
      expect(evalMock.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  describe('stopPropertyWatching', () => {
    it('should stop polling when called', () => {
      const evalMock = chrome.devtools.inspectedWindow.eval as jest.Mock;

      host.startPropertyWatching({ componentKey: 'test' });
      evalMock.mockClear();

      host.stopPropertyWatching();

      jest.advanceTimersByTime(2000);
      expect(evalMock).not.toHaveBeenCalled();
    });

    it('should clear internal state', () => {
      host.startPropertyWatching({ componentKey: 'test' });
      host.stopPropertyWatching();

      expect((host as any).watchingComponentKey).toBeNull();
      expect((host as any).lastPropertySnapshot).toBeNull();
    });
  });

  describe('property change detection', () => {
    it('should detect and report property changes via direct call', () => {
      // Test diffPropertySnapshots directly since polling involves promises
      const oldSnapshot: PropertySnapshot = {
        componentKey: 'test',
        bindables: [{ name: 'value', value: 'old', type: 'string' }],
        properties: [],
        timestamp: 1000,
      };

      const newSnapshot: PropertySnapshot = {
        componentKey: 'test',
        bindables: [{ name: 'value', value: 'new', type: 'string' }],
        properties: [],
        timestamp: 2000,
      };

      // Set up the internal state manually
      (host as any).lastPropertySnapshot = oldSnapshot;
      (host as any).watchingComponentKey = 'test';

      // Call diffPropertySnapshots directly
      const changes = (host as any).diffPropertySnapshots(oldSnapshot, newSnapshot);

      expect(changes).toHaveLength(1);
      expect(changes[0].propertyName).toBe('value');
      expect(changes[0].oldValue).toBe('old');
      expect(changes[0].newValue).toBe('new');
    });

    it('should not report when values are unchanged', () => {
      const snapshot: PropertySnapshot = {
        componentKey: 'test',
        bindables: [{ name: 'value', value: 'same', type: 'string' }],
        properties: [],
        timestamp: 1000,
      };

      const sameSnapshot: PropertySnapshot = {
        componentKey: 'test',
        bindables: [{ name: 'value', value: 'same', type: 'string' }],
        properties: [],
        timestamp: 2000,
      };

      const changes = (host as any).diffPropertySnapshots(snapshot, sameSnapshot);
      expect(changes).toHaveLength(0);
    });

    it('should detect changes in both bindables and properties', () => {
      const oldSnapshot: PropertySnapshot = {
        componentKey: 'test',
        bindables: [{ name: 'bindable1', value: 'a', type: 'string' }],
        properties: [{ name: 'prop1', value: 1, type: 'number' }],
        timestamp: 1000,
      };

      const newSnapshot: PropertySnapshot = {
        componentKey: 'test',
        bindables: [{ name: 'bindable1', value: 'b', type: 'string' }],
        properties: [{ name: 'prop1', value: 2, type: 'number' }],
        timestamp: 2000,
      };

      const changes = (host as any).diffPropertySnapshots(oldSnapshot, newSnapshot);
      expect(changes).toHaveLength(2);
      expect(changes.find((c: PropertyChangeRecord) => c.propertyType === 'bindable')).toBeDefined();
      expect(changes.find((c: PropertyChangeRecord) => c.propertyType === 'property')).toBeDefined();
    });

    it('should return changes with correct component key and timestamp', () => {
      const oldSnapshot: PropertySnapshot = {
        componentKey: 'my-comp',
        bindables: [],
        properties: [{ name: 'count', value: 10, type: 'number' }],
        timestamp: 1000,
      };

      const newSnapshot: PropertySnapshot = {
        componentKey: 'my-comp',
        bindables: [],
        properties: [{ name: 'count', value: 20, type: 'number' }],
        timestamp: 2000,
      };

      const changes = (host as any).diffPropertySnapshots(oldSnapshot, newSnapshot);

      expect(changes).toHaveLength(1);
      expect(changes[0].componentKey).toBe('my-comp');
      expect(changes[0].timestamp).toBe(2000);
    });
  });

  describe('getPropertySnapshot', () => {
    it('should fetch property snapshot via eval', async () => {
      const mockSnapshot: PropertySnapshot = {
        componentKey: 'my-component',
        bindables: [{ name: 'foo', value: 'bar', type: 'string' }],
        properties: [],
        timestamp: Date.now(),
      };

      ChromeTest.setEvalImplementation((expr: string, cb?: (r: any) => void) => {
        if (expr && expr.includes('getComponentByKey')) {
          cb && cb(mockSnapshot);
        }
      });

      const result = await host.getPropertySnapshot('my-component');
      expect(result).toEqual(mockSnapshot);
    });

    it('should return null when hook is not available', async () => {
      ChromeTest.setEvalImplementation((expr: string, cb?: (r: any) => void) => {
        cb && cb(null);
      });

      const result = await host.getPropertySnapshot('missing');
      expect(result).toBeNull();
    });
  });

  describe('checkComponentTreeChanges', () => {
    it('should detect tree structure changes', async () => {
      let signature = 'initial';
      ChromeTest.setEvalImplementation((expr: string, cb?: (r: any) => void) => {
        if (expr && expr.includes('getSignature')) {
          cb && cb(signature);
        }
      });

      // First call - establishes baseline
      const firstResult = await host.checkComponentTreeChanges();
      expect(firstResult).toBe(true); // Changed from empty string

      // Second call - no change
      const secondResult = await host.checkComponentTreeChanges();
      expect(secondResult).toBe(false);

      // Third call - signature changed
      signature = 'changed';
      const thirdResult = await host.checkComponentTreeChanges();
      expect(thirdResult).toBe(true);
    });

    it('should return false when no chrome APIs available', async () => {
      const originalChrome = (global as any).chrome;
      (global as any).chrome = undefined;

      const result = await host.checkComponentTreeChanges();
      expect(result).toBe(false);

      (global as any).chrome = originalChrome;
    });
  });
});

describe('DebugHost value comparison', () => {
  let host: DebugHost;

  beforeEach(() => {
    ChromeTest.reset();
    host = new DebugHost();
  });

  it('should compare primitive values correctly', () => {
    const valuesEqual = (host as any).valuesEqual.bind(host);

    expect(valuesEqual(1, 1)).toBe(true);
    expect(valuesEqual('a', 'a')).toBe(true);
    expect(valuesEqual(true, true)).toBe(true);
    expect(valuesEqual(null, null)).toBe(true);

    expect(valuesEqual(1, 2)).toBe(false);
    expect(valuesEqual('a', 'b')).toBe(false);
    expect(valuesEqual(true, false)).toBe(false);
    expect(valuesEqual(null, undefined)).toBe(false);
  });

  it('should compare objects by JSON serialization', () => {
    const valuesEqual = (host as any).valuesEqual.bind(host);

    expect(valuesEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(valuesEqual([1, 2], [1, 2])).toBe(true);

    expect(valuesEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(valuesEqual([1, 2], [2, 1])).toBe(false);
  });

  it('should handle different types', () => {
    const valuesEqual = (host as any).valuesEqual.bind(host);

    expect(valuesEqual(1, '1')).toBe(false);
    expect(valuesEqual({}, [])).toBe(false);
  });
});

describe('Property snapshot diffing', () => {
  let host: DebugHost;

  beforeEach(() => {
    ChromeTest.reset();
    host = new DebugHost();
  });

  it('should detect added properties', () => {
    const diffSnapshots = (host as any).diffPropertySnapshots.bind(host);

    const oldSnapshot: PropertySnapshot = {
      componentKey: 'test',
      bindables: [],
      properties: [],
      timestamp: 1000,
    };

    const newSnapshot: PropertySnapshot = {
      componentKey: 'test',
      bindables: [{ name: 'newProp', value: 'value', type: 'string' }],
      properties: [],
      timestamp: 2000,
    };

    const changes = diffSnapshots(oldSnapshot, newSnapshot);
    expect(changes).toHaveLength(1);
    expect(changes[0].propertyName).toBe('newProp');
    expect(changes[0].oldValue).toBeUndefined();
    expect(changes[0].newValue).toBe('value');
  });

  it('should detect value changes', () => {
    const diffSnapshots = (host as any).diffPropertySnapshots.bind(host);

    const oldSnapshot: PropertySnapshot = {
      componentKey: 'test',
      bindables: [],
      properties: [{ name: 'count', value: 1, type: 'number' }],
      timestamp: 1000,
    };

    const newSnapshot: PropertySnapshot = {
      componentKey: 'test',
      bindables: [],
      properties: [{ name: 'count', value: 2, type: 'number' }],
      timestamp: 2000,
    };

    const changes = diffSnapshots(oldSnapshot, newSnapshot);
    expect(changes).toHaveLength(1);
    expect(changes[0].propertyName).toBe('count');
    expect(changes[0].oldValue).toBe(1);
    expect(changes[0].newValue).toBe(2);
    expect(changes[0].propertyType).toBe('property');
  });

  it('should return empty array when no changes', () => {
    const diffSnapshots = (host as any).diffPropertySnapshots.bind(host);

    const snapshot: PropertySnapshot = {
      componentKey: 'test',
      bindables: [{ name: 'val', value: 'same', type: 'string' }],
      properties: [],
      timestamp: 1000,
    };

    const changes = diffSnapshots(snapshot, { ...snapshot, timestamp: 2000 });
    expect(changes).toHaveLength(0);
  });
});
