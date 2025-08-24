import './setup';
import { ChromeTest } from './setup';
// We instantiate App without running field initializers to avoid DI
let AppClass: any;
import { stubDebugHost, stubPlatform, nextTick } from './helpers';
import type { AureliaInfo, IControllerInfo, Property } from '@/shared/types';

function ci(name: string, key?: string): IControllerInfo {
  return {
    name,
    key: key ?? name,
    aliases: [],
    bindables: [],
    properties: []
  } as any;
}

function ai(element: IControllerInfo | null, attrs: IControllerInfo[] = []): AureliaInfo {
  return {
    customElementInfo: element as any,
    customAttributesInfo: attrs as any
  };
}

describe('App core logic', () => {
  let app: App;
  let debugHost: any;
  let plat: any;

  beforeEach(async () => {
    ChromeTest.reset();
    jest.resetModules();
    // Dynamically import App class
    const mod = await import('@/app');
    AppClass = mod.App;
    // Create instance without running field initializers (avoid DI resolve calls)
    app = Object.create(AppClass.prototype);
    // Seed essential fields
    (app as any).activeTab = 'all';
    (app as any).tabs = [];
    (app as any).selectedElement = undefined;
    (app as any).selectedElementAttributes = undefined;
    (app as any).allAureliaObjects = undefined;
    (app as any).componentTree = [];
    (app as any).filteredComponentTree = [];
    (app as any).selectedComponentId = undefined;
    (app as any).searchQuery = '';
    (app as any).isElementPickerActive = false;
    (app as any).aureliaDetected = false;
    (app as any).aureliaVersion = null;
    (app as any).detectionState = 'checking';

    debugHost = stubDebugHost();
    plat = stubPlatform();
    // Inject stubs
    (app as any).debugHost = debugHost;
    (app as any).plat = plat;
  });

  describe('createComponentHierarchy', () => {
    it('builds nodes, filters duplicate attrs by key/name, sets hasAttributes and sorts', () => {
      const element = ci('todo-item', 'todo-item');
      const dupAttr = ci('todo-item', 'todo-item'); // duplicate name/key should be filtered
      const realAttr = ci('selectable', 'selectable');
      const comps: AureliaInfo[] = [ai(element, [dupAttr, realAttr])];

      const tree = (app as any).createComponentHierarchy(comps);
      expect(tree).toHaveLength(1);
      const node = tree[0];
      expect(node.type).toBe('custom-element');
      expect(node.hasAttributes).toBe(true);
      expect(node.children).toHaveLength(1);
      expect(node.children[0].type).toBe('custom-attribute');
      expect(node.children[0].name).toBe('selectable');
    });

    it('includes standalone custom attributes without parent element', () => {
      const attrOnly = ai(null as any, [ci('draggable')]);
      const tree = (app as any).createComponentHierarchy([attrOnly]);
      expect(tree).toHaveLength(1);
      expect(tree[0].type).toBe('custom-attribute');
    });
  });

  describe('tab filtering and search filtering', () => {
    function seedTree() {
      const e1 = ai(ci('alpha'), [ci('attr-a'), ci('attr-b')]);
      const e2 = ai(ci('beta'));
      app.buildComponentTree([e1, e2]);
      return (app as any).componentTree as any[];
    }

    it('filteredComponentTreeByTab returns only elements for components tab', () => {
      seedTree();
      app.activeTab = 'components';
      const filtered = app.filteredComponentTreeByTab;
      expect(filtered.every(n => n.type === 'custom-element' || n.children?.length)).toBe(true);
    });

    it('filteredComponentTreeByTab returns only attributes for attributes tab (preserving parent chain where applicable)', () => {
      seedTree();
      app.activeTab = 'attributes';
      const filtered = app.filteredComponentTreeByTab;
      // Should contain nodes but any included parent has children of attributes
      function allChildrenAreAttr(nodes: any[]): boolean {
        for (const n of nodes) {
          if (n.type === 'custom-attribute') continue;
          if (n.children?.length) {
            if (!allChildrenAreAttr(n.children)) return false;
          }
        }
        return true;
      }
      expect(allChildrenAreAttr(filtered)).toBe(true);
    });

    it('search returns parents of matching descendants and auto-expands them', () => {
      seedTree();
      app.activeTab = 'all';
      app.searchQuery = 'attr-b';
      const filtered = app.filteredComponentTreeByTab;
      // There should be an element parent containing the matching attribute child
      const parent = filtered.find(n => n.type === 'custom-element');
      expect(parent).toBeTruthy();
      expect(parent.expanded).toBe(true);
      expect(parent.children.some((c: any) => c.name.toLowerCase().includes('attr-b'))).toBe(true);
    });

    it('clearSearch resets query and returns full tree', () => {
      seedTree();
      app.searchQuery = 'beta';
      expect(app.filteredComponentTreeByTab.length).toBeGreaterThan(0);
      app.clearSearch();
      expect(app.searchQuery).toBe('');
      expect(app.filteredComponentTreeByTab.length).toBeGreaterThan(0);
    });
  });

  describe('selection and expansion', () => {
    it('selectComponent sets selectedElement and filters attrs for element node', () => {
      const element = ci('alpha', 'alpha');
      const dupAttr = ci('alpha', 'alpha');
      const otherAttr = ci('x', 'x');
      const tree = (app as any).createComponentHierarchy([ai(element, [dupAttr, otherAttr])]);
      (app as any).componentTree = tree;

      app.selectComponent(tree[0].id);
      expect(app.selectedElement?.name).toBe('alpha');
      expect(app.selectedElementAttributes?.length).toBe(1);
      expect(app.selectedElementAttributes?.[0].name).toBe('x');
    });

    it('selectComponent sets selectedElement to attribute and clears attributes list for attribute node', () => {
      const element = ci('alpha');
      const otherAttr = ci('x');
      const tree = (app as any).createComponentHierarchy([ai(element, [otherAttr])]);
      (app as any).componentTree = tree;
      const attrNode = tree[0].children[0];

      app.selectComponent(attrNode.id);
      expect(app.selectedElement?.name).toBe('x');
      expect(app.selectedElementAttributes).toEqual([]);
    });

    it('toggleComponentExpansion toggles expanded state', () => {
      const tree = (app as any).createComponentHierarchy([ai(ci('alpha'))]);
      (app as any).componentTree = tree;
      const id = tree[0].id;
      expect(tree[0].expanded).toBe(false);
      app.toggleComponentExpansion(id);
      expect(((app as any).findComponentById(id).expanded)).toBe(true);
    });
  });

  describe('property editing and expansion', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    function makeProp(type: Property['type'], value: any): any {
      return { type, value, isEditing: true } as any;
    }

    it('saveProperty converts number and calls updateValues', async () => {
      const prop = makeProp('number', 1);
      (app as any).selectedElement = { properties: [prop], bindables: [] };

      app.saveProperty(prop, '42');
      // queueMicrotask is implemented with setTimeout(0) in stubPlatform
      jest.runOnlyPendingTimers();

      expect(prop.value).toBe(42);
      expect(prop.isEditing).toBe(false);
      expect(debugHost.updateValues).toHaveBeenCalled();
    });

    it('saveProperty handles invalid number by revert', () => {
      const original = 5;
      const prop = { type: 'number', value: original, isEditing: true, originalValue: original } as any;
      (app as any).selectedElement = { properties: [prop], bindables: [] };

      app.saveProperty(prop, 'not-a-number');
      expect(prop.value).toBe(original);
      expect(prop.isEditing).toBe(false);
    });

    it('saveProperty converts boolean', () => {
      const prop = makeProp('boolean', false);
      (app as any).selectedElement = { properties: [prop], bindables: [] };
      app.saveProperty(prop, 'true');
      jest.runOnlyPendingTimers();
      expect(prop.value).toBe(true);
    });

    it('togglePropertyExpansion loads expanded value via inspectedWindow.eval', async () => {
      const prop: any = { type: 'object', value: {}, canExpand: true, isExpanded: false, debugId: 7 };
      (app as any).selectedElement = { properties: [prop], bindables: [] };

      ChromeTest.setEvalToReturn([{ result: { properties: [{ name: 'child', type: 'string', value: 'x' }] } }]);

      app.togglePropertyExpansion(prop);
      // The eval callback is synchronous in our mock; microtask used to reassign references
      jest.runOnlyPendingTimers();

      expect(prop.isExpanded).toBe(true);
      expect(prop.expandedValue).toBeTruthy();
      expect(((app as any).selectedElement.properties)[0]).toEqual(expect.objectContaining({ isExpanded: true }));
    });
  });

  describe('highlighting delegates to debugHost', () => {
    it('highlightComponent forwards minimal payload', () => {
      const tree = (app as any).createComponentHierarchy([ai(ci('alpha'), [ci('x')])]);
      (app as any).componentTree = tree;
      app.highlightComponent(tree[0]);
      expect(debugHost.highlightComponent).toHaveBeenCalled();
    });

    it('unhighlightComponent forwards to debugHost', () => {
      app.unhighlightComponent();
      expect(debugHost.unhighlightComponent).toHaveBeenCalled();
    });
  });
});
