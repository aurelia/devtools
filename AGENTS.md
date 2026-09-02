# Repository Guidelines

## Project Structure & Module Organization
Core extension code lives in `src/`, split by runtime: `background/` (service worker), `contentscript/` (page bridge), `sidebar/` (Elements panel sidebar UI), `devtools/` (sidebar pane creation), and `shared/` (DTOs and helpers). The sidebar application files sit together in `src/sidebar/` (`sidebar-app.ts`, `sidebar-app.html`, `sidebar-app.css`, `sidebar-debug-host.ts`). Static assets reside in `images/`. Jest specs live in `tests/` and mirror feature folders (`*.spec.ts`). Build artifacts land in `dist/`; keep it out of git.

If you need to reference the Aurelia 2 codebase itself, you can find it at `~/Code/aurelia-core` or going back one level from the root of this repo and into `aurelia-core`.

## Build, Test & Development Commands
- `npm run start` — watch build to `dist/` for live extension reloads.
- `npm run build` — clean production bundle prior to tagging or publishing.
- `npm run analyze` — launch bundle analyzer for weight checks.
- `npm run lint` (`lint:js`, `lint:html`) — enforce ESLint and HTMLHint rules.
- `npm run test`, `npm run test:watch`, `npm run test:ci` — run Jest locally, in watch mode, or serially for CI.
- `npm run reload` — open the Chrome extension reloader helper after a watch build.

Use Node 22.12+ and npm 10+ per `engines` (`.nvmrc` pins 22).

## Coding Style & Naming Conventions
Adhere to `.editorconfig`: LF endings, UTF-8, two-space indentation, and single quotes in TypeScript. Favor PascalCase view-model classes, camelCase members, and kebab-case template identifiers. Styling is plain CSS driven by the custom properties declared at the top of `src/sidebar/sidebar-app.css` (Chrome DevTools neutrals and syntax colours, Aurelia magenta accent); there is no Tailwind. Keep templates declarative: move branching logic into view-model getters rather than inline conditionals. Run `npm run lint` before committing and address findings directly—avoid broad `--fix` runs that cloud diffs. When creating new Aurelia components for the sidebar, register them in `src/sidebar/main.ts`.

## Testing Guidelines
Jest 30 (ESM via ts-jest) drives testing with a jsdom environment (`jest.config.mjs`); rendered component tests use `createFixture` from `@aurelia/testing`. Place specs in `tests/` matching the source folder name, e.g., `sidebar/sidebar-app` → `tests/sidebar-app.spec.ts`. Share mocks through `tests/setup.ts` and utilities via `tests/helpers.ts`. Cover new logic, edge cases, and Chrome API integrations. Maintain coverage tracked in `test-results/` and note intentional gaps in the PR.

## Commit & Pull Request Guidelines
Follow Conventional Commits (`feat(ui): …`, `test(app): …`) for history clarity. Each pull request should include: purpose, linked issue, screenshots or GIFs for UI shifts, and notes on manifest/config changes. Confirm `npm run build` and `npm run test` before requesting review. Rebase onto mainline, resolve TODOs, and keep the diff reviewable.

## Extension Packaging & Release
Version bumps must touch both `package.json` and `manifest.json`; `scripts/prepare-release.sh` automates the checklist. Inspect the contents of `dist/` after a production build, then use `scripts/setup-chrome-store-credentials.md` to handle store token storage—never commit secrets.
