# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-01)

**Core value:** Developers can discover, install, configure, and switch between sets of agent tools without leaving VS Code
**Current focus:** Phase 10 — close TOOL-02 gap and fix stale tracking from v1 audit.

## Current Position

Phase: 10 of 10 (Sidebar Install Routing & Tracking Cleanup)
Plan: 0 of 1 in current phase
Status: Planning
Last activity: 2026-02-03 -- Created Phase 10 from milestone audit gaps

Progress: [█████████░] 90%

## Performance Metrics

**Velocity:**
- Total plans completed: 27
- Average duration: 5m
- Total execution time: 153m

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 4/4 | 14m | 4m |
| 02 | 3/3 | 12m | 4m |
| 03 | 3/3 | 12m | 4m |
| 04 | 3/3 | 18m | 6m |
| 05 | 3/3 | 25m | 8m |
| 06 | 3/3 | 21m | 7m |
| 07 | 3/3 | 17m | 6m |
| 08 | 2/2 | 12m | 6m |
| 09 | 4/4 | 14m | 4m |

**Recent Trend:**
- Last 5 plans: 08-02 (8m with checkpoint), 09-01 (4m), 09-02 (5m), 09-03 (5m)
- Trend: autonomous plans completing in ~4-5m, checkpoint plans ~8m

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: 9 phases (originally 8, Phase 9 added for GitHub search discovery)
- [Roadmap]: 8 phases derived from 27 requirements at comprehensive depth
- [Roadmap]: Phase 4 (Marketplace) depends on Phase 1 only, not Phase 3, enabling parallel work if needed
- [01-01]: Used ESLint 9 flat config (eslint.config.mjs) instead of legacy .eslintrc.json
- [01-01]: @types/write-file-atomic pinned to ^4.0.3 (latest available)
- [01-02]: Zod schemas use .passthrough() on all top-level objects to preserve unknown fields
- [01-02]: SchemaService uses string-based registry (decouples validation from platform-specific schemas)
- [01-02]: BackupService uses numbered suffix pattern (.bak.1-.bak.5) with shift-rotate
- [01-03]: ClaudeCodePaths uses getters for static paths, methods for workspace-relative paths
- [01-03]: Parsers accept FileIOService/SchemaService as params (DI over singletons)
- [01-03]: MCP disabled state resolved from both disabledMcpServers array and per-server disabled field
- [01-03]: readDisabledMcpServers exported separately; adapter orchestrates two-step MCP read
- [01-04]: Canonical key uses type:name for most tools, hooks use hook:event:matcher
- [01-04]: APPLICABLE_SCOPES as static map (tool type -> scope mapping is platform invariant)
- [01-04]: getServices() module-level export for cross-module service access
- [01-04]: Test command registered in contributes.commands for manual verification
- [02-01]: APPLICABLE_SCOPES/SCOPE_PRECEDENCE duplicated in model (private in ConfigService)
- [02-01]: Scope shown via composite SVG icon shape only, not text in description field
- [02-01]: Description field reserved for error messages and (active) indicator only
- [02-01]: MCP sub-tools show config details, not runtime MCP protocol tool lists
- [02-02]: Pure functions extracted to command-utils module to avoid VS Code import in unit tests
- [02-02]: Re-exported from commands module so consumers have a single import source
- [02-03]: Pure logic extracted to file-watcher.utils.ts for testability (matching command-utils pattern)
- [02-03]: Notification setting check lives in extension.ts callback, not in FileWatcherManager
- [02-03]: Skills/commands dirs watched recursively; config file dirs non-recursively
- [03-01]: IPlatformAdapter.removeTool accepts NormalizedTool instead of (toolId, type, scope)
- [03-01]: ConfigService and BackupService are optional constructor params on ClaudeCodeAdapter
- [03-01]: HookMatcherSchema gets .passthrough() to preserve custom disabled field
- [03-02]: ToolManagerService uses dynamic imports for writer modules to keep coupling loose
- [03-02]: getMcpFileInfo derives schema key from tool.source.filePath (endsWith .claude.json check)
- [04-01]: RegistryConfigReader interface injected via constructor for testability (DI over require)
- [04-01]: ETags not restored from globalState without cached index data (304 needs body)
- [04-02]: Separate tsconfig.webview.json for browser-target React JSX (incompatible with Node16 module resolution)
- [04-02]: eslint routes webview ts/tsx to webview tsconfig; .d.ts excluded from lint
- [04-02]: Main tsconfig.json excludes webview directory to prevent cross-contamination
- [04-03]: Markdown rendered client-side in webview with marked + DOMPurify (avoids jsdom in extension host)
- [04-03]: All filtering/sorting/pagination done client-side in useMarketplace hook (cached full list, no round-trips)
- [04-03]: Added forceRefresh parameter to RegistryService.fetchAllIndexes for user-initiated refresh
- [05-01]: Env merge order: manifest defaults < existing values < user-provided values
- [05-01]: Single-file commands write to commands dir; multi-file commands get subdirectory
- [05-01]: Runtime check is warn-but-allow (caller decides whether to proceed)
- [05-02]: Ref-based native event binding for vscode-textfield web components in ConfigForm
- [05-02]: InstalledToolInfo replaces string[] for scope-aware installed tool tracking
- [05-02]: ConfigForm cancel re-triggers install flow (scope picker reappears)
- [05-03]: normalizeToolName() for registry display name vs config name matching
- [05-03]: Stash-based hook toggle (_disabledHooks) replaces non-functional disabled:true field
- [05-03]: Parser reads _disabledHooks entries with ToolStatus.Disabled and metadata.stashed=true
- [05-03]: removeHook accepts stashed param for deleting disabled hooks
- [06-01]: canonicalKey() extracted to shared tool-key.utils.ts (prevents key format drift)
- [06-01]: ProfileService accepts Memento (not ExtensionContext) for testability
- [06-01]: loadStore() returns DEFAULT_PROFILE_STORE on Zod validation failure (defensive)
- [06-02]: Profile switch toggles execute sequentially (await in loop) to prevent race conditions
- [06-02]: registerProfileCommands accepts ConfigService directly for edit-tools multi-select
- [06-02]: saveAsProfile delegates to createProfile via vscode.commands.executeCommand
- [06-03]: registerManagementCommands accepts treeProvider for explicit refresh after toggle
- [06-03]: reconcileProfile() auto-prunes stale profile entries on display
- [06-03]: Skill/command parsers detect .disabled suffix for correct ToolStatus
- [06-03]: Auto-sync: toggle/delete operations persist to active profile automatically
- [06-03]: Exclusive profile switch: tools not in target profile get disabled
- [07-01]: Multi-entry esbuild uses shared config object with entries array (not separate scripts)
- [07-01]: Config panel webview excluded from main tsconfig.json (DOM vs Node16 lib conflict)
- [07-01]: Stub handlers log TODO and reply with operationError for unimplemented messages (fail-visible)
- [07-02]: New profiles start empty (createProfile + updateProfile with empty tools[])
- [07-02]: ProfileEditor tracks checkbox state locally for immediate feedback, saves on button click
- [07-02]: handleRequestProfileTools includes stale entries (not found) and available tools (not in profile)
- [07-03]: MCP settings read via ConfigService.readToolsByScope + metadata extraction
- [07-03]: MCP env write via ConfigService.writeConfigFile with deep-clone mutator
- [07-03]: window.confirm() unavailable in webviews -- delete confirmation moved to extension host
- [07-03]: ConfigPanel receives treeProvider for sidebar refresh on tool state changes
- [07-03]: Profile action buttons use text labels (not icon-only) for visibility
- [08-01]: Export produces minified JSON (no indentation) for smaller file size
- [08-01]: Import creates profile via createProfile+updateProfile pattern (consistent with 07-02)
- [08-01]: Zod v4 z.record() requires two args (key schema, value schema)
- [08-02]: Workspace association stored in .vscode/agent-profile.json (not settings.json)
- [08-02]: Association by profile name (not ID) for cross-machine portability
- [08-02]: Manual override tracked in globalState, stale overrides auto-cleared
- [08-02]: Profile name shown in treeView.title (not description) per user feedback
- [09-01]: Dynamic require('vscode') for GitHubSearchService testability (no top-level import)
- [09-01]: Dual search: repo search for broad queries, code search for type-filtered filename matching
- [09-01]: fetchGitHub returns unknown[] with call-site casting to avoid union type issues
- [09-01]: TOPIC_TO_TOOL_TYPE mapping as separate constant for repo-level heuristic detection
- [09-01]: GitHubRepoItem/GitHubCodeItem exported as typed shapes for GitHub API responses
- [09-02]: Relevance scoring: registry base 100, GitHub base 50 (curated vs discovered weighting)
- [09-02]: Separate data channels (registryData + githubResults) for independent lifecycle
- [09-02]: Map 'profile' detectedType to 'command' toolType for RegistryEntryWithSource compatibility
- [09-02]: No auto-trigger of GitHub browse from loadRegistryData (webview ready effect initiates)
- [09-03]: githubEnabled defaults true, NOT persisted (resets each webview mount)
- [09-03]: Popular sort uses relevanceScore (falls back to stars) for interleaved ranking
- [09-03]: SearchBar onChange for live registry filter, onSubmit for explicit GitHub search
- [09-03]: InstallButton hidden for GitHub-sourced tools; "View on GitHub" shown instead

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-02-03
Stopped at: Created Phase 10 from v1 milestone audit gaps. REQUIREMENTS.md tracking fixed. Ready to plan Phase 10.
Resume file: None
