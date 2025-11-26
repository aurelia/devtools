import './setup';

describe('contentscript utilities', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    delete (window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__;
    delete (window as any).__AURELIA_DEVTOOLS_VERSION__;
    delete (window as any).aurelia;
    delete (window as any).Aurelia;
  });

  describe('detectAureliaVersion', () => {
    it('returns 1 for aurelia-app attribute', async () => {
      const mod = await import('@/contentscript/contentscript.ts');
      document.body.innerHTML = '<div aurelia-app></div>';
      expect(mod.detectAureliaVersion()).toBe(1);
    });

    it('returns 1 for window.aurelia global', async () => {
      const mod = await import('@/contentscript/contentscript.ts');
      (window as any).aurelia = { version: '1.0' };
      expect(mod.detectAureliaVersion()).toBe(1);
    });

    it('returns 2 for au-started attribute', async () => {
      const mod = await import('@/contentscript/contentscript.ts');
      document.body.innerHTML = '<div au-started></div>';
      expect(mod.detectAureliaVersion()).toBe(2);
    });

    it('returns 2 for window.Aurelia global', async () => {
      const mod = await import('@/contentscript/contentscript.ts');
      (window as any).Aurelia = { version: '2.0' };
      expect(mod.detectAureliaVersion()).toBe(2);
    });

    it('returns null when no aurelia detected', async () => {
      const mod = await import('@/contentscript/contentscript.ts');
      expect(mod.detectAureliaVersion()).toBeNull();
    });
  });

  describe('getAureliaV2Instance', () => {
    it('finds $aurelia on element', async () => {
      const { getAureliaV2Instance } = await import('@/contentscript/contentscript.ts');
      const el = document.createElement('div') as any;
      el.$aurelia = { id: 'au2' };
      document.body.appendChild(el);
      expect(getAureliaV2Instance()).toEqual({ id: 'au2' });
    });

    it('returns undefined when no $aurelia found', async () => {
      const { getAureliaV2Instance } = await import('@/contentscript/contentscript.ts');
      document.body.innerHTML = '<div></div>';
      expect(getAureliaV2Instance()).toBeUndefined();
    });
  });

  describe('getAureliaV1Instance', () => {
    it('finds .au.controller on element', async () => {
      const { getAureliaV1Instance } = await import('@/contentscript/contentscript.ts');
      const el = document.createElement('div') as any;
      el.au = { controller: { id: 'ctrl1' } };
      document.body.appendChild(el);
      expect(getAureliaV1Instance()).toEqual({ id: 'ctrl1' });
    });

    it('returns window.aurelia fallback when no .au.controller', async () => {
      const { getAureliaV1Instance } = await import('@/contentscript/contentscript.ts');
      (window as any).aurelia = { id: 'global-v1' };
      document.body.innerHTML = '<div></div>';
      expect(getAureliaV1Instance()).toEqual({ id: 'global-v1' });
    });

    it('returns undefined when no .au and no window.aurelia', async () => {
      const { getAureliaV1Instance } = await import('@/contentscript/contentscript.ts');
      document.body.innerHTML = '<div></div>';
      expect(getAureliaV1Instance()).toBeUndefined();
    });

    it('skips elements with .au but no controller', async () => {
      const { getAureliaV1Instance } = await import('@/contentscript/contentscript.ts');
      const el1 = document.createElement('div') as any;
      el1.au = {};
      const el2 = document.createElement('div') as any;
      el2.au = { controller: { id: 'found' } };
      document.body.appendChild(el1);
      document.body.appendChild(el2);
      expect(getAureliaV1Instance()).toEqual({ id: 'found' });
    });
  });

  describe('getAureliaInstance', () => {
    it('uses __AURELIA_DEVTOOLS_DETECTED_VERSION__ for v2', async () => {
      const { getAureliaInstance } = await import('@/contentscript/contentscript.ts');
      (window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__ = 2;
      const el = document.createElement('div') as any;
      el.$aurelia = { id: 'au2pref' };
      document.body.appendChild(el);
      expect(getAureliaInstance(window)).toEqual({ id: 'au2pref' });
    });

    it('uses __AURELIA_DEVTOOLS_DETECTED_VERSION__ for v1', async () => {
      const { getAureliaInstance } = await import('@/contentscript/contentscript.ts');
      (window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__ = 1;
      const el = document.createElement('div') as any;
      el.au = { controller: { id: 'ctrlpref' } };
      document.body.appendChild(el);
      expect(getAureliaInstance(window)).toEqual({ id: 'ctrlpref' });
    });

    it('uses __AURELIA_DEVTOOLS_VERSION__ when DETECTED_VERSION not set', async () => {
      const { getAureliaInstance } = await import('@/contentscript/contentscript.ts');
      (window as any).__AURELIA_DEVTOOLS_VERSION__ = 2;
      const el = document.createElement('div') as any;
      el.$aurelia = { id: 'au2-ver' };
      document.body.appendChild(el);
      expect(getAureliaInstance(window)).toEqual({ id: 'au2-ver' });
    });

    it('falls back to trying both when no version detected', async () => {
      const { getAureliaInstance } = await import('@/contentscript/contentscript.ts');
      const el = document.createElement('div') as any;
      el.$aurelia = { id: 'fallback-v2' };
      document.body.appendChild(el);
      expect(getAureliaInstance(window)).toEqual({ id: 'fallback-v2' });
    });

    it('falls back to v1 when v2 not found', async () => {
      const { getAureliaInstance } = await import('@/contentscript/contentscript.ts');
      const el = document.createElement('div') as any;
      el.au = { controller: { id: 'fallback-v1' } };
      document.body.appendChild(el);
      expect(getAureliaInstance(window)).toEqual({ id: 'fallback-v1' });
    });

    it('returns undefined when neither v1 nor v2 found', async () => {
      const { getAureliaInstance } = await import('@/contentscript/contentscript.ts');
      document.body.innerHTML = '<div></div>';
      expect(getAureliaInstance(window)).toBeUndefined();
    });
  });

  describe('event forwarding', () => {
    it('forwards interaction events to chrome.runtime', async () => {
      await import('@/contentscript/contentscript.ts');
      const sendMessageSpy = chrome.runtime.sendMessage as jest.Mock;
      sendMessageSpy.mockClear();

      const event = new CustomEvent('aurelia-devtools:interaction', {
        detail: { id: 'evt-1', type: 'click' }
      });
      window.dispatchEvent(event);

      expect(sendMessageSpy).toHaveBeenCalledWith({
        type: 'au-devtools:interaction',
        entry: { id: 'evt-1', type: 'click' }
      });
    });

    it('forwards property-change events to chrome.runtime', async () => {
      await import('@/contentscript/contentscript.ts');
      const sendMessageSpy = chrome.runtime.sendMessage as jest.Mock;
      sendMessageSpy.mockClear();

      const event = new CustomEvent('aurelia-devtools:property-change', {
        detail: { changes: [{ prop: 'a' }], snapshot: { ts: 1 } }
      });
      window.dispatchEvent(event);

      expect(sendMessageSpy).toHaveBeenCalledWith({
        type: 'au-devtools:property-change',
        changes: [{ prop: 'a' }],
        snapshot: { ts: 1 }
      });
    });

    it('forwards tree-change events to chrome.runtime', async () => {
      await import('@/contentscript/contentscript.ts');
      const sendMessageSpy = chrome.runtime.sendMessage as jest.Mock;
      sendMessageSpy.mockClear();

      const event = new CustomEvent('aurelia-devtools:tree-change', {
        detail: { tree: [] }
      });
      window.dispatchEvent(event);

      expect(sendMessageSpy).toHaveBeenCalledWith({
        type: 'au-devtools:tree-change',
        detail: { tree: [] }
      });
    });

    it('handles event with undefined detail gracefully', async () => {
      await import('@/contentscript/contentscript.ts');
      const sendMessageSpy = chrome.runtime.sendMessage as jest.Mock;
      sendMessageSpy.mockClear();

      const event = new CustomEvent('aurelia-devtools:interaction');
      window.dispatchEvent(event);

      expect(sendMessageSpy).toHaveBeenCalledWith({
        type: 'au-devtools:interaction',
        entry: null
      });
    });
  });
});
