# Roadmap: Agent Config Keeper

## Overview

This roadmap delivers a VS Code extension that lets developers discover, install, configure, and switch between sets of Claude Code agent tools from a unified sidebar and marketplace. The phases progress from config file I/O (the foundation everything depends on) through the sidebar environment view, tool management actions, the GitHub-backed marketplace, one-click installation, profile switching, the rich configuration panel, and finally profile portability. Each phase delivers an incrementally usable capability that builds on the previous.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Extension Scaffold & Config I/O** - Project setup, config file reading/writing, and the Claude Code adapter
- [x] **Phase 2: Sidebar Environment View** - Tree view showing installed tools grouped by type with status and scope
- [x] **Phase 3: Tool Management** - Enable/disable, delete, and scope controls for individual tools
- [x] **Phase 4: Marketplace Registry & Discovery** - GitHub registry integration, searchable marketplace webview with filtering
- [x] **Phase 5: One-Click Install** - Install tools from the marketplace into the local environment
- [x] **Phase 6: Profile System** - Named profiles for switching between tool sets
- [x] **Phase 7: Configuration Panel** - Rich webview panel for managing extension settings and per-tool configuration
- [x] **Phase 8: Profile Portability & Polish** - Import/export profiles and workspace-profile association
- [x] **Phase 9: GitHub Search Discovery** - Repo URL scanner for discovering tools in user-added GitHub repos by file patterns
- [ ] **Phase 10: Sidebar Install Routing & Tracking Cleanup** - Wire sidebar install button to marketplace with type filter, fix stale tracking

## Phase Details

### Phase 1: Extension Scaffold & Config I/O
**Goal**: The extension can read, validate, and safely write all Claude Code config file types across global and project scopes
**Depends on**: Nothing (first phase)
**Requirements**: CORE-01, CORE-02, CORE-03, CORE-04, CORE-05
**Success Criteria** (what must be TRUE):
  1. Extension activates in VS Code without errors and registers its contribution points
  2. Extension reads and correctly parses skills (`SKILL.md` in `~/.claude/skills/<skill>/` and `.claude/skills/<skill>/`), slash commands in `.claude/commands/`, hooks in settings files (`~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, managed settings), and MCP servers in `~/.claude.json`, `.mcp.json`, and managed-mcp.json
  3. Extension writes config files using atomic write (write-to-temp-then-rename) with backup-before-write, and validates against schemas before writing
  4. A ClaudeCodeAdapter class maps all Claude Code-specific formats to normalized internal types, and no other module references Claude Code file paths directly
  5. Extension correctly distinguishes and reads from user, project, local, and managed config scopes (settings, MCP, skills/commands as applicable)
**Plans**: 4 plans

Plans:
- [x] 01-01-PLAN.md -- VS Code extension scaffold, types, utilities, and build tooling
- [x] 01-02-PLAN.md -- FileIOService, BackupService, SchemaService, and Zod schemas
- [x] 01-03-PLAN.md -- ClaudeCodeAdapter with all parsers and AdapterRegistry
- [x] 01-04-PLAN.md -- ConfigService with scope resolution and extension wiring

### Phase 2: Sidebar Environment View
**Goal**: Users can see their full Claude Code tool inventory in a sidebar tree, grouped by type, with file preview and status indicators
**Depends on**: Phase 1
**Requirements**: SIDE-01, SIDE-02, SIDE-03, SIDE-04, SIDE-05, SIDE-06
**Success Criteria** (what must be TRUE):
  1. User sees a sidebar tree view with top-level groups for Skills, MCP Servers, Hooks, and Commands, each expandable to show individual tools and their file/directory structure
  2. User can click any .md file in the tree to open a read-only preview of its contents in an editor tab
  3. Sidebar header displays the current profile name, or "Current Environment" when no profile is active
  4. Each tool in the tree shows a status indicator (enabled, disabled, or error) and a scope badge (global or project)
  5. Tree auto-refreshes when config files change externally (e.g., edited in terminal or by Claude Code)
**Plans**: 3 plans

Plans:
- [x] 02-01-PLAN.md -- Tree node types, model, provider, SVG icons, and package.json manifest
- [x] 02-02-PLAN.md -- File preview commands (markdown preview, JSON scroll-to-key with highlight)
- [x] 02-03-PLAN.md -- FileWatcherManager with debounced refresh and extension.ts wiring

### Phase 3: Tool Management
**Goal**: Users can enable, disable, delete, and change the scope of individual tools from the sidebar
**Depends on**: Phase 2
**Requirements**: TOOL-01, TOOL-02, TOOL-03, TOOL-04
**Success Criteria** (what must be TRUE):
  1. User can toggle a tool between enabled and disabled states via a context menu or inline action, and the underlying config file is updated immediately
  2. User can delete/uninstall a tool, which removes its files and config entries, with a confirmation prompt
  3. User can change a tool's scope between global and project-level, and the tool's config entries move to the appropriate location
  4. Sidebar tree reflects all management actions immediately without manual refresh
**Plans**: 3 plans

Plans:
- [x] 03-01-PLAN.md -- Adapter writer modules (settings, MCP, skill, command) and ClaudeCodeAdapter writeTool/removeTool implementation
- [x] 03-02-PLAN.md -- ToolManagerService with toggle/delete/move orchestration, type-aware utils, and unit tests
- [x] 03-03-PLAN.md -- package.json context menus, inline actions, Move To submenu, command handlers, and extension.ts wiring

### Phase 4: Marketplace Registry & Discovery
**Goal**: Users can browse, search, and filter available tools in a marketplace panel backed by a GitHub registry
**Depends on**: Phase 1
**Requirements**: MRKT-01, MRKT-02, MRKT-04, MRKT-05
**Success Criteria** (what must be TRUE):
  1. User can open a Marketplace panel that displays available tools fetched from a GitHub-based community registry
  2. User can search tools by name or keyword, and results update as they type
  3. User can filter marketplace listings by tool type (skills, MCP servers, hooks, commands) using tabs or a dropdown
  4. User can click a tool listing to view its full description, README content, and metadata before deciding to install
  5. Marketplace data is cached locally with ETag-based revalidation, so browsing does not exhaust GitHub API rate limits
**Plans**: 3 plans

Plans:
- [x] 04-01-PLAN.md -- RegistryService with GitHub fetch, ETag caching, multi-source support, and unit tests
- [x] 04-02-PLAN.md -- Marketplace webview scaffold (React, dual esbuild, typed messages, CSP, state persistence)
- [x] 04-03-PLAN.md -- All UI components (search, type tabs, sort, card grid, pagination, detail view) and RegistryService wiring

### Phase 5: One-Click Install
**Goal**: Users can install any tool from the marketplace into their environment with a single click
**Depends on**: Phase 3, Phase 4
**Requirements**: MRKT-03
**Success Criteria** (what must be TRUE):
  1. User can click "Install" on a marketplace listing and the tool is downloaded, placed in the correct location, and registered in the appropriate config file without manual steps
  2. If a tool requires configuration (e.g., MCP server API keys), the user is prompted for required values during install
  3. User sees progress feedback during install and a clear success or error message on completion
  4. After install, the tool appears immediately in the sidebar tree as enabled
**Plans**: 3 plans

Plans:
- [x] 05-01-PLAN.md -- InstallService orchestrator, install types/manifest schema, RegistryService extension
- [x] 05-02-PLAN.md -- Webview install UI (message protocol, InstallButton, ConfigForm, install state tracking)
- [x] 05-03-PLAN.md -- MarketplacePanel install handlers, scope prompt, uninstall, extension.ts wiring, checkpoint

### Phase 6: Profile System
**Goal**: Users can create named profiles (preset tool collections) and switch between them to manage their agent context
**Depends on**: Phase 3
**Requirements**: PROF-01, PROF-02
**Success Criteria** (what must be TRUE):
  1. User can create a new named profile by selecting which currently-installed tools should be included
  2. User can edit an existing profile to add or remove tools, and rename or delete profiles
  3. User can switch to a different profile from the sidebar header or the command palette, and the switch enables/disables the correct tools within seconds
  4. Sidebar header updates to show the active profile name after switching
**Plans**: 3 plans

Plans:
- [x] 06-01-PLAN.md -- Profile types, Zod schemas, canonical key utility, and ProfileService CRUD with globalState persistence
- [x] 06-02-PLAN.md -- Profile switching (diff-based batch toggle) and command palette command handlers
- [x] 06-03-PLAN.md -- Sidebar profile selector, extension.ts wiring, and end-to-end checkpoint

### Phase 7: Configuration Panel
**Goal**: Users can manage all extension settings, profiles, and per-tool configuration in a rich webview panel
**Depends on**: Phase 6
**Requirements**: CONF-01, CONF-02, CONF-03
**Success Criteria** (what must be TRUE):
  1. User can open a "Configure Agent" webview panel from the sidebar or command palette
  2. User can manage profiles (create, edit, delete, switch) entirely within the configuration panel without using context menus
  3. User can edit per-tool settings (e.g., MCP server environment variables, hook trigger conditions) within the configuration panel, and changes are written to the correct config files
  4. Configuration panel preserves its state when the tab is hidden and restored (no blank panel on tab switch)
**Plans**: 3 plans

Plans:
- [x] 07-01-PLAN.md -- Config panel scaffold: singleton panel host, typed messages, esbuild multi-entry, React shell with tabs
- [x] 07-02-PLAN.md -- Profile management UI: profile list CRUD, switching, tool selection editor
- [x] 07-03-PLAN.md -- Per-tool settings editor: MCP env var form with write-back, read-only views, checkpoint

### Phase 8: Profile Portability & Polish
**Goal**: Users can share profiles across machines and projects, and profiles auto-activate per workspace
**Depends on**: Phase 6
**Requirements**: PROF-03, PROF-04
**Success Criteria** (what must be TRUE):
  1. User can export a profile to a JSON file that can be shared or checked into version control
  2. User can import a profile from a JSON file, and any referenced tools not yet installed are flagged clearly
  3. User can associate a profile with a workspace so it auto-activates when that project is opened in VS Code
  4. When opening a workspace with an associated profile, the correct tools are enabled/disabled automatically without user intervention
**Plans**: 2 plans

Plans:
- [x] 08-01-PLAN.md -- Export/import types, ProfileService bundle methods, command palette and config panel integration
- [x] 08-02-PLAN.md -- WorkspaceProfileService, auto-activation hook, association commands, and end-to-end checkpoint

### Phase 9: GitHub Search Discovery
**Goal**: Marketplace search fans out across public GitHub repos to discover compatible tools (skills, MCP servers, hooks, commands, presets, profiles) by matching known file patterns and naming conventions, with results appearing alongside registry results
**Depends on**: Phase 4
**Requirements**: TBD
**Success Criteria** (what must be TRUE):
  1. When a user searches in the marketplace, results include tools discovered from public GitHub repos — not just the curated registry
  2. GitHub search uses file pattern matching (e.g., SKILL.md, .mcp.json, tool-manifest.json) and naming conventions to identify compatible tools
  3. GitHub-discovered results appear seamlessly alongside registry results in the same grid, with a source indicator distinguishing them
  4. Search respects GitHub API rate limits (authenticated if token available, caching, debounce)
**Plans**: 4 plans

Plans:
- [x] 09-01-PLAN.md -- GitHubSearchService with auth, dual search strategy, rate limiting, and caching
- [x] 09-02-PLAN.md -- Message protocol extensions, MarketplacePanel fan-out search, relevance scoring
- [x] 09-03-PLAN.md -- Webview UI: GitHub toggle, badge, enhanced search, interleaved grid, detail view
- [x] 09-04-PLAN.md -- Pivot: replace GitHub Search API with repo URL scanner and end-to-end verification

### Phase 10: Sidebar Install Routing & Tracking Cleanup
**Goal**: Close the remaining TOOL-02 gap and fix stale tracking in REQUIREMENTS.md and Phase 9 roadmap criteria
**Depends on**: Phase 5 (marketplace install exists), Phase 9 (roadmap criteria to update)
**Requirements**: TOOL-02
**Gap Closure**: Closes gaps from v1 milestone audit
**Success Criteria** (what must be TRUE):
  1. Sidebar "Install" button opens the marketplace webview pre-filtered to the relevant tool type (e.g., clicking install on Skills group opens marketplace with Skills tab active)
  2. REQUIREMENTS.md traceability table reflects actual implementation status for all 27 requirements (no stale "Pending" rows)
  3. Phase 9 roadmap success criteria accurately describe the repo URL scanner (not the deleted GitHub Search API)
**Plans**: 1 plan

Plans:
- [ ] 10-01-PLAN.md -- Wire sidebar install to marketplace with type filter, update REQUIREMENTS.md and Phase 9 criteria

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10
Note: Phase 4 depends on Phase 1 (not Phase 3), so Phases 3 and 4 could theoretically run in parallel.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Extension Scaffold & Config I/O | 4/4 | Complete | 2026-02-01 |
| 2. Sidebar Environment View | 3/3 | Complete | 2026-02-01 |
| 3. Tool Management | 3/3 | Complete | 2026-02-01 |
| 4. Marketplace Registry & Discovery | 3/3 | Complete | 2026-02-02 |
| 5. One-Click Install | 3/3 | Complete | 2026-02-02 |
| 6. Profile System | 3/3 | Complete | 2026-02-02 |
| 7. Configuration Panel | 3/3 | Complete | 2026-02-02 |
| 8. Profile Portability & Polish | 2/2 | Complete | 2026-02-02 |
| 9. GitHub Search Discovery | 4/4 | Complete | 2026-02-02 |
| 10. Sidebar Install Routing & Tracking Cleanup | 0/1 | Pending | — |
