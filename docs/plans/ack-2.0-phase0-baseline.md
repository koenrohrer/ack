# ACK 2.0 — Phase 0 Baseline

**Date:** 2026-06-20
**Branch:** `2.0-core` (cut from `master` @ `f8dea1c`)
**Node:** v24.16.0 · **npm:** 11.13.0 · **esbuild:** 0.24.2

Locks in current (v1.3.1) behavior before any 2.0 change. Re-run this gate after each phase and compare.

## Gate results (all green)

| Step | Command | Result |
|---|---|---|
| Install | `npm ci --ignore-scripts` | ✅ 686 pkgs, 4s — build works without any install script |
| Type-check | `npm run check-types` | ✅ ext + webview clean |
| Lint | `npm run lint` | ✅ 0 errors, **1 pre-existing warning** (`adapters/claude-code/writers/settings.writer.ts:50` unused `_`) |
| Unit tests | `npm run test:unit` | ✅ **22 files, 369 tests** passing |
| Compile | `npm run compile` | ✅ `dist/extension.js` 930.8kb |
| Package | `npm run package` (minified) | ✅ `dist/extension.js` 491.8kb |

## Supply-chain (§5a) — Phase 0 portion done

- `--ignore-scripts` install verified to still build + test green → highest-value step landed.
- `package-lock.json` is committed (tracked in git).
- **No allowlist needed:** esbuild 0.24.2 ships its platform binary as an optional dependency, not a postinstall; `@vscode/vsce` and the rest also build fine with scripts disabled.
- Deferred to Phase 6: `npm audit` in CI + `.github/dependabot.yml` + cooldown.

## Notes carried forward

- `npm audit` currently reports **19 vulnerabilities (9 moderate, 8 high, 2 critical)** — all in the dev/build tree (never shipped: VSIX is esbuild-bundled, `node_modules` is `.vscodeignore`'d). Addressed in Phase 6.
- Build emits separate webview bundles: `dist/webview.{js,css}` (marketplace — removed in Phase 1) and `dist/config-panel.{js,css}` (kept). They are **separate documents**, confirming config-panel does not load `marketplace.css` at runtime → the `marketplace-filters__tab` class needs the Phase 1 CSS rescue (§1a finding 4).

## Test-count anchor

`369` unit tests across `22` files is the regression baseline. Phase 1 deletes `registry.service.test.ts` (10), `repo-scanner.service.test.ts` (2); Phase 2 rewrites `install.service.test.ts` (41). Expect the count to move accordingly — track deltas, not just pass/fail.
