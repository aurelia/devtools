# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important
- The project is a Chrome DevTools extension for inspecting Aurelia v1 and v2 applications.
- The extension integrates as a sidebar pane in Chrome's Elements panel (not a top-level tab)
- The codebase uses Aurelia 2 for the sidebar UI and Vite for building the extension
- The extension scripts include detector, background, content script, and devtools sidebar creation
- Avoid complex expressions in the HTML templates and opt for getters in the ViewModel for clarity instead
- The project uses TypeScript, modern JavaScript features, and follows best practices for Chrome extensions
- Avoid using comments in code unless absolutely necessary; prefer clear and self-explanatory code
- Aurelia only observes what a template expression touches directly. State read inside a view-model method called from a template (for example `isSelected(node)` reading `this.selectedKey`) is not tracked, so either compare in the template (`node.key === selectedKey`), use keyed maps (`expandedIds[item.id]`), or expose a getter that reads the state itself
- New sidebar components must be registered in `src/sidebar/main.ts`; the Vite plugin pairs `foo.ts` with `foo.html` by convention
- Styling is plain CSS with custom properties in `src/sidebar/sidebar-app.css`; the palette follows Chrome DevTools with the Aurelia magenta as the only accent. No Tailwind
- `npm run lint` fails on any ESLint warning; keep it at zero
- If you need to reference the Aurelia 2 codebase itself, you can find it at `~/Code/aurelia-core` or going back one level from the root of this repo and into `aurelia-core`.

## Development Commands

### Build & Development
- `npm run start` - Start development mode with file watching (Vite build --watch)
- `npm run build` - Production build (Vite)
- `npm run analyze` - Production build with bundle analyzer

### Testing & Quality
- `npm test` - Run Jest tests with coverage
- `npm run lint` - Run both JS/TS and HTML linting
- `npm run lint:js` - ESLint for TypeScript/JavaScript files
- `npm run lint:html` - HTMLHint for HTML files

### Chrome Extension Development
- `npm run reload` - Open Chrome extension reload URL
- After code changes: reload the extension in `chrome://extensions` and reload developer tools

### Deployment & Release
- `./scripts/prepare-release.sh` - Interactive release preparation with quality checks
- `./scripts/generate-refresh-token.sh` - Generate Chrome Web Store API credentials
- **GitHub Workflows**: Automated Chrome Web Store deployment on release creation
- **Documentation**: See [docs/deployment.md](docs/deployment.md) for complete deployment guide

## Architecture Overview

This is a Chrome DevTools extension for inspecting Aurelia v1 and v2 applications. The extension integrates as an **Elements panel sidebar pane** that appears when inspecting Aurelia components.

### Core Components

**Sidebar Application (`src/sidebar/`)**
- `main.ts` - Entry point that bootstraps the Aurelia 2 sidebar app
- `sidebar-app.ts` - Main ViewModel for the sidebar panel
- `sidebar-app.html` - Template for the sidebar UI
- `sidebar-app.css` - Sidebar-specific styling
- `sidebar-debug-host.ts` - Communication layer between sidebar and inspected page; the only sidebar module that touches `chrome.*` APIs
- `format.ts` - Pure value formatting helpers (`formatValue`, `typeClass`, `flattenProperties`) shared by sidebar components
- `components/property-list.ts|html` - Reusable custom element rendering property rows with expansion, inline editing and copy

**Extension Scripts**
- `detector.ts` - Detects Aurelia v1 (`aurelia-composed`) and v2 (`au-started`) on web pages
- `background.ts` - Service worker that manages extension state and icon updates
- `contentscript.ts` - Content script that finds Aurelia instances in DOM (`$aurelia` property)
- `devtools.ts` - Creates the Elements sidebar pane using `chrome.devtools.panels.elements.createSidebarPane()` and injects the page hook
- `src/hook/` - Page-side devtools hook (`__AURELIA_DEVTOOLS_GLOBAL_HOOK__`), built as a self-contained IIFE (`build/hook.js`, via `vite build --mode hook`) and evaluated inside the inspected page. Components are identified by per-instance ids (`aui-N`) resolved through a WeakRef registry, with definition-key DOM scan as fallback

### Communication Flow
The extension uses Chrome's message passing system:
1. Detector script identifies Aurelia version on page
2. Background script updates extension icon/popup based on detection
3. DevTools sidebar follows Chrome's element selection (`$0`)
4. SidebarDebugHost manages communication between sidebar and page content via `chrome.devtools.inspectedWindow.eval()`

### Sidebar Features
- **Element Selection Sync**: Automatically follows Chrome DevTools element selection
- **Component Inspection**: View bindables, properties, and custom attributes
- **Property Editing**: Inline editing with real-time updates
- **Expression Evaluation**: Execute expressions in component context
- **Enhanced Inspection**: Lifecycle hooks, computed properties, DI dependencies, routing info
- **Search**: Find components and properties across the page
- **Dark/Light Theme**: Matches Chrome DevTools theme automatically

### Key Files
- `manifest.json` - Chrome extension manifest (v3) with devtools_page configuration
- `vite.config.mjs` - Multi-entry Vite build configuration for all extension scripts
- `sidebar.html` - Entry point HTML file for the sidebar pane
- `src/sidebar/sidebar-debug-host.ts` - Core debugging interface and message handling
- `src/shared/` - Types and utilities shared between extension components

### Testing Setup
- Jest 30 with `ts-jest` (ESM preset) in a jsdom environment; `tsconfig.jest.json` extends the root config
- Rendered component tests use `createFixture` from `@aurelia/testing` and `tasksSettled` from `@aurelia/runtime` to flush updates (see `tests/property-list.spec.ts`)
- Test setup file at `tests/setup.ts` provides the `chrome.*` mock
- Playwright e2e suite in `e2e/` loads the built extension against `e2e/fixtures/aurelia-app`

### Build Output
Vite outputs to `dist/` directory:
- `build/sidebar.js` - Sidebar panel application
- `build/detector.js`, `build/background.js`, `build/contentscript.js`, `build/devtools.js` - Extension scripts
- `build/hook.js` - Page-side hook IIFE, fetched by the devtools page and evaluated in the inspected page
- `sidebar.html` - Sidebar pane HTML entry point
- Static assets copied from `src/popups/`, `images/`, `manifest.json`, etc.
