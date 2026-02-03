# Requirements: Agent Config Keeper

**Defined:** 2026-02-01
**Core Value:** Developers can discover, install, configure, and switch between sets of agent tools without leaving VS Code

## v1 Requirements

### Foundation

- [x] **CORE-01**: Extension reads and parses all Claude Code config file types (skills `SKILL.md` in `~/.claude/skills/<skill>/` and `.claude/skills/<skill>/`, slash commands in `.claude/commands/`, hooks in settings files, MCP in `~/.claude.json` and `.mcp.json`, and managed settings/MCP files)
- [x] **CORE-02**: Extension writes config files with atomic writes and backup-before-write to prevent corruption
- [x] **CORE-03**: Extension validates config files against schemas before writing
- [x] **CORE-04**: Extension implements Claude Code adapter that maps agent-specific formats to normalized internal types
- [x] **CORE-05**: Extension supports user, project, local, and managed config scopes: `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, `~/.claude.json`, `.mcp.json`, plus managed settings/MCP files in system locations

### Sidebar & Environment View

- [x] **SIDE-01**: User can see installed tools in a sidebar tree view grouped by type (Skills, MCP, Hooks, Commands)
- [x] **SIDE-02**: User can expand each tool group to see file/directory structure (skill directories with files, hook types with commands)
- [x] **SIDE-03**: User can click an .md file in the tree to preview its contents
- [x] **SIDE-04**: Sidebar header shows current profile name (or "Current Environment" if no profile active)
- [x] **SIDE-05**: Each tool shows status indicator (enabled/disabled/error)
- [x] **SIDE-06**: Each tool shows scope indicator (global or project-level)

### Tool Management

- [x] **TOOL-01**: User can enable or disable individual tools via toggle
- [ ] **TOOL-02**: User can install a new tool by clicking install which opens the marketplace filtered to that tool type
- [x] **TOOL-03**: User can uninstall/delete a tool from their environment
- [x] **TOOL-04**: User can set a tool's scope as global or per-project

### Marketplace

- [x] **MRKT-01**: User can browse available tools in a searchable marketplace panel
- [x] **MRKT-02**: User can filter marketplace listings by tool type (skills, MCP, hooks, commands)
- [x] **MRKT-03**: User can install a tool from the marketplace with one click
- [x] **MRKT-04**: Marketplace sources tools from a GitHub-based community registry
- [x] **MRKT-05**: User can view tool descriptions and README content before installing

### Profile System

- [x] **PROF-01**: User can create, edit, and delete named profiles (preset collections of enabled tools)
- [x] **PROF-02**: User can switch between profiles from the sidebar or command palette
- [x] **PROF-03**: User can associate a profile with a workspace so it auto-activates when the project opens
- [x] **PROF-04**: User can import and export profiles as shareable files

### Configuration Panel

- [x] **CONF-01**: User can open a rich webview panel for managing all extension settings
- [x] **CONF-02**: User can manage profiles (create/edit/delete/switch) within the configuration panel
- [x] **CONF-03**: User can edit per-tool settings (e.g., MCP server environment variables) within the configuration panel

## v2 Requirements

### Multi-Agent Support

- **AGENT-01**: Extension supports Cursor agent tools alongside Claude Code
- **AGENT-02**: Extension supports GitHub Copilot agent tools alongside Claude Code
- **AGENT-03**: Extension auto-detects which agents are installed and shows relevant tool types

### Advanced Marketplace

- **ADVMK-01**: Marketplace shows install counts and popularity indicators
- **ADVMK-02**: Marketplace supports curated collections (e.g., "Web Dev Essentials")
- **ADVMK-03**: Marketplace notifies user when installed tools have updates available
- **ADVMK-04**: Marketplace supports tool dependencies (installing tool A also installs required tool B)

### Advanced Profiles

- **ADVPR-01**: User can sync profiles across machines via VS Code Settings Sync
- **ADVPR-02**: Extension suggests tools based on detected project type

## Out of Scope

| Feature | Reason |
|---------|--------|
| Dedicated backend/API server | GitHub-based registry is sufficient for v1; avoids infrastructure burden |
| Ratings/reviews system | Defer until community grows; GitHub stars serve as proxy initially |
| Tool authoring/publishing from extension | Contributors use GitHub directly; keeps extension focused on consumption |
| Real-time collaboration on profiles | Not a team tool for v1; import/export covers sharing |
| Running/executing agent tools | Extension manages config only; the agent itself runs tools |
| OAuth-based marketplace accounts | No user accounts needed; GitHub handles identity for contributors |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | Phase 1 | Complete |
| CORE-02 | Phase 1 | Complete |
| CORE-03 | Phase 1 | Complete |
| CORE-04 | Phase 1 | Complete |
| CORE-05 | Phase 1 | Complete |
| SIDE-01 | Phase 2 | Complete |
| SIDE-02 | Phase 2 | Complete |
| SIDE-03 | Phase 2 | Complete |
| SIDE-04 | Phase 2 | Complete |
| SIDE-05 | Phase 2 | Complete |
| SIDE-06 | Phase 2 | Complete |
| TOOL-01 | Phase 3 | Complete |
| TOOL-02 | Phase 3, 10 | Partial |
| TOOL-03 | Phase 3 | Complete |
| TOOL-04 | Phase 3 | Complete |
| MRKT-01 | Phase 4 | Complete |
| MRKT-02 | Phase 4 | Complete |
| MRKT-03 | Phase 5 | Complete |
| MRKT-04 | Phase 4 | Complete |
| MRKT-05 | Phase 4 | Complete |
| PROF-01 | Phase 6 | Complete |
| PROF-02 | Phase 6 | Complete |
| PROF-03 | Phase 8 | Complete |
| PROF-04 | Phase 8 | Complete |
| CONF-01 | Phase 7 | Complete |
| CONF-02 | Phase 7 | Complete |
| CONF-03 | Phase 7 | Complete |

**Coverage:**
- v1 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0

---
*Requirements defined: 2026-02-01*
*Last updated: 2026-02-03 after v1 milestone audit gap closure*
