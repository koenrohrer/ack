# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-18)

**Core value:** Developers can discover, install, configure, and switch between sets of agent tools without leaving VS Code or touching config files manually.
**Current focus:** v1.2 Copilot Support — Phase 24 (Agent-Scoped Profiles)

## Current Position

Phase: 24 of 25
Plan: 2 of 2 in current phase
Status: Phase 24 complete — UX-04 and UX-05 verified end-to-end in Extension Development Host; Copilot profile create/switch/delete/export/import all confirmed working
Last activity: 2026-02-24 — Phase 24 Plan 02 executed (human verification of Copilot agent-scoped profiles)

Progress: v1.1 complete (53/53 plans). v1.2: Phase 20 complete (2/2 plans). Phase 21: 4 plans complete (phase complete). Phase 22: 4 plans complete (phase complete). Phase 23: 3/3 plans complete (phase complete). Phase 24: 2/2 plans complete (phase complete).

## Milestone History

- v1.0 MVP -- Shipped 2026-02-03 (11 phases, 33 plans)
- v1.1 Codex Support -- Shipped 2026-02-18 (9 phases, 22 plans)

## Accumulated Context

### Decisions

All decisions logged in PROJECT.md Key Decisions table.

Recent decisions affecting v1.2:
- CopilotAdapter fits IPlatformAdapter exactly — no interface changes needed
- Detection via `vscode.extensions.getExtension('GitHub.copilot')` (not filesystem)
- MCP schema uses `servers` key (not `mcpServers`) — must be defined independently
- `inputs` array must be preserved on write (modeled explicitly in Zod schema)
- Phase 20 must land before any other v1.2 phase — ESLint boundary and marketplace conditional fix are prerequisites

Phase 20 execution decisions (2026-02-21):
- vsCodeUserDir derived at construction time via path.dirname(path.dirname(context.globalStorageUri.fsPath))
- getMcpFilePath fully implemented using CopilotPaths so Phase 21 reads immediately
- getMcpSchemaKey returns 'copilot-mcp' — schema registration deferred to Phase 21
- Scaffold read methods return Promise.resolve([]) without routing
- Scaffold write methods throw Error with Phase 21+ reference
- adapter.id === 'copilot' id-check used directly in QuickPick loop (convention-based, no interface change)
- CONFIG_DIR_LABELS Record<string, string> lookup map replaces two-way ternary in marketplace promptForScope
- copilot boundary guard ignores src/adapters/copilot/** (same pattern as claude-code and codex)

Phase 21 Plan 01 execution decisions (2026-02-21):
- inputs array modeled explicitly in CopilotMcpFileSchema (not via passthrough) to survive read-mutate-validate-write cycles
- transport metadata mapped from config.type (Copilot's field name), not config.transport (Claude Code's name)
- Both writer mutators return { ...current, servers } — spread current first — to preserve inputs on write-back
- No toggleCopilotMcpServer — Copilot has no server-level disable mechanism

Phase 21 Plan 02 execution decisions (2026-02-21):
- getJsonPath uses source.filePath heuristic to detect Copilot: endsWith('mcp.json') + (.vscode OR Code/User OR Code\\User)
- getJsonPath Pick extended to include 'source' — callers pass full NormalizedTool so no call site updates required
- copilotSchemas registered at startup in extension.ts alongside claudeCodeSchemas and codexSchemas
- writeTool Phase 21+ stub left in place — writeTool is not in scope for Phase 21

Phase 21 Plan 03 execution decisions (2026-02-21):
- Tests use real services (FileIOService, SchemaService, ConfigService, BackupService) on tmpdir — consistent with parsers.test.ts and writers.test.ts patterns
- copilotSchemas (not claudeCodeSchemas) registered in test SchemaService — schema-specific isolation
- Tests went GREEN immediately (Plan 01 implementations were correct); no RED phase iteration needed

Phase 21 Plan 04 execution decisions (2026-02-21):
- detect() checks GitHub.copilot OR GitHub.copilot-chat — users may have only the chat extension installed; checking both ensures Copilot appears for all valid installs

Phase 22 Plan 01 execution decisions (2026-02-23):
- instructionKind metadata ('global', 'file-pattern', 'prompt') distinguishes kinds for future tree rendering
- Codex project scope guard: APPLICABLE_SCOPES now queries Project for CustomPrompt; CodexAdapter returns [] for project scope (existing guard) — no CodexAdapter changes needed
- YAML array tools field in prompt frontmatter intentionally skipped — extractFrontmatter handles flat k:v only; acceptable for Phase 22
- parseCopilotPrompts prefers 'mode' over 'agent' field name — Copilot uses both for the same concept

Phase 22 Plan 02 execution decisions (2026-02-23):
- vitest.config.ts extended to include src/adapters/**/*.test.ts glob for co-located adapter tests
- Tests for instructions and prompts parsers went GREEN immediately (Plan 01 implementations were correct)

Phase 22 Plan 03 execution decisions (2026-02-23):
- deletePromptCmd has no adapter guard — rm(tool.source.filePath) works identically for Codex and Copilot, no change needed
- installInstructionCmd routes to .github/instructions/ or .github/prompts/ based on filename extension (.instructions.md vs .prompt.md)
- package.json when-clause uses viewItem == group:custom_prompt without adapter id check — command handler enforces copilot guard (same pattern as other commands)
- removeTool CustomPrompt branch uses fs.rm directly — does not need configService (skips ensureWriteServices route through ConfigService)

Phase 24 Plan 02 execution decisions (2026-02-24):
- UX-04 and UX-05 verified in running Extension Development Host — no code changes needed at verification checkpoint
- Profile scoping confirmed: Copilot profiles invisible when Claude Code or Codex is active; agent switcher change correctly filters getProfiles() by agentId
- Known limitation accepted: switching a Copilot profile applies only Skill (user-invokable) state changes; MCP server entries are stored in snapshot but silently skipped during switch (by design)
- Export file confirmed to use .copilot.ackprofile compound extension with agentId: copilot in bundle JSON

Phase 24 Plan 01 execution decisions (2026-02-24):
- toggleableToolTypes is optional on IToolAdapter — undefined means all types are toggleable (Claude Code, Codex unchanged; backward-compatible)
- Non-toggleable entries in switchProfile increment skipped (not incompatibleSkipped) — tools are supported but adapter has no toggle concept for that type
- CopilotAdapter.toggleableToolTypes contains only ToolType.Skill — McpServer and CustomPrompt have no enable/disable concept in Copilot

Phase 23 Plan 03 execution decisions (2026-02-23):
- installSkill() normalizes filenames to .agent.md: registry files arrive as SKILL.md but Copilot requires compound extension for agent discovery
- No ensureWriteServices() in installSkill — uses fileIO directly (consistent with installInstruction pattern)
- Human verification identified filename normalization issue during AGNT-03 — fixed inline before checkpoint approval

Phase 23 Plan 02 execution decisions (2026-02-23):
- Use tool.status === ToolStatus.Enabled for toggle direction in toggleTool(Skill) — isToggleDisable checks .disabled directory suffix for Skill type but agent files are not directories
- agents.writer.ts targeted string replacement: replace /^user-invokable:.*$/m in frontmatter slice; insert before closing --- if absent; prepend block if no frontmatter
- TDD test pattern: real fs.mkdtemp + real FileIOService (matches instructions.parser.test.ts)

Phase 23 Plan 01 execution decisions (2026-02-23):
- String-compare user-invokable frontmatter: `=== 'false'` (string) not boolean — extractFrontmatter returns strings
- Use .agent.md extension filter in listFiles — not .md — to exclude non-agent markdown files
- agents dir added as 5th path in getWatchPaths Project scope; 'agents' added to isRecursiveDir check in file-watcher.utils.ts
- id format: skill:project:{baseName} consistent with instruction:project: and prompt:project: patterns

Phase 22 Plan 04 execution decisions (2026-02-23):
- installInstruction is Copilot-specific (not on IInstallAdapter) — cast to CopilotAdapter at call site in marketplace.panel.ts; instanceof guard throws for non-Copilot adapters
- custom_prompt early-return before promptForScope: handleCustomPromptInstall private method avoids restructuring the existing promptForScope flow
- ack.activeAdapterId VS Code context key set in extension.ts on agent switch — command when-clauses filter by adapter ID so install commands don't appear simultaneously
- getWatchPaths extended with .github/copilot-instructions.md, .github/instructions/, .github/prompts/ so tree refreshes on file changes; 'instructions' added to recursive-dir list in file-watcher.utils.ts
- ack.toggleTool when-clause excludes tool:custom_prompt:* — custom prompt files have no enable/disable concept; toggle was surfacing "Toggle failed" error for all Copilot tools

### Roadmap Evolution

v1.0 roadmap archived to `.planning/milestones/v1.0-ROADMAP.md`
v1.0 requirements archived to `.planning/milestones/v1.0-REQUIREMENTS.md`
v1.1 roadmap archived to `.planning/milestones/v1.1-ROADMAP.md`
v1.1 requirements archived to `.planning/milestones/v1.1-REQUIREMENTS.md`

### Pending Todos

0 pending todos.

### Blockers/Concerns

Known tech debt from v1.1 (addressed in Phase 20 — now resolved):
- [RESOLVED] Marketplace `configDir` two-way conditional — replaced with CONFIG_DIR_LABELS lookup map
- [RESOLVED] ESLint boundary guard did not cover `**/adapters/copilot/*` — guard now covers all three adapters

Known gaps to validate during implementation:
- Phase 21: Verify `FileWatcherManager` handles non-existent `.vscode/` at extension activate
- Phase 21: Confirm Windows CI handles `APPDATA` fallback in `getVSCodeUserDir()`
- Phase 22/23: Confirm `extractFrontmatter()` handles files with no `---` delimiters
- Phase 24/25: Non-default VS Code profiles use UUID-based paths not derivable from current API — support default profile only, emit warning for non-default

## Session Continuity

Last session: 2026-02-24
Stopped at: Completed 24-agent-scoped-profiles/24-02-PLAN.md (human verification — UX-04 and UX-05 confirmed end-to-end; Phase 24 complete)
Resume file: None
