import { Property } from '../shared/types';

export const TYPE_CLASSES: Record<string, string> = {
  string: 'type-string',
  number: 'type-number',
  bigint: 'type-number',
  boolean: 'type-boolean',
  null: 'type-null',
  undefined: 'type-null',
  object: 'type-object',
  array: 'type-object',
  function: 'type-function',
};

export function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `"${value}"`;
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === 'object') return '{…}';
  return String(value);
}

export function formatExpandedValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function formatForClipboard(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function typeClass(type: string | undefined): string {
  const normalized = (type ?? '').replace(/^context-/, '');
  return TYPE_CLASSES[normalized] ?? 'type-default';
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${time}.${ms}`;
}

export function serializeProperties(properties: Property[] | undefined): Record<string, { value: unknown; type: string }> {
  const result: Record<string, { value: unknown; type: string }> = {};
  for (const prop of properties ?? []) {
    if (prop?.name) {
      result[prop.name] = { value: prop.value, type: prop.type };
    }
  }
  return result;
}

export interface PropertyRow {
  property: Property;
  depth: number;
}

export function flattenProperties(properties: Property[] | undefined, depth = 0): PropertyRow[] {
  const rows: PropertyRow[] = [];
  for (const property of properties ?? []) {
    if (!property) continue;
    rows.push({ property, depth });
    if (property.isExpanded && property.expandedValue?.properties?.length) {
      rows.push(...flattenProperties(property.expandedValue.properties, depth + 1));
    }
  }
  return rows;
}
