import './setup';
import { ChromeTest } from './setup';
import { DebugHost } from '@/backend/debug-host';

class ConsumerStub {
  followChromeSelection = false;
  onElementPicked = jest.fn();
  handleComponentSnapshot = jest.fn();
  componentSnapshot = { tree: [], flat: [] };
}

describe('DebugHost additional behaviors', () => {
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
    jest.useRealTimers();
  });

  it('respects followChromeSelection=false and does not eval on selection change', () => {
    ChromeTest.triggerSelectionChanged();
    expect(chrome.devtools.inspectedWindow.eval).not.toHaveBeenCalled();
  });

  it('element picker start/stop triggers eval and polling is stopped after stop', () => {
    const evalMock = chrome.devtools.inspectedWindow.eval as jest.Mock;
    expect(evalMock).not.toHaveBeenCalled();

    host.startElementPicker();
    // Picker code is injected immediately once
    expect(evalMock).toHaveBeenCalled();
    const callsAfterStart = evalMock.mock.calls.length;

    // Polling will call eval periodically to check for picked component
    jest.advanceTimersByTime(350);
    const callsDuringPolling = evalMock.mock.calls.length;
    expect(callsDuringPolling).toBeGreaterThan(callsAfterStart);

    host.stopElementPicker();
    const callsAfterStop = evalMock.mock.calls.length;
    // Further timer advances should not increase call count
    jest.advanceTimersByTime(300);
    expect(evalMock.mock.calls.length).toBe(callsAfterStop);
  });

  it('picks a component via single poll and calls consumer.onElementPicked', () => {
    // Make eval return a picked component when checkForPickedComponent runs
    ChromeTest.setEvalImplementation((expr: string, cb?: (r: any) => void) => {
      if (expr && expr.includes('__AURELIA_DEVTOOLS_PICKED_COMPONENT__')) {
        cb && cb({ customElementInfo: { name: 'picked', key: 'picked', bindables: [], properties: [], aliases: [] }, customAttributesInfo: [] });
      }
    });

    // Directly invoke poller once
    (host as any).checkForPickedComponent();
    expect(consumer.onElementPicked).toHaveBeenCalled();
  });

  it('getInteractionLog proxies through inspectedWindow', async () => {
    const log = [{ id: 'evt-1', eventName: 'click' }];
    ChromeTest.setEvalToReturn([{ result: log }]);

    const result = await host.getInteractionLog();

    expect(result).toEqual(log);
    const evalArg = (chrome.devtools.inspectedWindow.eval as jest.Mock).mock.calls.pop()?.[0];
    expect(evalArg).toContain('getInteractionLog');
  });

  it('replayInteraction delegates to hook', async () => {
    ChromeTest.setEvalToReturn([{ result: true }]);

    const ok = await host.replayInteraction('evt-1');

    expect(ok).toBe(true);
    const evalArg = (chrome.devtools.inspectedWindow.eval as jest.Mock).mock.calls.pop()?.[0];
    expect(evalArg).toContain('replayInteraction');
    expect(evalArg).toContain('evt-1');
  });

  it('applyInteractionSnapshot forwards phase', async () => {
    ChromeTest.setEvalToReturn([{ result: true }]);

    const ok = await host.applyInteractionSnapshot('evt-2', 'after');

    expect(ok).toBe(true);
    const evalArg = (chrome.devtools.inspectedWindow.eval as jest.Mock).mock.calls.pop()?.[0];
    expect(evalArg).toContain('applyInteractionSnapshot');
    expect(evalArg).toContain('after');
  });

  it('clearInteractionLog calls hook clear', async () => {
    ChromeTest.setEvalToReturn([{ result: true }]);

    const ok = await host.clearInteractionLog();

    expect(ok).toBe(true);
    const evalArg = (chrome.devtools.inspectedWindow.eval as jest.Mock).mock.calls.pop()?.[0];
    expect(evalArg).toContain('clearInteractionLog');
  });
});
