import './setup';
import { hasDevtoolsOptedOut, applyDevtoolsOptOutState } from '@/shared/devtools-optout';

describe('devtools-optout', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('data-aurelia-devtools');
    delete (window as any).__AURELIA_DEVTOOLS_DISABLED__;
    delete (window as any).__AURELIA_DEVTOOLS_DISABLE__;
    delete (window as any).AURELIA_DEVTOOLS_DISABLE;
    delete (window as any).__AURELIA_DEVTOOLS_DETECTION_STATE__;
    delete (window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__;
    delete (window as any).__AURELIA_DEVTOOLS_VERSION__;
  });

  describe('hasDevtoolsOptedOut', () => {
    describe('global key detection', () => {
      it('returns true when __AURELIA_DEVTOOLS_DISABLED__ is true', () => {
        (window as any).__AURELIA_DEVTOOLS_DISABLED__ = true;
        expect(hasDevtoolsOptedOut(window)).toBe(true);
      });

      it('returns true when __AURELIA_DEVTOOLS_DISABLE__ is true', () => {
        (window as any).__AURELIA_DEVTOOLS_DISABLE__ = true;
        expect(hasDevtoolsOptedOut(window)).toBe(true);
      });

      it('returns true when AURELIA_DEVTOOLS_DISABLE is true', () => {
        (window as any).AURELIA_DEVTOOLS_DISABLE = true;
        expect(hasDevtoolsOptedOut(window)).toBe(true);
      });

      it('returns false when global key is not true', () => {
        (window as any).__AURELIA_DEVTOOLS_DISABLED__ = false;
        expect(hasDevtoolsOptedOut(window)).toBe(false);
      });

      it('returns false when global key is a string', () => {
        (window as any).__AURELIA_DEVTOOLS_DISABLED__ = 'true';
        expect(hasDevtoolsOptedOut(window)).toBe(false);
      });
    });

    describe('meta tag detection', () => {
      it('returns true when meta content includes disable', () => {
        const meta = document.createElement('meta');
        meta.setAttribute('name', 'aurelia-devtools');
        meta.setAttribute('content', 'disable');
        document.head.appendChild(meta);

        expect(hasDevtoolsOptedOut(window)).toBe(true);
      });

      it('returns true when meta content includes disabled', () => {
        const meta = document.createElement('meta');
        meta.setAttribute('name', 'aurelia-devtools');
        meta.setAttribute('content', 'disabled');
        document.head.appendChild(meta);

        expect(hasDevtoolsOptedOut(window)).toBe(true);
      });

      it('returns true when meta content includes off', () => {
        const meta = document.createElement('meta');
        meta.setAttribute('name', 'aurelia-devtools');
        meta.setAttribute('content', 'off');
        document.head.appendChild(meta);

        expect(hasDevtoolsOptedOut(window)).toBe(true);
      });

      it('returns true when meta content includes disable in mixed case', () => {
        const meta = document.createElement('meta');
        meta.setAttribute('name', 'aurelia-devtools');
        meta.setAttribute('content', 'DISABLE');
        document.head.appendChild(meta);

        expect(hasDevtoolsOptedOut(window)).toBe(true);
      });

      it('returns false when meta has other content', () => {
        const meta = document.createElement('meta');
        meta.setAttribute('name', 'aurelia-devtools');
        meta.setAttribute('content', 'enabled');
        document.head.appendChild(meta);

        expect(hasDevtoolsOptedOut(window)).toBe(false);
      });

      it('returns false when meta has no content', () => {
        const meta = document.createElement('meta');
        meta.setAttribute('name', 'aurelia-devtools');
        document.head.appendChild(meta);

        expect(hasDevtoolsOptedOut(window)).toBe(false);
      });
    });

    describe('root attribute detection', () => {
      it('returns true when data-aurelia-devtools is disable', () => {
        document.documentElement.setAttribute('data-aurelia-devtools', 'disable');
        expect(hasDevtoolsOptedOut(window)).toBe(true);
      });

      it('returns true when data-aurelia-devtools is disabled', () => {
        document.documentElement.setAttribute('data-aurelia-devtools', 'disabled');
        expect(hasDevtoolsOptedOut(window)).toBe(true);
      });

      it('returns true when data-aurelia-devtools is off', () => {
        document.documentElement.setAttribute('data-aurelia-devtools', 'off');
        expect(hasDevtoolsOptedOut(window)).toBe(true);
      });

      it('returns true when data-aurelia-devtools is OFF (case insensitive)', () => {
        document.documentElement.setAttribute('data-aurelia-devtools', 'OFF');
        expect(hasDevtoolsOptedOut(window)).toBe(true);
      });

      it('returns false when data-aurelia-devtools is enabled', () => {
        document.documentElement.setAttribute('data-aurelia-devtools', 'enabled');
        expect(hasDevtoolsOptedOut(window)).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('returns false when window is undefined', () => {
        expect(hasDevtoolsOptedOut(undefined)).toBe(false);
      });

      it('returns false when window is null', () => {
        expect(hasDevtoolsOptedOut(null)).toBe(false);
      });

      it('returns false when window has no document', () => {
        const mockWin = { document: undefined };
        expect(hasDevtoolsOptedOut(mockWin)).toBe(false);
      });

      it('returns false when documentElement is undefined', () => {
        const mockWin = { document: { querySelector: () => null, documentElement: undefined } };
        expect(hasDevtoolsOptedOut(mockWin)).toBe(false);
      });

      it('returns false when exception is thrown', () => {
        const badWin = {
          get document() {
            throw new Error('Access denied');
          }
        };
        expect(hasDevtoolsOptedOut(badWin)).toBe(false);
      });

      it('returns false when no opt-out methods are used', () => {
        expect(hasDevtoolsOptedOut(window)).toBe(false);
      });

      it('uses default window when no argument provided', () => {
        expect(hasDevtoolsOptedOut()).toBe(false);
      });
    });
  });

  describe('applyDevtoolsOptOutState', () => {
    it('sets detection state globals when opted out', () => {
      (window as any).__AURELIA_DEVTOOLS_DISABLED__ = true;

      const result = applyDevtoolsOptOutState(window);

      expect(result).toBe(true);
      expect((window as any).__AURELIA_DEVTOOLS_DETECTION_STATE__).toBe('disabled');
      expect((window as any).__AURELIA_DEVTOOLS_DETECTED_VERSION__).toBeNull();
      expect((window as any).__AURELIA_DEVTOOLS_VERSION__).toBeNull();
    });

    it('does not set globals when not opted out', () => {
      const result = applyDevtoolsOptOutState(window);

      expect(result).toBe(false);
      expect((window as any).__AURELIA_DEVTOOLS_DETECTION_STATE__).toBeUndefined();
    });

    it('returns false for undefined window', () => {
      const result = applyDevtoolsOptOutState(undefined);
      expect(result).toBe(false);
    });

    it('handles exception when setting globals', () => {
      const frozenWin = Object.freeze({
        __AURELIA_DEVTOOLS_DISABLED__: true,
        document: {
          querySelector: () => null,
          documentElement: { getAttribute: () => null }
        }
      });

      const result = applyDevtoolsOptOutState(frozenWin);
      expect(result).toBe(true);
    });

    it('uses default window when no argument provided', () => {
      const result = applyDevtoolsOptOutState();
      expect(result).toBe(false);
    });
  });
});
