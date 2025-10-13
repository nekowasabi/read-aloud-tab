# Repository Guidelines

Guidelines for contributors to Read Aloud Tab.

## Project Structure & Module Organization
- `src/background` orchestrates text-to-speech, tab control, and core services, with integration specs under `__tests__`.
- UI entry points live in `src/popup`, `src/options`, and `src/offscreen`; shared types, messaging, and utilities belong in `src/shared`.
- Content scripts reside in `src/content`; webpack emits into `dist/{chrome,firefox}` while static assets stay in `public/` and coverage artifacts in `coverage/`.

## Build, Test, and Development Commands
- `npm install` prepares dependencies; `npm run dev` starts a watch build targeting Chrome and writes bundles to `dist/chrome`.
- `npm run build:chrome` / `npm run build:firefox` produce production bundles—rerun after manifest, asset, or localization changes.
- Quality gates: `npm run typecheck`, `npm run lint`, `npm run format`, and `npm run test` (`npm run test:watch` while iterating, `VERBOSE_TESTS=1 npm run test` when console output helps debugging).

## Coding Style & Naming Conventions
- Prettier enforces 2-space indentation, single quotes, trailing commas, and 100-character lines; run `npm run format` before committing.
- ESLint (`eslint:recommended`, TypeScript, React, Hooks) is authoritative; resolve `no-console` warnings or explain the necessity in review.
- Components and hooks use PascalCase (e.g., `TabQueueList.tsx`); services and utilities stay camelCase (e.g., `tabManager.ts`); place reusable contracts in `src/shared`.

## Testing Guidelines
- Jest with React Testing Library is configured via `jest.config.js`; author specs in `__tests__` folders or `*.test.ts(x)` files colocated with their targets.
- Browser mocks and fetch polyfills live in `src/tests/setup.ts`; extend that module when additional globals or APIs are required.
- Maintain coverage for new paths, document failures in PRs, and keep CI quiet unless debugging (`VERBOSE_TESTS=1 npm run test`).

## Commit & Pull Request Guidelines
- Follow Conventional Commit patterns from history (`feat:`, `fix:`, optional scopes like `background`); keep each commit focused and reference issues (`Fixes #123`).
- PRs need a concise summary, testing checklist, and screenshots or recordings for UI changes; mention extension reload steps when behavior shifts.
- Request review only after lint, typecheck, and tests pass locally; flag flaky cases or manual QA steps in the PR description.

## Browser Extension Packaging
- Load builds via `chrome://extensions` (Developer Mode → `dist/chrome`) or `about:debugging` with `dist/firefox/manifest.json`.
- Never edit or commit `dist/`; treat updates under `src/manifest` as cross-browser changes and verify both targets.
- Keep API keys and model secrets out of the repo—use the Options UI or local env files, and document any new permissions added.
