---
phase: 22-custom-instructions-and-prompts
plan: 03
subsystem: adapter
tags: [copilot, custom-prompt, instructions, vscode, file-picker, delete]

# Dependency graph
requires:
  - phase: 22-01
    provides: CopilotAdapter.readTools() for CustomPrompt, parseCopilotInstructions and parseCopilotPrompts, ToolType.CustomPrompt support
provides:
  - CopilotAdapter.removeTool() handles ToolType.CustomPrompt via fs.rm(tool.source.filePath)
  - ack.installInstructionFromFile command registered in tool-tree.management.ts and package.json
  - ack.deletePrompt command confirmed to work for Copilot (no adapter guard — rm(filePath) works for both)
affects:
  - 22-04 (installInstruction method on CopilotAdapter)
  - 23 (Skill/agent file management)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dynamic fs/promises import pattern for file ops in management.ts commands"
    - "CopilotPaths imported dynamically inside command handler to avoid adapter boundary violation"
    - "File extension validation (.instructions.md or .prompt.md) before install"

key-files:
  created: []
  modified:
    - src/adapters/copilot/copilot.adapter.ts
    - src/views/tool-tree/tool-tree.management.ts
    - package.json

key-decisions:
  - "deletePromptCmd has no adapter guard — rm(tool.source.filePath) works identically for both Codex and Copilot, no change needed"
  - "installInstructionCmd routes to .github/instructions/ or .github/prompts/ based on filename extension (.instructions.md vs .prompt.md)"
  - "package.json when-clause uses viewItem == group:custom_prompt without adapter id check — command handler performs the copilot guard and shows error message (same pattern as other commands)"
  - "removeTool CustomPrompt branch skips ensureWriteServices' configService — fs.rm is a direct Node.js call, not routed through ConfigService"

patterns-established:
  - "Adapter method extension pattern: add new ToolType branch before the catch-all throw, use early return"

requirements-completed: [INST-05, INST-06]

# Metrics
duration: 15min
completed: 2026-02-23
---

# Phase 22 Plan 03: Delete and File-Picker Install for Copilot Instruction/Prompt Files Summary

**CopilotAdapter.removeTool() extended for CustomPrompt via fs.rm, and ack.installInstructionFromFile file-picker command wired in management.ts and package.json**

## Performance

- **Duration:** 15 min
- **Started:** 2026-02-23T16:20:00Z
- **Completed:** 2026-02-23T16:26:47Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- CopilotAdapter.removeTool() now handles ToolType.CustomPrompt by calling fs.rm(tool.source.filePath) directly
- ack.installInstructionFromFile command registered — Copilot-only file picker with extension validation and overwrite confirmation
- package.json updated with command entry (title, icon) and two view/item/context menu entries for group:custom_prompt
- 309 unit tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement removeTool for CustomPrompt in CopilotAdapter** - `3fa029b` (feat)
2. **Task 2: Extend deletePrompt command + add installInstructionFromFile command** - `f647808` (feat)
3. **Task 3: Register command and menu entries in package.json** - `95beb97` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified
- `src/adapters/copilot/copilot.adapter.ts` - removeTool() extended with CustomPrompt branch using fs.rm
- `src/views/tool-tree/tool-tree.management.ts` - installInstructionCmd added with file picker, validation, CopilotPaths routing, and subscriptions push
- `package.json` - ack.installInstructionFromFile command entry + two view/item/context menu entries for group:custom_prompt

## Decisions Made
- `deletePromptCmd` had no adapter guard — `rm(tool.source.filePath)` works identically for Codex (~/.codex/prompts/) and Copilot (.github/instructions/ or .github/prompts/). No change required.
- `installInstructionCmd` routes files to `.github/instructions/` for `.instructions.md` extension and `.github/prompts/` for `.prompt.md` extension, using CopilotPaths imported dynamically to avoid ESLint adapter boundary violation.
- package.json `when` clause uses only `viewItem == group:custom_prompt` — the command handler itself enforces the `adapter.id === 'copilot'` guard and shows an error for non-Copilot agents. Consistent with existing command patterns in this codebase.

## Deviations from Plan

None — plan executed exactly as written.

The plan correctly anticipated that deletePromptCmd would have no adapter guard. Confirmed on reading the actual implementation: the command uses `rm(tool.source.filePath)` directly without any adapter id check, so no change was needed.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness
- Phase 22 Plan 04 can now implement the `installInstruction` method on CopilotAdapter (file copy from marketplace or picker into .github/ dirs)
- Both INST-05 (delete) and INST-06 (preview + delete guard) requirements satisfied
- Preview already worked via ack.openToolSource returning 'markdown' for CustomPrompt — no code change was needed there

---
*Phase: 22-custom-instructions-and-prompts*
*Completed: 2026-02-23*

## Self-Check: PASSED

- FOUND: src/adapters/copilot/copilot.adapter.ts
- FOUND: src/views/tool-tree/tool-tree.management.ts
- FOUND: package.json
- FOUND: .planning/phases/22-custom-instructions-and-prompts/22-03-SUMMARY.md
- FOUND commit: 3fa029b (Task 1)
- FOUND commit: f647808 (Task 2)
- FOUND commit: 95beb97 (Task 3)
