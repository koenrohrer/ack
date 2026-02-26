---
phase: 25-marketplace-routing
plan: 02
subsystem: marketplace
tags: [zod, install-routing, copilot, custom_prompt, marketplace]

# Dependency graph
requires:
  - phase: 22-copilot-custom-prompts
    provides: CopilotAdapter.installInstruction method and handleCustomPromptInstall for repo-sourced tools
  - phase: 19-marketplace-adaptation
    provides: Agent-aware marketplace filtering, InstallService routing via getActiveAdapter()
provides:
  - custom_prompt in ToolManifest Zod schema (registry validation)
  - custom_prompt install route in InstallService
  - scope bypass for custom_prompt in marketplace panel handleRequestInstall
affects: [marketplace, registry]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "custom_prompt registry install: bypass promptForScope, always ConfigScope.Project"
    - "installCustomPrompt: dynamic CopilotAdapter import + instanceof guard (same pattern as handleCustomPromptInstall)"

key-files:
  created: []
  modified:
    - src/services/install.types.ts
    - src/services/install.service.ts
    - src/views/marketplace/marketplace.panel.ts

key-decisions:
  - "installCustomPrompt uses dynamic import for CopilotAdapter guard — matches existing handleCustomPromptInstall pattern"
  - "custom_prompt scope bypass routes through executeInstall with ConfigScope.Project — reuses existing install pipeline instead of duplicating adapter calls"
  - "MANIFEST_TYPE_TO_TOOL_TYPE extended with custom_prompt for conflict check support"

patterns-established:
  - "Registry custom_prompt install: scope bypass early return before promptForScope, delegate to InstallService which handles adapter guard"

requirements-completed: [UX-07]

# Metrics
duration: 2min
completed: 2026-02-26
---

# Phase 25 Plan 02: Marketplace Routing - Custom Prompt Install Route Summary

**Registry-sourced custom_prompt tools now pass Zod validation, route through InstallService to CopilotAdapter.installInstruction with project scope (no QuickPick)**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-26T05:21:49Z
- **Completed:** 2026-02-26T05:23:34Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Extended ToolManifest Zod schema to accept `custom_prompt` type, enabling registry-sourced instruction/prompt tools to pass validation
- Added `installCustomPrompt` method to InstallService with CopilotAdapter instanceof guard, fetching file content from registry and delegating to `adapter.installInstruction()`
- Bypassed scope QuickPick in marketplace panel `handleRequestInstall` for custom_prompt manifests, always using `ConfigScope.Project`

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend ToolManifest Zod enum and add InstallService custom_prompt route** - `a392a5a` (feat)
2. **Task 2: Add custom_prompt scope bypass in marketplace panel handleRequestInstall** - `31068e1` (feat)

## Files Created/Modified
- `src/services/install.types.ts` - Extended ToolManifest interface and Zod enum to include 'custom_prompt'
- `src/services/install.service.ts` - Added 'custom_prompt' case in install() switch and installCustomPrompt() private method
- `src/views/marketplace/marketplace.panel.ts` - Added custom_prompt early return before promptForScope; extended MANIFEST_TYPE_TO_TOOL_TYPE with custom_prompt

## Decisions Made
- `installCustomPrompt` uses dynamic import for CopilotAdapter guard: matches existing `handleCustomPromptInstall` pattern from Phase 22 (avoids static import circular dependency risk)
- custom_prompt scope bypass routes through `executeInstall` with `ConfigScope.Project`: reuses existing install pipeline instead of duplicating adapter calls inline
- `MANIFEST_TYPE_TO_TOOL_TYPE` extended with `custom_prompt: ToolType.CustomPrompt` to enable conflict checking for registry custom_prompt tools

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 25 Plan 02 completes UX-07 install routing for registry-sourced custom_prompt tools
- The existing repo-sourced custom_prompt path (handleCustomPromptInstall) continues to work unchanged
- All verification passes: compile clean, lint clean (pre-existing warning only), 322/322 unit tests pass

## Self-Check: PASSED

All files and commits verified.

---
*Phase: 25-marketplace-routing*
*Completed: 2026-02-26*
