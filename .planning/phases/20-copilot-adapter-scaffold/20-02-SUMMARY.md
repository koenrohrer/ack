---
phase: 20-copilot-adapter-scaffold
plan: "02"
subsystem: adapters
tags: [eslint, copilot, quickpick, marketplace, boundary-guard, adapter-registry]

# Dependency graph
requires:
  - phase: 20-copilot-adapter-scaffold/20-01
    provides: CopilotAdapter scaffold with detect(), id='copilot', paths.ts

provides:
  - ESLint boundary guard covering src/adapters/copilot/** (three-adapter guard complete)
  - QuickPick that completely hides Copilot when GitHub.copilot extension not installed
  - Marketplace configDir lookup map resolving '.vscode' for Copilot, not '.claude'

affects: [21-copilot-mcp-read, 22-copilot-tools-read, 23-copilot-write, 24-copilot-profile, 25-copilot-polish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CONFIG_DIR_LABELS lookup map pattern for adapter-specific directory labels (extensible for future adapters)"
    - "adapter.id === 'copilot' convention-based hide filter in QuickPick (no new interface needed)"

key-files:
  created: []
  modified:
    - eslint.config.mjs
    - src/views/agent-switcher/agent-switcher.quickpick.ts
    - src/views/marketplace/marketplace.panel.ts

key-decisions:
  - "Use adapter.id === 'copilot' id-check directly in QuickPick loop (convention-based, no interface change per RESEARCH.md Pattern 3 Option A)"
  - "CONFIG_DIR_LABELS Record<string, string> lookup map over ternary chain for extensibility"
  - "copilot boundary guard ignores src/adapters/copilot/** (same pattern as claude-code and codex)"

patterns-established:
  - "Adapter hide pattern: check !detected && adapter.id === 'X' then continue to skip entry entirely"
  - "Directory label map: CONFIG_DIR_LABELS Record<string, string> with fallback to '.claude'"

requirements-completed: [UX-01, UX-02, UX-03]

# Metrics
duration: 1min
completed: 2026-02-21
---

# Phase 20 Plan 02: Copilot Wire-Up Summary

**ESLint boundary guard extended to copilot adapter, QuickPick hides Copilot when not installed, and marketplace configDir lookup map replaces two-way ternary — completing all Phase 20 success criteria**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-21T20:59:33Z
- **Completed:** 2026-02-21T21:00:46Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- ESLint boundary guard now covers all three adapters (claude-code, codex, copilot) — prevents any file outside src/adapters/copilot/** from importing copilot internals directly
- QuickPick completely hides Copilot when `GitHub.copilot` extension is not detected — no "not detected" label shown, adapter is skipped in loop
- Marketplace `promptForScope` uses `CONFIG_DIR_LABELS` lookup map resolving `.vscode` for Copilot, `.codex` for Codex, `.claude` for Claude Code — old two-way ternary removed

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend ESLint boundary guard to cover copilot adapter** - `ec44342` (feat)
2. **Task 2: Hide Copilot in QuickPick when not installed + fix marketplace configDir** - `d0851d6` (feat)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified

- `eslint.config.mjs` - Added `src/adapters/copilot/**` to boundary guard ignores and copilot no-restricted-imports pattern (third entry)
- `src/views/agent-switcher/agent-switcher.quickpick.ts` - Added hide filter: skip Copilot in loop when not detected
- `src/views/marketplace/marketplace.panel.ts` - Replaced two-way ternary with CONFIG_DIR_LABELS lookup map

## Decisions Made

- Used `adapter.id === 'copilot'` id check directly in QuickPick loop (convention-based, no interface change needed per RESEARCH.md Pattern 3 Option A)
- `CONFIG_DIR_LABELS` as a `Record<string, string>` const inside `promptForScope` method — local to the method where it's used, no module-level export needed
- Fallback to `.claude` via `?? '.claude'` in configDir lookup preserves backward-compatible default for any unknown adapter id

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all three changes applied cleanly. Compile, lint (0 errors), and 277 unit tests all pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 5 Phase 20 success criteria from ROADMAP.md are now satisfied:
  1. CopilotAdapter registered and shown in QuickPick when detected (Plan 01 + Plan 02)
  2. Copilot hidden when GitHub Copilot VS Code extension not installed (Plan 02)
  3. onDidSwitchAgent fan-out handles sidebar/marketplace/profile updates (pre-existing)
  4. ESLint boundary guard covers **/adapters/copilot/* (Plan 02 Task 1)
  5. Marketplace configDir conditional no longer hard-codes .claude as fallback (Plan 02 Task 2)
- Phase 21 (Copilot MCP read) is unblocked — CopilotAdapter.getMcpFilePath() is fully implemented from Plan 01
- Known concerns for Phase 21: verify FileWatcherManager handles non-existent .vscode/ at activate; confirm Windows CI handles APPDATA fallback in getVSCodeUserDir()

---
*Phase: 20-copilot-adapter-scaffold*
*Completed: 2026-02-21*

## Self-Check: PASSED

- FOUND: .planning/phases/20-copilot-adapter-scaffold/20-02-SUMMARY.md
- FOUND: eslint.config.mjs (modified)
- FOUND: src/views/agent-switcher/agent-switcher.quickpick.ts (modified)
- FOUND: src/views/marketplace/marketplace.panel.ts (modified)
- FOUND: commit ec44342 (Task 1 - ESLint boundary guard)
- FOUND: commit d0851d6 (Task 2 - QuickPick hide + marketplace configDir)
