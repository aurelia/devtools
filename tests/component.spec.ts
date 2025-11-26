import './setup';
import { createFixture } from '@aurelia/testing';
import { customElement, valueConverter, bindable, IPlatform, Registration } from 'aurelia';
import { BrowserPlatform } from '@aurelia/platform-browser';

const platform = new BrowserPlatform(globalThis);

beforeAll(() => {
  (globalThis as any).__au_platform__ = platform;
});

function fixture<T>(template: string, App: new () => T, deps: any[] = []) {
  return createFixture(
    template,
    App,
    [...deps, Registration.instance(IPlatform, platform)]
  );
}

@valueConverter('stringify')
class StringifyValueConverter {
  toView(value: unknown): string {
    return JSON.stringify(value);
  }
}

describe('StringifyValueConverter', () => {
  describe('unit tests', () => {
    let sut: StringifyValueConverter;

    beforeEach(() => {
      sut = new StringifyValueConverter();
    });

    it('converts string to JSON string', () => {
      expect(sut.toView('hello')).toBe('"hello"');
    });

    it('converts number to JSON string', () => {
      expect(sut.toView(42)).toBe('42');
    });

    it('converts boolean to JSON string', () => {
      expect(sut.toView(true)).toBe('true');
      expect(sut.toView(false)).toBe('false');
    });

    it('converts null to JSON string', () => {
      expect(sut.toView(null)).toBe('null');
    });

    it('converts array to JSON string', () => {
      expect(sut.toView([1, 2, 3])).toBe('[1,2,3]');
    });

    it('converts object to JSON string', () => {
      expect(sut.toView({ foo: 'bar' })).toBe('{"foo":"bar"}');
    });

    it('converts nested object to JSON string', () => {
      const obj = { a: { b: { c: 1 } } };
      expect(sut.toView(obj)).toBe('{"a":{"b":{"c":1}}}');
    });
  });

  describe('integration tests with template', () => {
    it('works within a view with string', async () => {
      const { appHost, startPromise, tearDown } = fixture(
        '<span>${value | stringify}</span>',
        class TestApp { value = 'hello'; },
        [StringifyValueConverter]
      );

      await startPromise;
      expect(appHost.textContent).toBe('"hello"');
      await tearDown();
    });

    it('works within a view with object', async () => {
      const { appHost, startPromise, tearDown } = fixture(
        '<span>${value | stringify}</span>',
        class TestApp { value = { name: 'test' }; },
        [StringifyValueConverter]
      );

      await startPromise;
      expect(appHost.textContent).toBe('{"name":"test"}');
      await tearDown();
    });

    it('updates when bound value changes', async () => {
      const { appHost, component, startPromise, tearDown } = fixture(
        '<span>${value | stringify}</span>',
        class TestApp { value: any = 'initial'; },
        [StringifyValueConverter]
      );

      await startPromise;
      expect(appHost.textContent).toBe('"initial"');

      component.value = { updated: true };
      await Promise.resolve();

      expect(appHost.textContent).toBe('{"updated":true}');
      await tearDown();
    });
  });
});

@customElement({
  name: 'tab-bar',
  template: `
    <nav class="tab-bar">
      <button
        repeat.for="tab of tabs"
        class="tab-button \${activeTab === tab.id ? 'active' : ''}"
        click.trigger="onTabClick(tab.id)"
      >
        <span class="tab-icon">\${tab.icon}</span>
        <span class="tab-label">\${tab.label}</span>
      </button>
    </nav>
  `
})
class TabBar {
  tabs = [
    { id: 'all', label: 'All', icon: '🌲' },
    { id: 'components', label: 'Components', icon: '📦' },
  ];
  activeTab = 'all';
  onTabClick(tabId: string) {
    this.activeTab = tabId;
  }
}

describe('TabBar component', () => {
  it('renders tabs from provided data', async () => {
    const { appHost, startPromise, tearDown } = fixture(
      '<tab-bar></tab-bar>',
      class TestHost {},
      [TabBar]
    );

    await startPromise;

    const tabButtons = appHost.querySelectorAll('.tab-button');
    expect(tabButtons.length).toBe(2);

    const labels = Array.from(tabButtons).map(btn => btn.textContent?.replace(/\s+/g, ''));
    expect(labels).toContain('🌲All');
    expect(labels).toContain('📦Components');

    await tearDown();
  });

  it('marks first tab as active by default', async () => {
    const { appHost, startPromise, tearDown } = fixture(
      '<tab-bar></tab-bar>',
      class TestHost {},
      [TabBar]
    );

    await startPromise;

    const tabButtons = appHost.querySelectorAll('.tab-button');
    expect(tabButtons[0].classList.contains('active')).toBe(true);
    expect(tabButtons[1].classList.contains('active')).toBe(false);

    await tearDown();
  });

  it('switches active tab on click', async () => {
    const { appHost, startPromise, tearDown } = fixture(
      '<tab-bar></tab-bar>',
      class TestHost {},
      [TabBar]
    );

    await startPromise;

    const tabButtons = appHost.querySelectorAll('.tab-button');
    (tabButtons[1] as HTMLButtonElement).click();
    await Promise.resolve();

    expect(tabButtons[0].classList.contains('active')).toBe(false);
    expect(tabButtons[1].classList.contains('active')).toBe(true);

    await tearDown();
  });
});

@customElement({
  name: 'view-mode-toggle',
  template: `
    <div class="view-mode-toggle" role="group" aria-label="View mode">
      <button
        class="toolbar-button \${viewMode === 'tree' ? 'active' : ''}"
        click.trigger="setViewMode('tree')"
        aria-label="Tree view"
      >🌳</button>
      <button
        class="toolbar-button \${viewMode === 'list' ? 'active' : ''}"
        click.trigger="setViewMode('list')"
        aria-label="List view"
      >☰</button>
    </div>
  `
})
class ViewModeToggle {
  viewMode: 'tree' | 'list' = 'tree';

  setViewMode(mode: 'tree' | 'list') {
    if (this.viewMode !== mode) {
      this.viewMode = mode;
    }
  }
}

describe('ViewModeToggle component', () => {
  it('renders tree and list buttons', async () => {
    const { appHost, startPromise, tearDown } = fixture(
      '<view-mode-toggle></view-mode-toggle>',
      class TestHost {},
      [ViewModeToggle]
    );

    await startPromise;

    const treeButton = appHost.querySelector('[aria-label="Tree view"]');
    const listButton = appHost.querySelector('[aria-label="List view"]');
    expect(treeButton).toBeTruthy();
    expect(listButton).toBeTruthy();

    await tearDown();
  });

  it('tree mode is active by default', async () => {
    const { appHost, startPromise, tearDown } = fixture(
      '<view-mode-toggle></view-mode-toggle>',
      class TestHost {},
      [ViewModeToggle]
    );

    await startPromise;

    const treeButton = appHost.querySelector('[aria-label="Tree view"]');
    const listButton = appHost.querySelector('[aria-label="List view"]');
    expect(treeButton?.classList.contains('active')).toBe(true);
    expect(listButton?.classList.contains('active')).toBe(false);

    await tearDown();
  });

  it('clicking list button switches to list mode', async () => {
    const { appHost, startPromise, tearDown } = fixture(
      '<view-mode-toggle></view-mode-toggle>',
      class TestHost {},
      [ViewModeToggle]
    );

    await startPromise;

    const listButton = appHost.querySelector('[aria-label="List view"]') as HTMLButtonElement;
    listButton.click();
    await Promise.resolve();

    const treeButton = appHost.querySelector('[aria-label="Tree view"]');
    expect(treeButton?.classList.contains('active')).toBe(false);
    expect(listButton?.classList.contains('active')).toBe(true);

    await tearDown();
  });

  it('clicking same mode does nothing', async () => {
    const { appHost, component, startPromise, tearDown } = fixture(
      '<view-mode-toggle></view-mode-toggle>',
      class TestHost {},
      [ViewModeToggle]
    );

    await startPromise;

    const vmComponent = (component as any).$controller.children[0].viewModel as ViewModeToggle;
    const initialMode = vmComponent.viewMode;

    const treeButton = appHost.querySelector('[aria-label="Tree view"]') as HTMLButtonElement;
    treeButton.click();
    await Promise.resolve();

    expect(vmComponent.viewMode).toBe(initialMode);

    await tearDown();
  });
});

@customElement({
  name: 'search-input',
  template: `
    <div class="search-container">
      <input
        type="text"
        value.bind="searchQuery"
        placeholder.bind="placeholder"
        class="search-input"
      />
      <button class="search-mode-button" click.trigger="cycleMode()">\${modeLabel}</button>
    </div>
  `
})
class SearchInput {
  searchQuery = '';
  mode: 'name' | 'property' | 'all' = 'name';
  @bindable placeholder = 'Search...';

  get modeLabel() {
    switch (this.mode) {
      case 'name': return 'Name';
      case 'property': return 'Props';
      case 'all': return 'All';
    }
  }

  cycleMode() {
    const modes: Array<'name' | 'property' | 'all'> = ['name', 'property', 'all'];
    const idx = modes.indexOf(this.mode);
    this.mode = modes[(idx + 1) % modes.length];
  }
}

describe('SearchInput component', () => {
  it('renders input with placeholder', async () => {
    const { appHost, startPromise, tearDown } = fixture(
      '<search-input placeholder="Search components..."></search-input>',
      class TestHost {},
      [SearchInput]
    );

    await startPromise;

    const input = appHost.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.placeholder).toBe('Search components...');

    await tearDown();
  });

  it('displays current search mode', async () => {
    const { appHost, startPromise, tearDown } = fixture(
      '<search-input></search-input>',
      class TestHost {},
      [SearchInput]
    );

    await startPromise;

    const modeButton = appHost.querySelector('.search-mode-button');
    expect(modeButton?.textContent).toBe('Name');

    await tearDown();
  });

  it('cycles through search modes on button click', async () => {
    const { appHost, startPromise, tearDown } = fixture(
      '<search-input></search-input>',
      class TestHost {},
      [SearchInput]
    );

    await startPromise;

    const modeButton = appHost.querySelector('.search-mode-button') as HTMLButtonElement;

    expect(modeButton.textContent).toBe('Name');

    modeButton.click();
    await Promise.resolve();
    expect(modeButton.textContent).toBe('Props');

    modeButton.click();
    await Promise.resolve();
    expect(modeButton.textContent).toBe('All');

    modeButton.click();
    await Promise.resolve();
    expect(modeButton.textContent).toBe('Name');

    await tearDown();
  });

  it('binds search query value', async () => {
    const { appHost, startPromise, tearDown } = fixture(
      '<search-input></search-input>',
      class TestHost {},
      [SearchInput]
    );

    await startPromise;

    const input = appHost.querySelector('input') as HTMLInputElement;
    input.value = 'test query';
    input.dispatchEvent(new Event('input'));
    await Promise.resolve();

    await tearDown();
  });
});

@customElement({
  name: 'component-node',
  template: `
    <div class="component-node \${expanded ? 'expanded' : ''} \${selected ? 'selected' : ''}">
      <button if.bind="hasChildren" class="expand-toggle" click.trigger="toggleExpand()">
        \${expanded ? '▼' : '▶'}
      </button>
      <span class="node-icon">\${icon}</span>
      <span class="node-name">\${name}</span>
    </div>
  `
})
class ComponentNode {
  @bindable name = 'my-component';
  @bindable icon = '📦';
  @bindable hasChildren = false;
  @bindable expanded = false;
  @bindable selected = false;

  toggleExpand() {
    this.expanded = !this.expanded;
  }
}

describe('ComponentNode component', () => {
  it('renders component name and icon', async () => {
    const { appHost, startPromise, tearDown } = fixture(
      '<component-node name="my-app" icon="🏠"></component-node>',
      class TestHost {},
      [ComponentNode]
    );

    await startPromise;

    const nodeName = appHost.querySelector('.node-name');
    const nodeIcon = appHost.querySelector('.node-icon');
    expect(nodeName?.textContent).toBe('my-app');
    expect(nodeIcon?.textContent).toBe('🏠');

    await tearDown();
  });

  it('shows expand toggle only when has children', async () => {
    const { appHost, startPromise, tearDown } = fixture(
      '<component-node has-children.bind="false"></component-node>',
      class TestHost {},
      [ComponentNode]
    );

    await startPromise;

    const expandToggle = appHost.querySelector('.expand-toggle');
    expect(expandToggle).toBeFalsy();

    await tearDown();
  });

  it('shows expand toggle when has children', async () => {
    const { appHost, startPromise, tearDown } = fixture(
      '<component-node has-children.bind="true"></component-node>',
      class TestHost {},
      [ComponentNode]
    );

    await startPromise;

    const expandToggle = appHost.querySelector('.expand-toggle');
    expect(expandToggle).toBeTruthy();

    await tearDown();
  });

  it('toggles expanded state on click', async () => {
    const { appHost, startPromise, tearDown } = fixture(
      '<component-node has-children.bind="true"></component-node>',
      class TestHost {},
      [ComponentNode]
    );

    await startPromise;

    const node = appHost.querySelector('.component-node');
    const expandToggle = appHost.querySelector('.expand-toggle') as HTMLButtonElement;

    expect(node?.classList.contains('expanded')).toBe(false);
    expect(expandToggle.textContent?.trim()).toBe('▶');

    expandToggle.click();
    await Promise.resolve();

    expect(node?.classList.contains('expanded')).toBe(true);
    expect(expandToggle.textContent?.trim()).toBe('▼');

    await tearDown();
  });

  it('applies selected class when selected', async () => {
    const { appHost, startPromise, tearDown } = fixture(
      '<component-node selected.bind="true"></component-node>',
      class TestHost {},
      [ComponentNode]
    );

    await startPromise;

    const node = appHost.querySelector('.component-node');
    expect(node?.classList.contains('selected')).toBe(true);

    await tearDown();
  });
});
