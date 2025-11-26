import './setup';
import { ChromeTest } from './setup';

describe('detector.ts', () => {
  beforeEach(() => {
    ChromeTest.reset();
    document.body.innerHTML = '';
    // Clear globals set by detector
    // @ts-ignore
    delete (window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__;
    // @ts-ignore
    delete (window as any).__AURELIA_DEVTOOLS_VERSION__;
    // @ts-ignore
    delete (window as any).__AURELIA_DEVTOOLS_DETECTION_STATE__;
    // @ts-ignore
    delete (window as any).__AURELIA_DEVTOOLS_DISABLED__;
    // @ts-ignore
    delete (window as any).__AURELIA_DEVTOOLS_DISABLE__;
    // @ts-ignore
    delete (window as any).AURELIA_DEVTOOLS_DISABLE;
  });

  async function importFresh() {
    jest.resetModules();
    await import('@/detector/detector.ts');
  }

  it('sets version 1 on aurelia-composed', async () => {
    await importFresh();
    window.dispatchEvent(new Event('aurelia-composed'));
    expect((window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__).toBe(1);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ aureliaDetected: true, version: 1 });
  });

  it('sets version 2 on au-started', async () => {
    await importFresh();
    window.dispatchEvent(new Event('au-started'));
    expect((window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__).toBe(2);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ aureliaDetected: true, version: 2 });
  });

  it('probeAfterLoad detects v1 via DOM', async () => {
    document.body.innerHTML = '<div aurelia-app></div>';
    await importFresh();
    // Let setTimeout(0) in detector run
    await new Promise(r => setTimeout(r, 1));
    expect((window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__).toBe(1);
  });

  it('probeAfterLoad detects v2 via DOM', async () => {
    document.body.innerHTML = '<div au-started></div>';
    await importFresh();
    await new Promise(r => setTimeout(r, 1));
    expect((window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__).toBe(2);
  });

  it('deep scan detects v2 via $au', async () => {
    const el = document.createElement('div') as any;
    (el as any).$au = { 'au:resource:custom-element': {} };
    document.body.appendChild(el);
    await importFresh();
    await new Promise(r => setTimeout(r, 1));
    expect((window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__).toBe(2);
  });

  it('deep scan detects v1 via .au controller', async () => {
    const el = document.createElement('div') as any;
    (el as any).au = { controller: { behavior: {} } };
    document.body.appendChild(el);
    await importFresh();
    await new Promise(r => setTimeout(r, 1));
    expect((window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__).toBe(1);
  });

  it('honors global opt-out flag', async () => {
    (window as any).__AURELIA_DEVTOOLS_DISABLED__ = true;
    await importFresh();
    window.dispatchEvent(new Event('au-started'));
    await new Promise(r => setTimeout(r, 1));
    expect((window as any).__AURELIA_DEVTOOLS_DETECTION_STATE__).toBe('disabled');
    expect((window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__).toBeNull();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('does not throw when chrome is missing', async () => {
    ChromeTest.removeChrome();
    await expect(importFresh()).resolves.toBeUndefined();
    // Trigger event
    expect(() => window.dispatchEvent(new Event('au-started'))).not.toThrow();
  });
});
