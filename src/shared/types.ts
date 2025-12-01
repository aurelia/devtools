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
  expression?: string;
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

export type InteractionPhase = 'before' | 'after';

export interface EventInteractionRecord {
  id: string;
  eventName: string;
  domPath?: string | null;
  mode: 'delegate' | 'trigger' | 'capture' | 'navigation' | 'unknown';
  timestamp: number;
  duration?: number;
  vmName?: string;
  handlerName?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  error?: string | null;
  replayable?: boolean;
  canApplySnapshot?: boolean;
  target?: InteractionTargetHint;
  eventInit?: Record<string, unknown>;
  detail?: unknown;
  stale?: boolean;
}

export interface InteractionTargetHint {
  domPath?: string | null;
  tagName?: string | null;
  componentName?: string | null;
  componentKey?: string | null;
  componentType?: 'custom-element' | 'custom-attribute' | 'unknown';
  href?: string | null;
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
  getInteractionLog?: () => EventInteractionRecord[];
  replayInteraction?: (id: string) => boolean;
  applyInteractionSnapshot?: (id: string, phase: InteractionPhase) => boolean;
  clearInteractionLog?: () => boolean;
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

export interface PropertyChangeRecord {
  componentKey: string;
  propertyName: string;
  propertyType: 'bindable' | 'property';
  oldValue: unknown;
  newValue: unknown;
  timestamp: number;
}

export interface ComponentTreeChangeRecord {
  type: 'added' | 'removed' | 'changed';
  componentKey: string;
  componentName: string;
  timestamp: number;
}

export interface PropertySnapshot {
  componentKey: string;
  bindables: Array<{ name: string; value: unknown; type: string }>;
  properties: Array<{ name: string; value: unknown; type: string }>;
  timestamp: number;
}

export interface WatchOptions {
  componentKey: string;
  pollInterval?: number;
}

export interface LifecycleHookInfo {
  name: string;
  implemented: boolean;
  isAsync: boolean;
}

export interface LifecycleHooksSnapshot {
  version: 1 | 2;
  hooks: LifecycleHookInfo[];
}

export interface ComputedPropertyInfo {
  name: string;
  value: unknown;
  type: string;
  hasGetter: boolean;
  hasSetter: boolean;
}

export interface DependencyInfo {
  name: string;
  key: string;
  type: 'service' | 'token' | 'interface' | 'unknown';
}

export interface DISnapshot {
  dependencies: DependencyInfo[];
  containerDepth: number;
}

export interface ContainerInfo {
  id: number;
  depth: number;
  isRoot: boolean;
  registrationCount: number;
  ownerName?: string;
}

export interface EnhancedDependencyInfo {
  name: string;
  key: string;
  type: 'service' | 'token' | 'interface' | 'unknown';
  containerDepth: number;
  containerInfo: ContainerInfo | null;
  resolvedValue?: unknown;
  resolvedType?: string;
  instanceName?: string;
  instancePreview?: Record<string, unknown>;
}

export interface ContainerHierarchy {
  current: ContainerInfo;
  ancestors: ContainerInfo[];
}

export interface AvailableService {
  name: string;
  key: string;
  type: 'service' | 'token' | 'interface' | 'resource' | 'unknown';
  isFromAncestor: boolean;
}

export interface EnhancedDISnapshot {
  version: 2;
  dependencies: EnhancedDependencyInfo[];
  containerHierarchy: ContainerHierarchy | null;
  availableServices: AvailableService[];
}

export interface RouteParamInfo {
  name: string;
  value: string;
}

export interface RouteSnapshot {
  currentRoute: string | null;
  params: RouteParamInfo[];
  queryParams: RouteParamInfo[];
  navigationId: string | null;
  isNavigating: boolean;
}

export interface SlotInfo {
  name: string;
  hasContent: boolean;
  nodeCount: number;
}

export interface SlotSnapshot {
  slots: SlotInfo[];
  hasDefaultSlot: boolean;
}

export interface ComponentTreeNode {
  key: string;
  name: string;
  tagName: string;
  type: 'custom-element' | 'custom-attribute';
  hasChildren: boolean;
  childCount: number;
  isExpanded?: boolean;
  children?: ComponentTreeNode[];
}

export interface ComponentTreeRow {
  node: ComponentTreeNode;
  depth: number;
}

export interface TimelineEvent {
  id: string;
  type: 'property-change' | 'lifecycle' | 'interaction';
  componentKey: string;
  componentName: string;
  timestamp: number;
  detail: string;
  data?: Record<string, unknown>;
}

// Template Debugger Types
export type BindingMode = 'oneTime' | 'toView' | 'fromView' | 'twoWay' | 'default';

export interface TemplateBinding {
  id: string;
  type: 'property' | 'attribute' | 'interpolation' | 'listener' | 'ref' | 'let';
  expression: string;
  target: string;
  value: unknown;
  valueType: string;
  mode?: BindingMode;
  isBound: boolean;
}

export interface RepeatItem {
  index: number;
  key?: string;
  value: unknown;
  isFirst: boolean;
  isLast: boolean;
  isEven: boolean;
  isOdd: boolean;
}

export interface TemplateControllerInfo {
  id: string;
  type: 'if' | 'else' | 'repeat' | 'with' | 'switch' | 'case' | 'au-slot' | 'portal' | 'other';
  name: string;
  expression?: string;
  isActive: boolean;
  condition?: unknown;
  items?: RepeatItem[];
  itemCount?: number;
  localVariable?: string;
  cachedViews?: number;
}

export interface TemplateInstructionInfo {
  type: string;
  description: string;
  target?: string;
  details?: Record<string, unknown>;
}

export interface TemplateSnapshot {
  componentKey: string;
  componentName: string;
  bindings: TemplateBinding[];
  controllers: TemplateControllerInfo[];
  instructions: TemplateInstructionInfo[];
  hasSlots: boolean;
  shadowMode: 'open' | 'closed' | 'none';
  isContainerless: boolean;
}
