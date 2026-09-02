import {
  flattenProperties,
  formatExpandedValue,
  formatForClipboard,
  formatTimestamp,
  formatValue,
  serializeProperties,
  typeClass,
} from '@/sidebar/format';

describe('format helpers', () => {
  describe('formatValue', () => {
    it('renders primitives the way DevTools does', () => {
      expect(formatValue(null)).toBe('null');
      expect(formatValue(undefined)).toBe('undefined');
      expect(formatValue('hello')).toBe('"hello"');
      expect(formatValue(42)).toBe('42');
      expect(formatValue(true)).toBe('true');
    });

    it('summarises arrays and objects instead of dumping them', () => {
      expect(formatValue([1, 2, 3])).toBe('Array(3)');
      expect(formatValue({ a: 1 })).toBe('{…}');
    });
  });

  describe('formatExpandedValue', () => {
    it('serialises objects as JSON', () => {
      expect(formatExpandedValue({ a: 1 })).toBe('{"a":1}');
      expect(formatExpandedValue('x')).toBe('"x"');
      expect(formatExpandedValue(undefined)).toBe('undefined');
      expect(formatExpandedValue(null)).toBe('null');
      expect(formatExpandedValue(7)).toBe('7');
    });

    it('falls back to String for unserialisable values', () => {
      const circular: any = {};
      circular.self = circular;
      expect(formatExpandedValue(circular)).toBe('[object Object]');
    });
  });

  describe('formatForClipboard', () => {
    it('pretty prints objects and keeps primitives raw', () => {
      expect(formatForClipboard({ a: 1 })).toBe('{\n  "a": 1\n}');
      expect(formatForClipboard('text')).toBe('text');
      expect(formatForClipboard(null)).toBe('null');
      expect(formatForClipboard(undefined)).toBe('undefined');
    });
  });

  describe('typeClass', () => {
    it('maps runtime types to syntax classes', () => {
      expect(typeClass('string')).toBe('type-string');
      expect(typeClass('number')).toBe('type-number');
      expect(typeClass('bigint')).toBe('type-number');
      expect(typeClass('boolean')).toBe('type-boolean');
      expect(typeClass('null')).toBe('type-null');
      expect(typeClass('undefined')).toBe('type-null');
      expect(typeClass('object')).toBe('type-object');
      expect(typeClass('array')).toBe('type-object');
      expect(typeClass('function')).toBe('type-function');
    });

    it('strips the context prefix used by override-context entries', () => {
      expect(typeClass('context-string')).toBe('type-string');
    });

    it('falls back for unknown or missing types', () => {
      expect(typeClass('symbol')).toBe('type-default');
      expect(typeClass(undefined)).toBe('type-default');
    });
  });

  describe('formatTimestamp', () => {
    it('includes milliseconds', () => {
      const result = formatTimestamp(new Date('2024-01-15T10:30:45.123Z').getTime());
      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}\.123$/);
    });
  });

  describe('serializeProperties', () => {
    it('keys properties by name and skips blanks', () => {
      const result = serializeProperties([
        { name: 'a', value: 1, type: 'number' },
        null as any,
        { name: '', value: 2, type: 'number' },
      ]);
      expect(result).toEqual({ a: { value: 1, type: 'number' } });
    });

    it('handles undefined input', () => {
      expect(serializeProperties(undefined)).toEqual({});
    });
  });

  describe('flattenProperties', () => {
    it('returns an empty list for missing input', () => {
      expect(flattenProperties(undefined)).toEqual([]);
      expect(flattenProperties([])).toEqual([]);
    });

    it('keeps top-level rows at depth zero', () => {
      const rows = flattenProperties([
        { name: 'a', value: 1, type: 'number' },
        { name: 'b', value: 2, type: 'number' },
      ]);
      expect(rows.map((r) => r.depth)).toEqual([0, 0]);
    });

    it('includes expanded children with increasing depth', () => {
      const rows = flattenProperties([
        {
          name: 'obj',
          value: {},
          type: 'object',
          isExpanded: true,
          expandedValue: {
            properties: [
              {
                name: 'nested',
                value: {},
                type: 'object',
                isExpanded: true,
                expandedValue: { properties: [{ name: 'leaf', value: 'x', type: 'string' }] } as any,
              },
            ],
          } as any,
        },
      ]);
      expect(rows.map((r) => [r.property.name, r.depth])).toEqual([
        ['obj', 0],
        ['nested', 1],
        ['leaf', 2],
      ]);
    });

    it('ignores children of collapsed rows', () => {
      const rows = flattenProperties([
        {
          name: 'obj',
          value: {},
          type: 'object',
          isExpanded: false,
          expandedValue: { properties: [{ name: 'nested', value: 1, type: 'number' }] } as any,
        },
      ]);
      expect(rows).toHaveLength(1);
    });
  });
});
