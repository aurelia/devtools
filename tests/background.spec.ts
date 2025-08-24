import './setup';
import { ChromeTest } from './setup';

describe('background action updates', () => {
  beforeEach(async () => {
    ChromeTest.reset();
    jest.resetModules();
    await import('@/background/background.ts');
  });

  it('updates icon/title/popup when aurelia is detected (v2)', () => {
    ChromeTest.triggerRuntimeMessage(
      { aureliaDetected: true, version: 2 },
      { tab: { id: 42 } }
    );

    expect(chrome.action.setIcon).toHaveBeenCalledWith({
      tabId: 42,
      path: { 16: '../images/16.png', 48: '../images/48.png', 128: '../images/128.png' }
    });
    expect(chrome.action.setTitle).toHaveBeenCalledWith({ title: 'Aurelia 2 Devtools', tabId: 42 });
    expect(chrome.action.setPopup).toHaveBeenCalledWith({ tabId: 42, popup: 'popups/enabled-v2.html' });
  });

  it('does nothing when no sender.tab or not detected', () => {
    ChromeTest.triggerRuntimeMessage({ aureliaDetected: false, version: 2 }, {});
    expect(chrome.action.setIcon).not.toHaveBeenCalled();
    expect(chrome.action.setPopup).not.toHaveBeenCalled();
  });
});
