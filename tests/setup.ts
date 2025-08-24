/* globals, mocks, and helpers for Jest */

declare global {
  // eslint-disable-next-line no-var
  var chrome: any;
}

/** Simple event hub for chrome.* style addListener APIs */
type Listener = (...args: any[]) => void;
const mkEvent = () => {
  const listeners: Listener[] = [];
  return {
    addListener: (fn: Listener) => listeners.push(fn),
    removeListener: (fn: Listener) => {
      const i = listeners.indexOf(fn);
      if (i > -1) listeners.splice(i, 1);
    },
    hasListeners: () => listeners.length > 0,
    _trigger: (...args: any[]) => listeners.forEach(l => l(...args)),
    _clear: () => listeners.splice(0, listeners.length)
  } as any;
};

const onMessage = mkEvent();
const onSelectionChanged = mkEvent();
const onNavigated = mkEvent();

const inspectedWindowEval = jest.fn();

/** Global chrome mock */
// @ts-ignore
global.chrome = {
  runtime: {
    onMessage,
    sendMessage: jest.fn(),
    connect: jest.fn(() => ({ postMessage: jest.fn(), onMessage: mkEvent(), disconnect: jest.fn() }))
  },
  devtools: {
    inspectedWindow: {
      eval: inspectedWindowEval
    },
    panels: {
      elements: {
        onSelectionChanged
      },
      create: jest.fn(),
      themeName: 'dark'
    },
    network: {
      onNavigated
    }
  },
  action: {
    setIcon: jest.fn(),
    setTitle: jest.fn(),
    setPopup: jest.fn()
  }
};

/** Utilities to interact with mocks in tests */
export const ChromeTest = {
  triggerRuntimeMessage: (message: any, sender: any = {}, sendResponse: any = () => {}) => {
    onMessage._trigger(message, sender, sendResponse);
  },
  triggerSelectionChanged: () => onSelectionChanged._trigger(),
  triggerNavigated: (url: string = 'http://localhost/') => onNavigated._trigger(url),
  setEvalImplementation: (impl: (expression: string, callback: (result: any, exception?: any) => void) => void) => {
    (global as any).chrome.devtools.inspectedWindow.eval.mockImplementation(impl);
  },
  setEvalToReturn: (values: { result?: any; exception?: any }[]) => {
    // Queue multiple sequential behaviors; each call shifts one behavior
    const queue = values.slice();
    (global as any).chrome.devtools.inspectedWindow.eval.mockImplementation((_expr: string, cb: Function) => {
      const next = queue.length ? queue.shift()! : { result: undefined, exception: undefined };
      cb(next.result, next.exception);
    });
  },
  reset: () => {
    jest.clearAllMocks();
    onMessage._clear();
    onSelectionChanged._clear();
    onNavigated._clear();
    (global as any).chrome.devtools.inspectedWindow.eval.mockReset();
  },
  removeChrome: () => {
    // simulate absence of chrome APIs
    // @ts-expect-error
    delete (global as any).chrome;
  },
  restoreChrome: () => {
    // no-op for this simple mutable mock
  }
};
