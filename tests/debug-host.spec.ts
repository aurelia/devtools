import './setup';
import { ChromeTest } from './setup';
import { DebugHost } from '@/backend/debug-host';

/** Minimal App consumer stub */
class AppConsumerStub {
  componentSnapshot = { tree: [], flat: [] };
  handleComponentSnapshot = jest.fn((snapshot) => {
    this.componentSnapshot = snapshot;
  });
  onElementPicked = jest.fn();
}

describe('DebugHost', () => {
  let host: DebugHost;
  let consumer: AppConsumerStub;

  beforeEach(() => {
    ChromeTest.reset();
    consumer = new AppConsumerStub();
    host = new DebugHost();
    // attach will set up listeners and schedule initial load, but we can ignore timers here
    // @ts-ignore
    host.attach(consumer as any);
  });

  it('getAllComponents falls back when initial eval returns empty twice', async () => {
    const fallback = [{ customElementInfo: { name: 'x', key: 'k', bindables: [], properties: [], aliases: [] }, customAttributesInfo: [] }];
    ChromeTest.setEvalToReturn([
      { result: [] },
      { result: { kind: 'flat', data: [] } },
      { result: { kind: 'flat', data: fallback } },
    ]);

    const result = await host.getAllComponents();
    expect(result).toEqual({ tree: [], flat: fallback });
  });

  it('getAllComponents returns immediate non-empty result', async () => {
    const first = [{
      id: 'root',
      domPath: 'html > body > root:nth-of-type(1)',
      tagName: 'app-root',
      customElementInfo: { name: 'app-root', key: 'app-root', bindables: [], properties: [], aliases: [] },
      customAttributesInfo: [],
      children: [],
    }];
    ChromeTest.setEvalToReturn([{ result: { kind: 'tree', data: first } }]);

    const result = await host.getAllComponents();
    expect(result).toEqual({ tree: first, flat: [] });
  });

  it('highlightComponent/unhighlightComponent call inspectedWindow.eval with injected code', () => {
    host.highlightComponent({ name: 'Comp' });
    expect(chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();
    const code = (chrome.devtools.inspectedWindow.eval as jest.Mock).mock.calls[0][0];
    expect(code).toContain('aurelia-devtools-highlight');

    (chrome.devtools.inspectedWindow.eval as jest.Mock).mockClear();
    host.unhighlightComponent();
    expect(chrome.devtools.inspectedWindow.eval).toHaveBeenCalled();
    const code2 = (chrome.devtools.inspectedWindow.eval as jest.Mock).mock.calls[0][0];
    expect(code2).toContain("querySelectorAll('.aurelia-devtools-highlight')");
  });
});
