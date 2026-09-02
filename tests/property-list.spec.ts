import './setup';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { createFixture } from '@aurelia/testing';
import { tasksSettled } from '@aurelia/runtime';
import { CustomElement, IPlatform, PLATFORM, Registration } from 'aurelia';
import { PropertyList, convertEditedValue } from '@/sidebar/components/property-list';
import { SidebarDebugHost } from '@/sidebar/sidebar-debug-host';
import type { Property } from '@/shared/types';

const template = readFileSync(resolvePath(__dirname, '../src/sidebar/components/property-list.html'), 'utf8');
const PropertyListElement = CustomElement.define({ name: 'property-list', template }, PropertyList);

function stubDebugHost(overrides: Partial<Record<string, any>> = {}) {
  return {
    updateValues: jest.fn(),
    getExpandedValue: jest.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as SidebarDebugHost;
}

function prop(overrides: Partial<Property>): Property {
  return { name: 'value', value: 1, type: 'number', ...overrides };
}

describe('convertEditedValue', () => {
  it('parses numbers and rejects garbage', () => {
    expect(convertEditedValue('number', '42')).toEqual({ applied: true, value: 42, type: 'number' });
    expect(convertEditedValue('number', '  ')).toEqual({ applied: false, type: 'number' });
    expect(convertEditedValue('number', 'abc')).toEqual({ applied: false, type: 'number' });
  });

  it('parses booleans case-insensitively', () => {
    expect(convertEditedValue('boolean', 'TRUE')).toEqual({ applied: true, value: true, type: 'boolean' });
    expect(convertEditedValue('boolean', 'false')).toEqual({ applied: true, value: false, type: 'boolean' });
    expect(convertEditedValue('boolean', 'yes')).toEqual({ applied: false, type: 'boolean' });
  });

  it('parses bigints', () => {
    expect(convertEditedValue('bigint', '9007199254740993')).toEqual({
      applied: true,
      value: BigInt('9007199254740993'),
      type: 'bigint',
    });
    expect(convertEditedValue('bigint', '1.5')).toEqual({ applied: false, type: 'bigint' });
  });

  it('keeps null and undefined unless text is entered', () => {
    expect(convertEditedValue('null', '')).toEqual({ applied: true, value: null, type: 'null' });
    expect(convertEditedValue('null', 'text')).toEqual({ applied: true, value: 'text', type: 'string' });
    expect(convertEditedValue('undefined', 'undefined')).toEqual({ applied: true, value: undefined, type: 'undefined' });
    expect(convertEditedValue('undefined', 'x')).toEqual({ applied: true, value: 'x', type: 'string' });
  });

  it('treats everything else as a string', () => {
    expect(convertEditedValue('string', 'hello')).toEqual({ applied: true, value: 'hello', type: 'string' });
    expect(convertEditedValue('object', 'hello')).toEqual({ applied: true, value: 'hello', type: 'string' });
  });
});

describe('PropertyList view model', () => {
  let list: PropertyList;
  let debugHost: ReturnType<typeof stubDebugHost>;

  beforeEach(() => {
    jest.useFakeTimers();
    debugHost = stubDebugHost();
    list = Object.create(PropertyList.prototype);
    list.properties = [];
    list.owner = null;
    list.editable = true;
    list.copyable = true;
    list.copiedProperty = null;
    (list as any).copiedTimer = null;
    (list as any).debugHost = debugHost;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('displays functions without string quotes', () => {
    expect(list.displayValue('[Function]', 'function')).toBe('[Function]');
    expect(list.displayValue('text', 'string')).toBe('"text"');
  });

  it('exposes flattened rows', () => {
    list.properties = [
      prop({ name: 'a' }),
      prop({ name: 'b', isExpanded: true, expandedValue: { properties: [prop({ name: 'child' })] } as any }),
    ];
    expect(list.rows.map((r) => `${r.property.name}@${r.depth}`)).toEqual(['a@0', 'b@0', 'child@1']);
    expect(list.rows.every((r) => r.editable)).toBe(true);
    list.editable = false;
    expect(list.rows.some((r) => r.editable)).toBe(false);
  });

  it('only allows editing primitive or explicitly editable properties', () => {
    expect(list.canEdit(prop({ type: 'string' }))).toBe(true);
    expect(list.canEdit(prop({ type: 'object' }))).toBe(false);
    expect(list.canEdit(prop({ type: 'object', canEdit: true }))).toBe(true);
    list.editable = false;
    expect(list.canEdit(prop({ type: 'string' }))).toBe(false);
  });

  it('beginEdit marks editable properties and ignores others', () => {
    const editable = prop({ type: 'string' });
    const locked = prop({ type: 'object' });
    list.beginEdit(editable);
    list.beginEdit(locked);
    expect(editable.isEditing).toBe(true);
    expect(locked.isEditing).toBeUndefined();
  });

  it('editorText shows raw text without quotes', () => {
    expect(list.editorText(prop({ value: 'hi', type: 'string' }))).toBe('hi');
    expect(list.editorText(prop({ value: null, type: 'null' }))).toBe('null');
    expect(list.editorText(prop({ value: undefined, type: 'undefined' }))).toBe('undefined');
  });

  it('commitEdit applies the converted value and notifies the page', () => {
    const owner = { name: 'comp', key: 'comp', aliases: [], bindables: [], properties: [] };
    list.owner = owner;
    const property = prop({ isEditing: true });

    const result = list.commitEdit(property, '7');

    expect(result).toEqual({ applied: true, value: 7 });
    expect(property.value).toBe(7);
    expect(property.isEditing).toBe(false);
    expect(debugHost.updateValues).toHaveBeenCalledWith(owner, property);
  });

  it('commitEdit keeps the old value when conversion fails', () => {
    const property = prop({ value: 5, isEditing: true });

    const result = list.commitEdit(property, 'nope');

    expect(result.applied).toBe(false);
    expect(property.value).toBe(5);
    expect(property.isEditing).toBe(false);
    expect(debugHost.updateValues).not.toHaveBeenCalled();
  });

  it('commitEdit is a no-op after the edit was cancelled', () => {
    const property = prop({ value: 5, isEditing: true });
    list.cancelEdit(property);

    expect(list.commitEdit(property, '9')).toEqual({ applied: false });
    expect(property.value).toBe(5);
  });

  it('retypes null properties when text is entered', () => {
    const property = prop({ value: null, type: 'null', isEditing: true });
    list.commitEdit(property, 'text');
    expect(property.value).toBe('text');
    expect(property.type).toBe('string');
  });

  it('selects the existing text when the editor gains focus', () => {
    const select = jest.fn();
    list.onEditorFocus({ target: { select } } as unknown as FocusEvent);
    expect(select).toHaveBeenCalled();
  });

  it('handles Enter and Escape in the editor', () => {
    const property = prop({ value: 1, isEditing: true });
    const target = { value: '3' } as HTMLInputElement;
    const enter = { key: 'Enter', target, preventDefault: jest.fn() } as unknown as KeyboardEvent;
    list.onEditorKeydown(enter, property);
    expect(property.value).toBe(3);

    const other = prop({ value: 1, isEditing: true });
    const escape = { key: 'Escape', target, preventDefault: jest.fn() } as unknown as KeyboardEvent;
    list.onEditorKeydown(escape, other);
    expect(other.isEditing).toBe(false);
    expect(other.value).toBe(1);
  });

  it('toggleExpand collapses expanded rows and re-expands cached ones without a lookup', () => {
    const cached = prop({ canExpand: true, isExpanded: true, expandedValue: { properties: [] } as any });
    list.toggleExpand(cached);
    expect(cached.isExpanded).toBe(false);
    list.toggleExpand(cached);
    expect(cached.isExpanded).toBe(true);
    expect(debugHost.getExpandedValue).not.toHaveBeenCalled();
  });

  it('toggleExpand loads nested values from the page on first expansion', async () => {
    const expanded = { properties: [prop({ name: 'child' })] };
    (debugHost.getExpandedValue as jest.Mock).mockResolvedValue(expanded);
    const property = prop({ canExpand: true, debugId: 12 });

    list.toggleExpand(property);
    await Promise.resolve();

    expect(debugHost.getExpandedValue).toHaveBeenCalledWith(12);
    expect(property.expandedValue).toBe(expanded);
    expect(property.isExpanded).toBe(true);
  });

  it('toggleExpand ignores rows that cannot expand', () => {
    const property = prop({ canExpand: false });
    list.toggleExpand(property);
    expect(property.isExpanded).toBeUndefined();
    expect(debugHost.getExpandedValue).not.toHaveBeenCalled();
  });

  it('copyValue writes to the clipboard and shows transient feedback', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const property = prop({ value: { a: 1 }, type: 'object' });
    const stop = jest.fn();

    await list.copyValue(property, { stopPropagation: stop } as unknown as Event);

    expect(stop).toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith('{\n  "a": 1\n}');
    expect(list.isCopied(property)).toBe(true);
    jest.advanceTimersByTime(1500);
    expect(list.isCopied(property)).toBe(false);
  });

  it('copyValue swallows clipboard failures', async () => {
    Object.assign(navigator, { clipboard: { writeText: jest.fn().mockRejectedValue(new Error('denied')) } });
    const property = prop({ value: 'x', type: 'string' });
    await list.copyValue(property);
    expect(list.isCopied(property)).toBe(false);
  });
});

describe('PropertyList rendering', () => {
  function render(host: any, properties: Property[], editable = true) {
    class App {
      properties = properties;
      editable = editable;
      owner = { name: 'comp', key: 'comp', aliases: [], bindables: [], properties: [] };
    }
    return createFixture(
      '<property-list properties.bind="properties" owner.bind="owner" editable.bind="editable"></property-list>',
      App,
      [PropertyListElement, Registration.instance(IPlatform, PLATFORM), Registration.instance(SidebarDebugHost, host)]
    );
  }

  it('renders a row per property with typed values', async () => {
    const { appHost, startPromise, tearDown } = render(stubDebugHost(), [
      prop({ name: 'label', value: 'Hi', type: 'string' }),
      prop({ name: 'count', value: 3, type: 'number' }),
    ]);
    await startPromise;

    const rows = appHost.querySelectorAll('.property-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.property-name')?.textContent).toBe('label');
    expect(rows[0].querySelector('.property-value')?.textContent?.trim()).toBe('"Hi"');
    expect(rows[0].querySelector('.property-value')?.classList.contains('type-string')).toBe(true);
    expect(rows[1].querySelector('.property-value')?.classList.contains('type-number')).toBe(true);

    await tearDown();
  });

  it('re-renders nested rows when a property is expanded', async () => {
    const child = prop({ name: 'child', value: 'x', type: 'string' });
    const parent = prop({
      name: 'parent',
      value: {},
      type: 'object',
      canExpand: true,
      expandedValue: { properties: [child] } as any,
    });
    const { appHost, startPromise, tearDown } = render(stubDebugHost(), [parent]);
    await startPromise;

    expect(appHost.querySelectorAll('.property-row')).toHaveLength(1);

    (appHost.querySelector('.disclosure') as HTMLButtonElement).click();
    await tasksSettled();

    const rows = appHost.querySelectorAll('.property-row');
    expect(rows).toHaveLength(2);
    expect((rows[1] as HTMLElement).style.paddingLeft).toBe('12px');
    expect(rows[1].querySelector('.property-name')?.textContent).toBe('child');

    await tearDown();
  });

  it('reflects live value changes without re-creating rows', async () => {
    const property = prop({ name: 'count', value: 1, type: 'number' });
    const { appHost, startPromise, tearDown } = render(stubDebugHost(), [property]);
    await startPromise;

    property.value = 99;
    await tasksSettled();

    expect(appHost.querySelector('.property-value')?.textContent?.trim()).toBe('99');
    await tearDown();
  });

  it('opens an editor on double click and commits on Enter', async () => {
    const host = stubDebugHost();
    const property = prop({ name: 'count', value: 1, type: 'number' });
    const { appHost, startPromise, tearDown } = render(host, [property]);
    await startPromise;

    appHost.querySelector('.property-value')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tasksSettled();

    const editor = appHost.querySelector('.property-editor') as HTMLInputElement;
    expect(editor).not.toBeNull();
    expect(editor.value).toBe('1');

    editor.value = '5';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tasksSettled();

    expect(property.value).toBe(5);
    expect(host.updateValues).toHaveBeenCalled();
    expect(appHost.querySelector('.property-editor')).toBeNull();
    expect(appHost.querySelector('.property-value')?.textContent?.trim()).toBe('5');

    await tearDown();
  });

  it('does not open an editor when the list is read-only', async () => {
    const property = prop({ name: 'count', value: 1, type: 'number' });
    const { appHost, startPromise, tearDown } = render(stubDebugHost(), [property], false);
    await startPromise;

    appHost.querySelector('.property-value')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tasksSettled();

    expect(appHost.querySelector('.property-editor')).toBeNull();
    await tearDown();
  });
});
