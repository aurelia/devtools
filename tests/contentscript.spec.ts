import './setup';

describe('contentscript utilities', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // Clean globals that may influence detection
    // @ts-ignore
    delete (window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__;
    // @ts-ignore
    delete (window as any).__AURELIA_DEVTOOLS_VERSION__;
  });

  it('detectAureliaVersion returns 1 for v1 hints', async () => {
    const mod = await import('@/contentscript/contentscript.ts');
    document.body.innerHTML = '<div aurelia-app></div>';
    const detect = (mod as any).detectAureliaVersion as Function;
    expect(typeof detect).toBe('function');
    expect(detect()).toBe(1);
  });

  it('detectAureliaVersion returns 2 for v2 hints', async () => {
    const mod = await import('@/contentscript/contentscript.ts');
    document.body.innerHTML = '<div au-started></div>';
    const detect = (mod as any).detectAureliaVersion as Function;
    expect(typeof detect).toBe('function');
    expect(detect()).toBe(2);
  });

  it('getAureliaV2Instance finds $aurelia', async () => {
    const { getAureliaV2Instance } = await import('@/contentscript/contentscript.ts');
    const el = document.createElement('div') as any;
    (el as any).$aurelia = { id: 'au2' };
    document.body.appendChild(el);
    expect(getAureliaV2Instance()).toEqual({ id: 'au2' });
  });

  it('getAureliaV1Instance finds .au.controller', async () => {
    const { getAureliaV1Instance } = await import('@/contentscript/contentscript.ts');
    const el = document.createElement('div') as any;
    (el as any).au = { controller: { id: 'ctrl1' } };
    document.body.appendChild(el);
    expect(getAureliaV1Instance()).toEqual({ id: 'ctrl1' });
  });

  it('getAureliaInstance respects detected version and falls back', async () => {
    const { getAureliaInstance } = await import('@/contentscript/contentscript.ts');

    // Prefer v2 when globals indicate
    (window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__ = 2;
    const v2el = document.createElement('div') as any;
    (v2el as any).$aurelia = { id: 'au2pref' };
    document.body.appendChild(v2el);
    expect(getAureliaInstance(window)).toEqual({ id: 'au2pref' });

    // Prefer v1 when version=1
    (window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__ = 1;
    const v1el = document.createElement('div') as any;
    (v1el as any).au = { controller: { id: 'ctrlpref' } };
    document.body.appendChild(v1el);
    expect(getAureliaInstance(window)).toEqual({ id: 'ctrlpref' });
  });
});
