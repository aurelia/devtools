# Aurelia DevTools

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-22.x-green.svg)](https://nodejs.org)
[![Chrome Extension](https://img.shields.io/badge/chrome-extension-blue.svg)](https://developer.chrome.com/docs/extensions/)
[![TypeScript](https://img.shields.io/badge/typescript-5.7.x-blue.svg)](https://www.typescriptlang.org/)
[![Aurelia](https://img.shields.io/badge/aurelia-v1%20%7C%20v2-purple.svg)](https://aurelia.io/)

## WIP

This project is a work in progress. The current version is not yet available on the Chrome Web Store. Please check back later for updates.

----

A browser extension for debugging Aurelia 1 and 2 applications. Integrates as a sidebar pane in Chrome's Elements panel for seamless component inspection.

## Features

- **Dual Version Support**: Works with both Aurelia v1 and v2 applications
- **Component Discovery**: Automatically finds and displays all Aurelia components on the page
- **Interactive Property Inspector**: View and edit component properties, bindables, and custom attributes
- **Professional Interface**: Clean, modern design matching Chrome DevTools aesthetics
- **Real-time Updates**: Refresh functionality to re-scan components
- **Dark/Light Theme Support**: Adapts to Chrome DevTools theme preferences
 - **Elements Sidebar Integration**: Optional Aurelia sidebar in the Elements panel showing the selected node's Aurelia info
 - **Selection Sync**: Toggle to auto-sync the Aurelia panel selection with the Elements panel ($0). Includes a "Reveal in Elements" action

### Binding expressions (Aurelia 1 & 2)
- Every bindable/property row now shows an `expr: ...` badge when the value comes from a binding; this works for both Aurelia 1 and 2.
- In the Inspector > Controller section you’ll see `bindings` (and `instructions` for v1) collections. Expand an item to inspect the binding record, including the original expression and, for member access, the resolved object so you can drill further.
- If you don’t see expressions, expand the selected component’s `Controller` > `bindings` entry; each binding/instruction item carries the expression even when the property is a computed object.

## Opting Out Of DevTools

If you need to prevent the Aurelia DevTools from inspecting your application (v1 or v2), set any of the following **before** Aurelia bootstraps:

- `window.__AURELIA_DEVTOOLS_DISABLED__ = true;` (aliases: `window.__AURELIA_DEVTOOLS_DISABLE__`, `window.AURELIA_DEVTOOLS_DISABLE`)
- `<meta name="aurelia-devtools" content="disable">`
- `data-aurelia-devtools="disable"` on the `<html>` element

When present, the extension will skip installing hooks, ignore detection events, and the DevTools panel will display “Aurelia DevTools disabled.”

## Installation

### From Chrome Web Store
*Coming soon...*

### Manual Installation (Development)
1. Clone this repository: `git clone https://github.com/aurelia/devtools.git`
2. Run `npm install` to install dependencies
3. Run `npm run build` to build the extension
4. Follow [Chrome's extension loading guide](https://developer.chrome.com/docs/extensions/mv3/getstarted/#manifest):
   - Open `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the `dist` folder

## Development

### Prerequisites
Install the latest Node.js and npm versions.

### Build Commands
- `npm run start` - Development mode with file watching (Vite build --watch)
- `npm run build` - Production build
- `npm run analyze` - Production build with bundle analyzer (vite-bundle-analyzer)
- `npm run lint` - Run ESLint and HTMLHint
- `npm run test` - Run Jest tests with coverage
- `npm run reload` - Open Chrome extension reload URL

### Development Workflow
1. Run `npm run start` to start development mode
2. Load the extension in Chrome (see Installation > Manual Installation)
3. Pin the Aurelia Extension in the toolbar to verify detection: "Aurelia 2 detected on this page."
4. Open Developer Tools, go to the Elements panel, and find the "Aurelia" sidebar pane
5. For code changes:
   - Reload the extension in `chrome://extensions`
   - Close and reopen Developer Tools (or Ctrl+R in the DevTools inspect window)
   - Refresh the target page if needed

## Event-Driven DevTools Panels

Extension authors can surface custom diagnostics by listening for (and dispatching) browser events. No registration helpers are required—just emit the right events from the inspected page.

### 1. Publish Data

Dispatch `aurelia-devtools-panel-data` with a detail payload whenever you have information to show. Each `id` becomes its own tab.

```ts
type DevtoolsPanelDetail = {
  id: string;
  label?: string;
  icon?: string; // emoji or short text (<=4 chars)
  description?: string;
  order?: number;
  summary?: string;
  sections?: Array<{
    title?: string;
    description?: string;
    rows?: Array<{ label?: string; value: unknown; format?: 'text' | 'code' | 'json'; hint?: string }>;
    table?: { columns?: string[]; rows?: unknown[][] };
  }>;
  data?: unknown;
  status?: 'ok' | 'empty' | 'error';
  error?: string;
};

window.addEventListener('aurelia-devtools-ready', () => {
  window.dispatchEvent(
    new CustomEvent<DevtoolsPanelDetail>('aurelia-devtools-panel-data', {
      detail: {
        id: 'aurelia-store',
        label: 'Store',
        icon: '🧠',
        summary: `Last action: ${window.store?.lastAction ?? 'n/a'}`,
        sections: [
          {
            title: 'State',
            rows: [{ label: 'snapshot', value: window.store?.state, format: 'json' }],
          },
        ],
        data: window.store,
      },
    })
  );
});
```

### 2. Refresh On Demand

When the DevTools user clicks the refresh button, the panel dispatches `aurelia-devtools:request-panel` with `{ id, context }`. Listen for that event to push updated data:

```ts
window.addEventListener('aurelia-devtools:request-panel', (event: CustomEvent<{ id: string; context: any }>) => {
  if (event.detail.id !== 'aurelia-store') return;
  const ctx = event.detail.context; // contains selection + Aurelia version info
  // recompute payload (maybe using ctx.selectedDomPath)
  window.dispatchEvent(new CustomEvent('aurelia-devtools-panel-data', { detail: buildStorePayload(ctx) }));
});
```

### 3. Track Selection Changes

DevTools emits `aurelia-devtools:selection-changed` with the same context object whenever the inspected component changes. Use it to correlate diagnostics with the current view-model:

```ts
window.addEventListener('aurelia-devtools:selection-changed', (event: CustomEvent<any>) => {
  const { selectedComponentId, selectedDomPath } = event.detail;
  // optional: update internal state or eagerly re-publish panel data
});
```

### 4. Clean Up

If your panel should disappear, dispatch `aurelia-devtools-panel-remove` with `{ id }`.

This event-first approach keeps the surface area tiny (just listen and dispatch) while still giving DevTools everything it needs to render a rich tab per integration.

### Troubleshooting Development Issues
- If you encounter "File not found" errors:
  1. Right-click in the panel/popup
  2. Select "Inspect"
  3. Check the console for error details
- If the "Aurelia" tab doesn't appear, try refreshing the target page
- Clear any extension errors in the `chrome://extensions` page

## Architecture

### Core Components
- **Sidebar Application** (`src/sidebar/`) - Aurelia 2 app rendering the Elements panel sidebar
- **Extension Scripts**:
  - `detector.ts` - Detects Aurelia versions on web pages
  - `background.ts` - Service worker managing extension state
  - `contentscript.ts` - Finds Aurelia instances in DOM
  - `devtools.js` - Creates the Elements sidebar pane

### Build System
- **Vite** - Modern build tool
- **TypeScript** - Type safety and modern JavaScript features
- **Aurelia 2** - Framework for the sidebar UI itself

### File Structure
```
src/
├── sidebar/                # Sidebar application
│   ├── main.ts             # Entry point
│   ├── sidebar-app.ts      # Main ViewModel
│   ├── sidebar-app.html    # Template
│   ├── sidebar-app.css     # Styles
│   └── sidebar-debug-host.ts # Communication layer
├── background/             # Service worker
├── contentscript/          # Page content interaction
├── detector/               # Aurelia version detection
├── devtools/               # Sidebar pane creation
├── shared/                 # Common types and utilities
└── popups/                 # Extension popup pages
```

## Technology Stack

- **Frontend**: Aurelia 2, TypeScript, CSS
- **Build**: Vite, Rollup
- **Linting**: ESLint, HTMLHint
- **Extension**: Chrome Extension Manifest v3

## Current Limitations

- Map and Set changes don't live update automatically
- V1 and V2 feature parity is still in development
- Some advanced Aurelia features may not be fully supported yet

## Release Process

### Automated Deployment

The project uses GitHub Actions for automated Chrome Web Store deployment:

1. **Prepare Release** (Manual Workflow):
   ```bash
   # Local preparation
   ./scripts/prepare-release.sh
   
   # Or use GitHub workflow:
   # Go to Actions > "Prepare Release" > Run workflow
   ```

2. **Create GitHub Release**:
   - Tag format: `v1.2.3` (semantic versioning)
   - Triggers automatic Chrome Web Store deployment
   - Includes conventional commit changelog generation

3. **Chrome Web Store**:
   - Extension automatically uploaded and published
   - Review process typically takes 1-3 business days

### Version Management

We follow [semantic versioning](https://semver.org/) with conventional commits:

- **MAJOR** (2.0.0): Breaking changes (`feat!:`, `fix!:`)
- **MINOR** (1.1.0): New features (`feat(scope): description`)  
- **PATCH** (1.0.1): Bug fixes (`fix(scope): description`)

### Commit Message Format

Use conventional commits for automatic changelog generation:

```bash
feat(inspector): add property editing functionality
fix(detector): improve aurelia v2 detection reliability
docs(readme): update installation instructions
style(devtools): remove emoji from panel title
refactor(debug): improve property update handling
test(components): add unit tests for property-view
chore(deps): update aurelia to v2.0.0-beta.25
```

### Release Workflow

```bash
# 1. Prepare release (runs tests, builds, shows changelog)
./scripts/prepare-release.sh

# 2. Create GitHub release
git tag v1.2.3
git push origin v1.2.3

# 3. Create release on GitHub.com with tag v1.2.3
# 4. Deployment happens automatically via GitHub Actions
```

### Required GitHub Secrets

For automated deployment, configure these repository secrets:

- `CHROME_EXTENSION_ID` - Extension ID from Chrome Web Store
- `CHROME_CLIENT_ID` - Google OAuth Client ID  
- `CHROME_CLIENT_SECRET` - Google OAuth Client Secret
- `CHROME_REFRESH_TOKEN` - Generated refresh token

See [deployment documentation](docs/deployment.md) for detailed setup instructions.

## Contributing

### Development Workflow

1. **Clone and setup**:
   ```bash
   git clone https://github.com/aurelia/devtools.git
   cd devtools
   npm install
   ```

2. **Development**:
   ```bash
   npm run start  # Watch mode
   # Load extension in Chrome, make changes, reload extension
   ```

3. **Quality checks**:
   ```bash
   npm run lint   # Code quality
   npm test       # Unit tests
   npm run build  # Production build
   ```

4. **Conventional commits**:
   ```bash
   git commit -m "feat(scope): add new feature"
   git commit -m "fix(scope): resolve bug"
   ```

### Submitting Changes

- ✅ Use conventional commit format
- ✅ Ensure all tests pass: `npm test`
- ✅ Run linting: `npm run lint` 
- ✅ Build successfully: `npm run build`
- ✅ Follow existing code style and patterns

### Development Notes
- The extension uses Chrome's message passing for communication
- DevTools panel runs in an isolated context with limited APIs
- Both source and built files should be committed for distribution

## Credits

This extension is based on the original work by Brandon Seydel from the [aurelia-inspector](https://github.com/brandonseydel/aurelia-inspector) repository.

## License

MIT
