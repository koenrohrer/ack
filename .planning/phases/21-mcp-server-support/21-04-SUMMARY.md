---
phase: 21-mcp-server-support
plan: "04"
subsystem: testing
tags: [mcp, copilot, human-verification, integration-test]

# Dependency graph
requires:
  - phase: 21-01
    provides: Copilot MCP schema, parser, and writer implementations
  - phase: 21-02
    provides: CopilotAdapter MCP methods wired into extension + getJsonPath fix
  - phase: 21-03
    provides: parseCopilotMcpFile + addCopilotMcpServer/removeCopilotMcpServer TDD test suite
provides:
  - Human-verified end-to-end confirmation that all five MCP requirements pass in the running extension
  - Bug fix: CopilotAdapter.detect() now checks both GitHub.copilot and GitHub.copilot-chat extension IDs
affects: [22-mcp-server-write, 23-mcp-server-write-user]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CopilotAdapter.detect() checks both GitHub.copilot and GitHub.copilot-chat for broader compatibility"

key-files:
  created: []
  modified:
    - src/adapters/copilot/copilot.adapter.ts

key-decisions:
  - "detect() checks GitHub.copilot OR GitHub.copilot-chat — users may have only the chat extension installed"

patterns-established:
  - "Detection pattern: check all known extension IDs for a vendor (GitHub.copilot + GitHub.copilot-chat) to avoid false negatives"

requirements-completed: [MCP-01, MCP-02, MCP-03, MCP-04, MCP-05]

# Metrics
duration: 10min
completed: 2026-02-21
---

# Phase 21 Plan 04: Human Verification Summary

**Human-verified end-to-end: all five MCP requirements (MCP-01 through MCP-05) pass in the running Extension Development Host; copilot-chat detection fix applied during verification**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-02-21T23:00:00Z
- **Completed:** 2026-02-21T23:10:00Z
- **Tasks:** 2 (Task 1: build + test suite; Task 2: human checkpoint)
- **Files modified:** 1

## Accomplishments

- Full build (`npm run compile`) passed with zero TypeScript errors
- Full test suite passed: 294 tests across all suites, including the new copilot-mcp.test.ts (13 tests)
- Human approved all five MCP requirements verified in the running Extension Development Host:
  - MCP-01: Workspace `.vscode/mcp.json` servers visible in Copilot sidebar
  - MCP-02: User-scope `mcp.json` servers visible in Copilot sidebar
  - MCP-03: Marketplace install writes correctly under the `servers` key in `.vscode/mcp.json`
  - MCP-04: Sidebar remove deletes the entry, `inputs` array preserved (no data loss)
  - MCP-05: External edit to `.vscode/mcp.json` triggers sidebar auto-refresh without restarting VS Code
- Bug found and fixed during verification: `CopilotAdapter.detect()` only checked `GitHub.copilot`, missing users who only have `GitHub.copilot-chat` installed

## Task Commits

Each task was committed atomically:

1. **Task 1: Build extension and run final test suite** - `546ba62` (test — from 21-03 plan, tests already committed)
2. **Task 2: Human verification of Phase 21 MCP requirements** - `df95682` (fix — copilot-chat detection fix applied during verification)

**Plan metadata:** *(this commit)*

## Files Created/Modified

- `src/adapters/copilot/copilot.adapter.ts` - `detect()` extended to also check `GitHub.copilot-chat` extension ID

## Decisions Made

- `detect()` now checks both `GitHub.copilot` and `GitHub.copilot-chat` — a user may have installed only the chat extension without the standalone copilot extension; checking both ensures Copilot appears in the QuickPick for all valid installs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CopilotAdapter.detect() missed GitHub.copilot-chat users**
- **Found during:** Task 2 (human verification checkpoint)
- **Issue:** During live testing, a user with only `GitHub.copilot-chat` installed did not see Copilot appear in the agent QuickPick. The original `detect()` only checked the `GitHub.copilot` extension ID.
- **Fix:** Extended the OR condition in `detect()` to also check `vscode.extensions.getExtension('GitHub.copilot-chat')`.
- **Files modified:** `src/adapters/copilot/copilot.adapter.ts`
- **Verification:** Human re-ran the extension with copilot-chat present — Copilot appeared in QuickPick. All five MCP requirements re-verified and approved.
- **Committed in:** `df95682` (fix(21): detect GitHub.copilot-chat extension as valid Copilot install)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Essential correctness fix for a real user scenario. No scope creep — single-line OR condition change.

## Issues Encountered

None during automated tasks. The detection gap was found during human verification and fixed inline before final approval.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 21 MCP Server Support is fully verified end-to-end and complete
- All five MCP requirements (MCP-01 through MCP-05) confirmed working in the Extension Development Host
- Ready for Phase 22 (MCP server write operations) or Phase 23 (user-scope MCP write) as planned
- Known gap to watch in later phases: Windows CI handling of `APPDATA` fallback in `getVSCodeUserDir()`

---
*Phase: 21-mcp-server-support*
*Completed: 2026-02-21*
