---
phase: 22-custom-instructions-and-prompts
plan: 02
subsystem: testing
tags: [vitest, copilot, instructions, prompts, tdd, parsers]

# Dependency graph
requires:
  - phase: 22-custom-instructions-and-prompts/22-01
    provides: parseCopilotInstructions and parseCopilotPrompts implementations in instructions.parser.ts and prompts.parser.ts
provides:
  - TDD test suite for parseCopilotInstructions covering all 9 behavioral cases
  - TDD test suite for parseCopilotPrompts covering all 9 behavioral cases
  - Vitest config extended to discover co-located adapter test files (src/adapters/**/*.test.ts)
affects: [22-custom-instructions-and-prompts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Co-located adapter tests: test files placed alongside parsers in src/adapters/copilot/parsers/, picked up via vitest.config.ts glob extension"
    - "Real-services-on-tmpdir: FileIOService + fs.mkdtemp + beforeEach/afterEach cleanup — no mocks"

key-files:
  created:
    - src/adapters/copilot/parsers/instructions.parser.test.ts
    - src/adapters/copilot/parsers/prompts.parser.test.ts
  modified:
    - vitest.config.ts

key-decisions:
  - "vitest.config.ts extended to include src/adapters/**/*.test.ts glob so co-located adapter tests are discovered without moving them to src/test/unit/"
  - "Tests went GREEN immediately (Plan 01 implementations were already correct); no RED-phase iteration needed"

patterns-established:
  - "Co-located test pattern for copilot parsers: test file next to implementation, discovered via expanded vitest glob"
  - "Real FileIOService + os.tmpdir() in beforeEach/afterEach — consistent with existing copilot-mcp.test.ts pattern"

requirements-completed: [INST-01, INST-02, INST-03]

# Metrics
duration: 2min
completed: 2026-02-23
---

# Phase 22 Plan 02: Copilot Instructions and Prompts Parsers TDD Tests Summary

**TDD test suites for parseCopilotInstructions (8 cases) and parseCopilotPrompts (7 cases) using real FileIOService on tmpdir, with vitest config extended for co-located adapter tests**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-23T16:20:02Z
- **Completed:** 2026-02-23T16:22:24Z
- **Tasks:** 1 (RED+GREEN combined — Plan 01 already in place)
- **Files modified:** 3

## Accomplishments

- Added `instructions.parser.test.ts` with 8 test cases: global instructions file (no frontmatter), global + per-file sorted alphabetically, description-over-applyTo priority, missing `.github/` directory (ENOENT), per-file only when global file absent, compound extension filter (`.instructions.md` vs `.md`), null extractFrontmatter path, and multi-file alphabetical sort
- Added `prompts.parser.test.ts` with 7 test cases: `.prompt.md` with frontmatter (description + mode), no frontmatter (undefined description/mode), missing `.github/prompts/` directory, plain `.md` exclusion (compound extension filter), `agent` field fallback when `mode` absent, `mode` priority over `agent`, and multi-file alphabetical sort
- Extended `vitest.config.ts` include glob to pick up co-located adapter tests at `src/adapters/**/*.test.ts` alongside `src/test/unit/**/*.test.ts`
- All 309 tests pass (294 pre-existing + 15 new)

## Task Commits

Each task was committed atomically:

1. **Task: RED+GREEN — Write test files and verify GREEN** - `63a5f10` (test)

**Plan metadata:** (docs commit follows)

_Note: TDD tasks may have multiple commits (test then feat then refactor). Since Plan 01 implementations were already in place, tests went GREEN on first run._

## Files Created/Modified

- `src/adapters/copilot/parsers/instructions.parser.test.ts` - 8-case test suite for parseCopilotInstructions using real FileIOService on tmpdir
- `src/adapters/copilot/parsers/prompts.parser.test.ts` - 7-case test suite for parseCopilotPrompts using real FileIOService on tmpdir
- `vitest.config.ts` - Extended include glob to discover co-located adapter tests

## Decisions Made

- Extended vitest.config.ts to include `src/adapters/**/*.test.ts` glob so co-located test files alongside parsers are discovered without relocating them to `src/test/unit/`
- Tests went GREEN immediately because Plan 01 implementations were already correct; no RED-phase iteration was needed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended vitest.config.ts to discover co-located adapter tests**
- **Found during:** Task (TDD RED phase — running npm test after creating test files)
- **Issue:** vitest.config.ts only included `src/test/unit/**/*.test.ts`; test files placed at `src/adapters/copilot/parsers/` per plan's `files_modified` spec were not discovered by vitest, showing 294 tests unchanged
- **Fix:** Added `src/adapters/**/*.test.ts` to vitest `include` array so co-located tests run alongside unit tests
- **Files modified:** vitest.config.ts
- **Verification:** `npm run test:unit` shows 16 test files, 309 tests (15 new ones all passing)
- **Committed in:** 63a5f10 (combined with test files)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking)
**Impact on plan:** Necessary to make tests discoverable without relocating files from plan-specified paths. No scope creep.

## Issues Encountered

None beyond the vitest config gap documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Both parser test suites are complete and GREEN
- Phase 22 Plan 01 implementations (instructions.parser.ts, prompts.parser.ts) are fully verified by tests
- Phase 22 can proceed to Plan 03 (if any) for Copilot adapter integration or further features

---
*Phase: 22-custom-instructions-and-prompts*
*Completed: 2026-02-23*
