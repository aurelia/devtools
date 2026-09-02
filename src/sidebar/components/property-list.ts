import { bindable, resolve, ICustomElementViewModel } from 'aurelia';
import { SidebarDebugHost } from '../sidebar-debug-host';
import { IControllerInfo, Property } from '../../shared/types';
import { flattenProperties, formatForClipboard, formatValue, typeClass } from '../format';

const EDITABLE_TYPES = new Set(['string', 'number', 'boolean', 'bigint', 'null', 'undefined']);
const COPIED_FEEDBACK_MS = 1500;

export interface PropertyListRow {
  property: Property;
  depth: number;
  editable: boolean;
}

export interface CommitResult {
  applied: boolean;
  value?: unknown;
}

export class PropertyList implements ICustomElementViewModel {
  @bindable properties: Property[] = [];
  @bindable owner: IControllerInfo | null = null;
  @bindable editable = false;
  @bindable copyable = true;

  copiedProperty: Property | null = null;

  private copiedTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debugHost: SidebarDebugHost = resolve(SidebarDebugHost);

  get rows(): PropertyListRow[] {
    return flattenProperties(this.properties).map((row) => ({ ...row, editable: this.canEdit(row.property) }));
  }

  detaching(): void {
    if (this.copiedTimer) {
      clearTimeout(this.copiedTimer);
      this.copiedTimer = null;
    }
  }

  displayValue(value: unknown, type: string): string {
    if (type === 'function' && typeof value === 'string') {
      return value;
    }
    return formatValue(value);
  }

  typeClass(type: string | undefined): string {
    return typeClass(type);
  }

  canEdit(property: Property): boolean {
    return this.editable && (property.canEdit === true || EDITABLE_TYPES.has(property.type));
  }

  isCopied(property: Property): boolean {
    return this.copiedProperty === property;
  }

  editorText(property: Property): string {
    const value = property.value;
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    return String(value);
  }

  beginEdit(property: Property): void {
    if (!this.canEdit(property)) return;
    property.isEditing = true;
  }

  cancelEdit(property: Property): void {
    property.isEditing = false;
  }

  onEditorFocus(event: FocusEvent): void {
    (event.target as HTMLInputElement).select();
  }

  onEditorKeydown(event: KeyboardEvent, property: Property): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commitEdit(property, (event.target as HTMLInputElement).value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelEdit(property);
    }
  }

  commitEdit(property: Property, rawValue: string): CommitResult {
    if (!property.isEditing) return { applied: false };
    property.isEditing = false;

    const converted = convertEditedValue(property.type, rawValue);
    if (!converted.applied) return converted;

    property.value = converted.value;
    property.type = converted.type;

    if (this.owner) {
      this.debugHost.updateValues(this.owner, property);
    }
    return { applied: true, value: converted.value };
  }

  toggleExpand(property: Property): void {
    if (!property.canExpand) return;

    if (property.isExpanded) {
      property.isExpanded = false;
      return;
    }
    if (property.expandedValue) {
      property.isExpanded = true;
      return;
    }
    if (property.debugId === undefined) return;

    this.debugHost.getExpandedValue(property.debugId).then((expanded) => {
      if (!expanded) return;
      property.expandedValue = expanded;
      property.isExpanded = true;
    });
  }

  async copyValue(property: Property, event?: Event): Promise<void> {
    event?.stopPropagation();
    try {
      await navigator.clipboard.writeText(formatForClipboard(property.value));
    } catch {
      return;
    }
    this.copiedProperty = property;
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => {
      this.copiedProperty = null;
      this.copiedTimer = null;
    }, COPIED_FEEDBACK_MS);
  }
}

export function convertEditedValue(type: string, rawValue: string): CommitResult & { type: string } {
  switch (type) {
    case 'number': {
      const numeric = rawValue.trim() === '' ? NaN : Number(rawValue);
      return Number.isNaN(numeric) ? { applied: false, type } : { applied: true, value: numeric, type };
    }
    case 'bigint': {
      try {
        return { applied: true, value: BigInt(rawValue.trim()), type };
      } catch {
        return { applied: false, type };
      }
    }
    case 'boolean': {
      const lower = rawValue.trim().toLowerCase();
      if (lower !== 'true' && lower !== 'false') return { applied: false, type };
      return { applied: true, value: lower === 'true', type };
    }
    case 'null':
      return rawValue === '' || rawValue === 'null'
        ? { applied: true, value: null, type }
        : { applied: true, value: rawValue, type: 'string' };
    case 'undefined':
      return rawValue === '' || rawValue === 'undefined'
        ? { applied: true, value: undefined, type }
        : { applied: true, value: rawValue, type: 'string' };
    default:
      return { applied: true, value: rawValue, type: 'string' };
  }
}
