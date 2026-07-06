import { install } from '@/hook/install';

type Hooks = ReturnType<typeof install>['hooks'];

function makeV2Component(name: string, vmProps: Record<string, unknown>) {
  const el = document.createElement(name);
  const viewModel: any = { ...vmProps };
  const controller: any = {
    definition: { name, key: `au:resource:custom-element:${name}`, bindables: {} },
    viewModel,
    host: el,
  };
  (el as any).$au = { 'au:resource:custom-element': controller };
  document.body.appendChild(el);
  return { el, controller, viewModel };
}

describe('hook instance registry', () => {
  let hooks: Hooks;

  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '';
    hooks = install(undefined as any).hooks;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('stamps a stable instanceId on extracted component info', () => {
    const { el } = makeV2Component('my-item', { label: 'one' });

    const first = hooks.getCustomElementInfo(el, false);
    const second = hooks.getCustomElementInfo(el, false);

    expect(first.customElementInfo.instanceId).toMatch(/^aui-\d+$/);
    expect(second.customElementInfo.instanceId).toBe(first.customElementInfo.instanceId);
  });

  it('gives repeated components distinct instanceIds', () => {
    const a = makeV2Component('my-item', { label: 'one' });
    const b = makeV2Component('my-item', { label: 'two' });

    const infoA = hooks.getCustomElementInfo(a.el, false);
    const infoB = hooks.getCustomElementInfo(b.el, false);

    expect(infoA.customElementInfo.instanceId).not.toBe(infoB.customElementInfo.instanceId);
  });

  it('resolves the exact instance by instanceId, not the first match', () => {
    const a = makeV2Component('my-item', { label: 'one' });
    const b = makeV2Component('my-item', { label: 'two' });

    hooks.getCustomElementInfo(a.el, false);
    const infoB = hooks.getCustomElementInfo(b.el, false);
    const idB = infoB.customElementInfo.instanceId;

    const resolved = hooks.getComponentByKey(idB);
    const label = resolved.properties.find((p: any) => p.name === 'label');
    expect(label.value).toBe('two');
  });

  it('falls back to the first instance for definition keys', () => {
    makeV2Component('my-item', { label: 'one' });
    makeV2Component('my-item', { label: 'two' });

    const resolved = hooks.getComponentByKey('au:resource:custom-element:my-item');
    const label = resolved.properties.find((p: any) => p.name === 'label');
    expect(label.value).toBe('one');
  });

  it('does not resolve instanceIds of disconnected components', () => {
    const a = makeV2Component('my-item', { label: 'one' });
    makeV2Component('my-item', { label: 'two' });

    const infoA = hooks.getCustomElementInfo(a.el, false);
    const idA = infoA.customElementInfo.instanceId;
    a.el.remove();

    expect(hooks.getComponentByKey(idA)).toBeNull();
  });

  it('evaluates expressions against the exact instance', () => {
    makeV2Component('my-item', { label: 'one' });
    const b = makeV2Component('my-item', { label: 'two' });

    const infoB = hooks.getCustomElementInfo(b.el, false);
    const result = hooks.evaluateInComponentContext(infoB.customElementInfo.instanceId, 'this.label');

    expect(result).toEqual({ success: true, value: 'two', type: 'string' });
  });

  it('finds the exact host element from component info', () => {
    makeV2Component('my-item', { label: 'one' });
    const b = makeV2Component('my-item', { label: 'two' });

    const infoB = hooks.getCustomElementInfo(b.el, false);
    expect(hooks.findElementByComponentInfo(infoB)).toBe(b.el);
  });

  it('uses instanceIds as component tree keys', () => {
    makeV2Component('my-item', { label: 'one' });
    makeV2Component('my-item', { label: 'two' });

    const tree = hooks.getSimplifiedComponentTree();
    const keys = tree.map((node: any) => node.key);

    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    keys.forEach((key: string) => expect(key).toMatch(/^aui-\d+$/));
  });
});
