export const nextTick = () => new Promise(res => setTimeout(res, 0));

export function stubPlatform() {
  return {
    queueMicrotask: (cb: Function) => setTimeout(cb as any, 0)
  } as any;
}

export function stubDebugHost(overrides: Partial<Record<string, any>> = {}) {
  return {
    getAllComponents: jest.fn().mockResolvedValue({ tree: [], flat: [] }),
    getExternalPanelsSnapshot: jest.fn().mockResolvedValue({ version: 0, panels: [] }),
    emitExternalPanelEvent: jest.fn().mockResolvedValue(true),
    updateValues: jest.fn(),
    highlightComponent: jest.fn(),
    unhighlightComponent: jest.fn(),
    startElementPicker: jest.fn(),
    stopElementPicker: jest.fn(),
    ...overrides
  };
}
