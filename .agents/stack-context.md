# Stack Context

Generated: 2026-10-31

- Language: vanilla JavaScript; HTML and CSS for the popup/content UI.
- Runtime: Chromium Manifest V3; background service worker, MAIN/isolated content scripts.
- Build: none; load the source folder as an unpacked extension.
- Dependencies/package manager: none.
- Tests: `node tests/run-tests.cjs` (Node assertions/VM and isolated Chromium CDP).
- Browser harness: Edge on Windows; override with `QG_BROWSER_PATH`.
- CI/lint/formatter: none configured.
- Conventions: IIFEs for browser globals; pure reducers; CommonJS unit tests, ESM browser tests.
- State: local extension storage; background owns serialized settings/activity writes.
