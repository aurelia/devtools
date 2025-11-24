import { IComponentController } from '@aurelia/runtime-html';
import {
  CustomElementDefinition,
  CustomAttributeDefinition,
} from '@aurelia/runtime-html';
import Aurelia from 'aurelia';

export interface Property {
  type: string;
  debugId?: number;
  canExpand?: boolean;
  canEdit?: boolean;
  isEditing?: boolean;
  isExpanded?: boolean;
  name: string;
  value: unknown;
  expandedValue?: IControllerInfo;
}

export interface IControllerInfo {
  name: CustomElementDefinition['name'] | CustomAttributeDefinition['name'];
  aliases:
    | CustomElementDefinition['aliases']
    | CustomAttributeDefinition['aliases'];
  key: CustomElementDefinition['key'] | CustomAttributeDefinition['key'];
  bindables: Property[];
  properties: Property[];
  controller?: { properties: Property[] };
}

export type AureliaInfo = {
  customElementInfo: IControllerInfo | null;
  customAttributesInfo: IControllerInfo[];
};

export interface AureliaComponentTreeNode {
  id: string;
  domPath: string;
  tagName: string | null;
  customElementInfo: IControllerInfo | null;
  customAttributesInfo: IControllerInfo[];
  children: AureliaComponentTreeNode[];
}

export interface AureliaComponentSnapshot {
  tree: AureliaComponentTreeNode[];
  flat: AureliaInfo[];
}

export interface PluginDevtoolsTable {
  columns?: string[];
  rows?: unknown[][];
}

export interface PluginDevtoolsSectionRow {
  label: string;
  value: unknown;
  format?: 'text' | 'code' | 'json';
  hint?: string;
}

export interface PluginDevtoolsSection {
  title?: string;
  description?: string;
  rows?: PluginDevtoolsSectionRow[];
  table?: PluginDevtoolsTable;
}

export interface PluginDevtoolsResult {
  status: 'ok' | 'empty' | 'error';
  pluginId?: string;
  title?: string;
  summary?: string;
  sections?: PluginDevtoolsSection[];
  data?: unknown;
  raw?: unknown;
  table?: PluginDevtoolsTable;
  error?: string;
  timestamp?: number;
}

export interface ExternalPanelDefinition extends PluginDevtoolsResult {
  id: string;
  label: string;
  icon?: string;
  description?: string;
  order?: number;
}

export interface ExternalPanelSnapshot {
  version: number;
  panels: ExternalPanelDefinition[];
}

export interface ExternalPanelContext extends Record<string, unknown> {
  selectedComponentId?: string;
  selectedNodeType?: 'custom-element' | 'custom-attribute';
  selectedDomPath?: string;
  aureliaVersion?: number | null;
  selectedInfo?: AureliaInfo;
}

export interface AureliaHooks {
  currentAttributes: IComponentController[];
  currentElement: IComponentController;
  Aurelia?: Aurelia;
  getCustomElementInfo?: (e: Element, traverse: boolean) => AureliaInfo;
  getAllInfo: (e: Element) => AureliaInfo[];
  updateValues: (
    obj: IControllerInfo,
    property: Property
  ) => IControllerInfo;
  getExpandedDebugValueForId?: (
    id: string
  ) => Pick<IControllerInfo, 'properties'>;
  getExternalPanelsSnapshot?: () => ExternalPanelSnapshot;
  emitDevtoolsEvent?: (eventName: string, payload?: unknown) => boolean;
}

type DefaultPayload = {
  properties: IControllerInfo['properties'];
  customElementInfo: IControllerInfo;
  customAttributesInfo: IControllerInfo[];
};

export interface IMessages<T = DefaultPayload> {
  type: string;
  payload: T;
}
