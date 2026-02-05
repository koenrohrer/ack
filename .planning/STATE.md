# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-03)

**Core value:** Developers can discover, install, configure, and switch between sets of agent tools without leaving VS Code
**Current focus:** Phase 18 in progress. Plan 18-03 complete.

## Current Position

Phase: 18 of 19 (Agent-Scoped Profiles)
Plan: 3 of 4 in current phase
Status: In progress
Last activity: 2026-02-05 -- Completed 18-03-PLAN.md

Progress: [████████████████░] 94% (17/18 plans)

## Milestone History

- v1.0 MVP -- Shipped 2026-02-03 (11 phases, 33 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 49 (33 v1.0 + 16 v1.1)
- Average duration: 5m
- Total execution time: 257m

## Accumulated Context

### Decisions

All v1.0 decisions logged in PROJECT.md Key Decisions table.

Key research findings for v1.1:
- Critical: Claude Code imports leak through ToolManagerService, InstallService, MarketplacePanel, ConfigPanel -- RESOLVED in Phase 12
- Codex uses TOML config (~/.codex/config.toml), needs smol-toml library
- Custom prompts are .md files in ~/.codex/prompts/ (current feature, not deprecated)
- No Codex hook system exists -- hooks excluded from requirements
- Profiles must be agent-scoped with agentId field

Phase 12 decisions:
- IPlatformAdapter composed from 5 sub-interfaces (IToolAdapter, IMcpAdapter, IPathAdapter, IInstallAdapter, ILifecycleAdapter)
- Used `unknown[]` for installHook's hooks parameter, cast at adapter boundary
- ESLint no-restricted-imports enforces adapter boundary (excludes extension.ts + test files)
- Adapter errors propagate through service try/catch unchanged
- assertContained defense moved from InstallService to adapter layer

Phase 13 decisions (Plan 01):
- Lazy dynamic import for smol-toml (ESM-only) via cached loadToml() wrapper with local TomlModule interface
- TOML read/write methods mirror JSON equivalents exactly (same error handling, return types, atomic writes)

Phase 13 decisions (Plan 02):
- MCP server ID format mcp:codex:{scope}:{name} includes 'codex' segment to distinguish from Claude Code IDs
- Codex enabled:false inversion handled in parser, not adapter (single responsibility)
- Write stubs throw Error (not AdapterScopeError) since operations will be supported in future phases
- getMcpSchemaKey returns 'codex-config' for all scopes (MCP embedded in config, no separate file)

Phase 13 decisions (Plan 03):
- Detection logs all adapters individually before calling detectAndActivate
- Multiple-adapter detection logs Phase 14 message rather than failing
- Re-detect command resets codex config dismissal state to re-trigger notifications
- initCodexProject creates prompts/ and skills/ dirs alongside config.toml

Phase 14 decisions (Plan 01):
- globalState Memento for persisting active agent ID (consistent with profiles, ETags)
- $(copilot) codicon for status bar agent icon
- QuickPick always used for switching (even with 2 agents)
- Toast notification with action button for newly detected agents during re-detect

Phase 14 decisions (Plan 02):
- TreeView.description for agent name (title remains profile name)
- Non-dismissible banner with Refresh button only (no auto-refresh per CONTEXT.md)
- Inline styles using VS Code CSS variables for banner styling

Phase 15 decisions (Plan 01):
- Writer functions use local CodexConfig interface rather than importing from schemas.ts
- writeTool extracts metadata fields individually to avoid passing unknown keys into TOML
- toggleTool uses direct ToolStatus comparison (not isToggleDisable) since Codex uses enabled semantics

Phase 15 decisions (Plan 02):
- disabled_tools takes priority when tool name appears in both enabled_tools and disabled_tools
- Env var values always masked as '********' in tree (reveal via future context menu)
- Codex MCP server detection via ':codex:' segment in tool.id
- TOML navigation uses indexOf for table header search rather than full TOML parse

Phase 15 decisions (Plan 03):
- View-layer TOML mutations use configService.writeTomlConfigFile with local CodexConfig interface (not direct adapter writer imports) to respect ESLint boundary
- addMcpServer routes through adapter.installMcpServer() (public IPlatformAdapter API)
- revealEnvVar copies to clipboard rather than displaying secret in notification
- Command PATH validation uses execFile with --version and 5s timeout, warns non-blocking

Phase 16 decisions (Plan 01):
- Reuse parseSkillsDir from claude-code/parsers since SKILL.md format is identical between agents
- Cross-adapter parser imports allowed per ESLint boundary rules when formats are identical

Phase 16 decisions (Plan 02):
- Reuse skill.writer.ts functions from claude-code since skill filesystem structure is identical
- Toggle uses .disabled suffix on directory (matches Claude Code convention)

Phase 17 decisions (Plan 01):
- Custom prompts parsed as single .md files (not directories like skills)
- Alphabetical sort for prompts in tree (consistent with other tool types)
- User scope only for custom prompts (per CONTEXT.md)
- ID format prompt:codex:{scope}:{filename} for consistency

Phase 17 decisions (Plan 02):
- Delete prompts directly in command handler (not through ToolManagerService) for simplicity
- Dynamic import of CodexPaths in view layer to avoid adapter boundary violation
- Prompts directory uses recursive watching (same as skills/commands)

Phase 18 decisions (Plan 01):
- Migration runs at activation (fire-and-forget with error logging)
- v1 stores implicit (no version field), v2 explicit
- agentId='claude-code' for all migrated profiles

Phase 18 decisions (Plan 02):
- Direct globalState access for cross-agent profile creation in clone-to-agent
- Empty array return when no agent active for getProfiles()
- Profile operations fail gracefully (return undefined/false) for wrong-agent profiles

Phase 18 decisions (Plan 03):
- Export filename format: {sanitized-name}.{agent-id}.ackprofile
- v1 bundles rejected with re-export message (no legacy support)
- Agent mismatch triggers conversion modal with tool filtering stats

### Roadmap Evolution

v1.0 roadmap archived to `.planning/milestones/v1.0-ROADMAP.md`
v1.0 requirements archived to `.planning/milestones/v1.0-REQUIREMENTS.md`
v1.1 roadmap: 8 phases (12-19), 17 estimated plans, 34 requirements

### Pending Todos

0 pending todos.

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-02-05
Stopped at: Completed 18-03-PLAN.md. Ready for 18-04-PLAN.md.
Resume file: None
