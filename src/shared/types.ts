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
  customElementInfo: IControllerInfo;
  customAttributesInfo: IControllerInfo[];
};

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
