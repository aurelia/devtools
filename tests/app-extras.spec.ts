import './setup';
import { ChromeTest } from './setup';
import { stubDebugHost, stubPlatform } from './helpers';

describe('App extra behaviors', () => {
  let app: any;
  let AppClass: any;
  let debugHost: any;
  let plat: any;

  beforeEach(async () => {
    jest.useFakeTimers();
    ChromeTest.reset();
    jest.resetModules();
    const mod = await import('@/app');
    AppClass = mod.App;
    app = Object.create(AppClass.prototype);
    // seed minimal state
    app.activeTab = 'all';
    app.tabs = [];
    app.selectedElement = undefined;
    app.selectedElementAttributes = undefined;
    app.allAureliaObjects = undefined;
    app.componentTree = [];
    app.filteredComponentTree = [];
    app.selectedComponentId = undefined;
    app.searchQuery = '';
    app.isElementPickerActive = false;
    app.aureliaDetected = false;
    app.aureliaVersion = null;
    app.detectionState = 'checking';

    debugHost = stubDebugHost({ revealInElements: jest.fn() });
    plat = stubPlatform();
    app.debugHost = debugHost;
    app.plat = plat;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('toggleElementPicker starts and stops picker via debugHost', () => {
    expect(app.isElementPickerActive).toBe(false);
    app.toggleElementPicker();
    expect(app.isElementPickerActive).toBe(true);
    expect(debugHost.startElementPicker).toHaveBeenCalled();

    app.toggleElementPicker();
    expect(app.isElementPickerActive).toBe(false);
    expect(debugHost.stopElementPicker).toHaveBeenCalled();
  });

  it('toggleFollowChromeSelection persists to localStorage', () => {
    const setItem = jest.spyOn(window.localStorage.__proto__, 'setItem');
    const initial = app.followChromeSelection;
    app.toggleFollowChromeSelection();
    expect(app.followChromeSelection).toBe(!initial);
    expect(setItem).toHaveBeenCalledWith('au-devtools.followChromeSelection', String(!initial));
    setItem.mockRestore();
  });

  it('valueChanged schedules updateValues microtask', () => {
    const el = { name: 'x' } as any;
    app.valueChanged(el);
    jest.runOnlyPendingTimers();
    expect(debugHost.updateValues).toHaveBeenCalledWith(el);
  });

  it('revealInElements calls debugHost.revealInElements with selected component info', () => {
    // Create minimal tree
    const node = {
      id: 'n1', name: 'comp', type: 'custom-element', children: [], expanded: false,
      data: { customElementInfo: { key: 'k' }, customAttributesInfo: [] }
    };
    app.componentTree = [node];
    app.selectedComponentId = 'n1';

    app.revealInElements();
    expect(debugHost.revealInElements).toHaveBeenCalledWith(expect.objectContaining({ name: 'comp', type: 'custom-element' }));
  });
});
