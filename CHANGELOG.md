# Changelog

All notable changes to ACK are documented here.

---

## 1.2.5

UX improvement for the profile switcher empty state.

### Improved

- Switch Profile now prompts to create a profile when none exist, with a "Create Profile" action button that launches the creation flow directly
- Previously showed a passive notification with no actionable next step

---

## 1.2.4

Updated activity bar icon.

### Changed

- Refreshed the ACK activity bar icon

---

## 1.2.3

Added a dedicated icon for the tool tree view.

### Added

- Tool tree view now has its own icon in the sidebar

---

## 1.2.2

Minor cleanup release.

### Changed

- Removed redundant activation event from extension manifest

---

## 1.2.1

Bug fix for Claude Code skills not appearing in the sidebar tree.

### Fixed

- Symlinked skill directories (e.g., `~/.claude/skills/`) are now followed when discovering skills and commands
- `listDirectories()` and `listFiles()` in `FileIOService` resolve symlinks before filtering
- `findMdFiles()` in the command parser traverses symlinked directories and includes symlinked `.md` files

---

## 1.2.0

Adds GitHub Copilot as a fully supported third agent with feature parity to Claude Code and Codex.

### Copilot Adapter

- `CopilotAdapter` implements `IPlatformAdapter` for reading and writing Copilot config files
- Detects Copilot via VS Code Extension API (`GitHub.copilot` and `GitHub.copilot-chat`)
- No filesystem assumptions — detection uses `vscode.extensions.getExtension`

### Copilot MCP Servers

- MCP servers from `.vscode/mcp.json` (workspace) and user profile `mcp.json` (user scope) shown in sidebar
- Install Copilot MCP servers from the marketplace to `.vscode/mcp.json`
- Remove MCP servers from the sidebar
- File watcher auto-refreshes when `.vscode/mcp.json` is edited externally
- Copilot uses the `servers` key (not `mcpServers`); independent Zod schema preserves `inputs` array on write

### Custom Instructions and Prompts

- Always-on instructions from `.github/copilot-instructions.md` shown in sidebar
- File-pattern instruction files from `.github/instructions/*.instructions.md` shown in sidebar
- Prompt files from `.github/prompts/*.prompt.md` shown in sidebar (Copilot-only, project scope)
- Install instruction and prompt files from the marketplace
- Delete instruction and prompt files from the sidebar with confirmation
- Preview instruction and prompt file content via markdown preview

### Custom Agents

- Custom agent files from `.github/agents/*.agent.md` shown in sidebar
- Enable/disable custom agents by toggling `userInvokable` frontmatter
- Install custom agents from the marketplace with `.agent.md` filename normalization
- Delete custom agents from the sidebar
- Preview custom agent file content via markdown preview

### Agent-Scoped Profiles

- Create, switch, and delete Copilot-specific profiles
- `toggleableToolTypes` on `IToolAdapter` — Copilot profiles skip MCP/CustomPrompt toggle with a notification
- Export/import Copilot profiles as `.ackprofile` bundles with `agentId: 'copilot'`

### Marketplace

- Marketplace shows only Copilot-compatible tools when Copilot is active
- Type filter tabs limited to tool types Copilot supports (MCP Server, Custom Agent, Instruction/Prompt)
- Agent compatibility badge shows "Copilot" on compatible tool cards
- Install flow routes through `CopilotAdapter` when Copilot is active
- `custom_prompt` added to `ToolManifest` schema for registry tools targeting Copilot instructions
- `CONFIG_DIR_LABELS` lookup map replaces hardcoded scope prompt paths

### Bug Fixes

- `ack.installInstructionFromFile` command added for installing instructions and prompts from local files when Copilot is active
- Copilot detection checks both `GitHub.copilot` and `GitHub.copilot-chat` extensions
- Custom Prompts group context menu shows correct install action per active agent

---

## 1.1.0

Adds OpenAI Codex as a fully supported second agent with feature parity to Claude Code.

### Agent Switcher

- Status bar item shows the active agent name with a click-to-switch action
- QuickPick lists all detected agents with detection status and current active indicator
- Selecting an agent immediately context-switches the sidebar, marketplace, and config panel
- Active agent selection persists across VS Code sessions via `globalState`
- If only one agent is detected, it is auto-selected silently on activation
- `ACK: Switch Agent` and `ACK: Re-detect Agents` commands added to the command palette
- Agent-changed banner in marketplace and config panel webviews with a Refresh button
- Panel titles include the active agent name (e.g., "Tool Marketplace - Claude Code")
- Sidebar tree description shows the active agent name
- Welcome view updated to mention both Claude Code and Codex with links to each

### Codex Adapter

- `CodexAdapter` implements `IPlatformAdapter` for reading and writing Codex config files
- TOML parsing and writing via `smol-toml` with atomic write and backup pipeline
- `CodexPaths` resolves `~/.codex/` (user) and `.codex/` (project) config locations
- Zod schemas for Codex config with `.passthrough()` to preserve unknown fields
- Detects Codex by checking for the `~/.codex/` directory on activation and logs result to the output channel
- Notification when Codex is detected but no `config.toml` exists, offering to create one
- Notification with "Open File" action when `config.toml` has parse errors
- `ACK: Initialize Codex for This Project` scaffolds `.codex/config.toml`, `prompts/`, and `skills/`
- File watchers monitor `config.toml`, `skills/`, and `prompts/` for external changes
- ESLint boundary guard prevents direct Codex adapter imports outside the adapter directory

### Codex MCP Servers

- MCP servers from `~/.codex/config.toml` and `.codex/config.toml` shown in the sidebar tree
- Add MCP server via a guided multi-step wizard (name, scope, transport, command/URL, args, PATH validation)
- Enable/disable and remove MCP servers, with changes written to TOML
- Per-tool `enabled_tools` / `disabled_tools` arrays shown as child nodes; toggle individual tools inline
- Environment variable management: add, edit, reveal (copy to clipboard), and remove env vars per server
- Open Source navigates to the `[mcp_servers.name]` table in `config.toml` and positions the cursor

### Codex Skills

- Skills from `~/.codex/skills/` and `.codex/skills/` shown in the sidebar tree with scope icons
- Install a skill from the marketplace -- writes to the appropriate Codex skills directory
- Enable/disable a skill by renaming its directory with a `.disabled` suffix
- Delete a skill with a confirmation dialog and automatic backup
- Move a skill between user and project scope
- Clicking a skill opens `SKILL.md` in a markdown preview

### Codex Custom Prompts

- Custom prompts from `~/.codex/prompts/` shown in the sidebar tree (alphabetical, with optional frontmatter description as tooltip)
- Custom Prompts section remains visible when the directory is empty, keeping the install action accessible
- `ACK: Install Custom Prompt from File` installs a `.md` file into `~/.codex/prompts/`, with overwrite confirmation if a file with the same name already exists
- Delete a prompt with a modal confirmation dialog ("This action cannot be undone")
- Clicking a prompt opens it in a markdown preview
- File watcher monitors `~/.codex/prompts/` so externally added or deleted prompts appear instantly

### Agent-Scoped Profiles

- Profiles are now stamped with the agent they were created under
- Each agent shows only its own profiles; switching agents immediately filters the profile list in the config panel
- Profile storage migrated from v1 (no agent) to v2 (with `agentId`) on activation; existing profiles attributed to Claude Code
- `ACK: Clone Profile to Agent` copies a profile across agents, filtering to compatible tool types and showing a compatibility summary
- Exported profiles use the `.ackprofile` extension and include `version: 2` and `agentId` in the bundle
- Importing a profile from a different agent shows a mismatch dialog offering to convert (filtering incompatible tools)
- Workspace profile associations are scoped per agent; each agent activates its own workspace profile independently

### Marketplace

- Registry entries support an optional `agents` field listing compatible agent IDs
- Marketplace filters tool listings to show only tools compatible with the active agent
- Type filter tabs are limited to tool types the active agent supports (e.g., no Hooks tab when Codex is active)
- Each tool card and detail view shows an agent compatibility badge ("All Agents", "Claude Code", "Codex")
- Install flow routes through the active adapter -- JSON for Claude Code, TOML for Codex
- Scope picker in the install flow shows the correct config directory for the active agent

### Adapter Purification

- All service-layer config operations route through `IPlatformAdapter` -- no Claude Code-specific imports in services or views
- `IPlatformAdapter` decomposed into five composed sub-interfaces: `IToolAdapter`, `IMcpAdapter`, `IPathAdapter`, `IInstallAdapter`, `ILifecycleAdapter`
- ESLint `no-restricted-imports` rule enforces the adapter boundary project-wide

### Bug Fixes

- Sidebar tree agent description wiped on every refresh -- fixed by re-asserting `treeView.description` inside `refresh()`
- Marketplace scope picker showed hardcoded `.claude` paths when Codex was active -- fixed to derive paths from the active adapter
- Custom Prompts group hidden when `~/.codex/prompts/` was empty -- group now always visible when Codex is active
- `ack.installPromptFromFile` missing `ACK:` prefix in command palette -- renamed to `ACK: Install Custom Prompt from File`
- Config panel profiles list not refreshing after agent switch -- `notifyAgentChanged()` now calls `sendProfilesData()` and `sendToolsData()`
- `ack.cloneProfileToAgent` missing from `package.json` `contributes.commands` -- command now appears in the palette
- Workspace association commands did not pass `agentId` to `setAssociation`, breaking per-agent workspace auto-activation -- both call sites fixed

---

## 1.0.0

Initial public release.

### Core Infrastructure

- VS Code extension scaffold with esbuild bundling and TypeScript
- Internal type system, Zod schemas, and config validation
- FileIO and backup services with atomic writes
- Claude Code adapter with per-platform path resolution
- Config service with scope resolution (user vs. project) and safe write pipeline

### Tool Tree Sidebar

- Tree data provider displaying MCP servers, slash commands, hooks, and skills
- Grouped by type, labeled by scope (user / project)
- Status icons: enabled (green), disabled (gray), warning (yellow), error (red)
- Dark and light theme icon variants
- Welcome view when no tools are found
- File watcher with debounced refresh on external config changes

### Tool Management

- Toggle tools enabled/disabled inline
- Move tools between user and project scope
- Delete tools with optional confirmation dialog
- Open the source config file for any tool
- Type-aware writer modules for each tool kind

### Marketplace

- React webview panel for browsing a community tool registry
- Search, filter by type, sort by relevance or date
- Tool detail view with full description and configuration form
- One-click install to user or project scope
- Registry service with ETag caching for efficient fetches
- GitHub repository scanner for user-added tool repos

### Profiles

- Create, edit, delete, and switch named tool profiles
- Save current tool state as a profile
- Diff-based batch toggle on profile switch
- Auto-sync tool changes to active profile
- Import and export profiles as JSON files
- Workspace association with automatic activation on open

### Config Panel

- React webview for editing Claude Code settings
- Model selection, permissions, and custom instructions as form fields
- MCP server environment variable editing
- Profile list and editor integrated into the panel
- Tool settings tab with live state management

### UI Polish

- Shared CSS design tokens across all webviews
- Focus-visible outlines and keyboard accessibility
- Transitions and hover states on interactive elements
- Stroke-based activity bar icon
- Codicon stylesheet integration for consistent VS Code styling

### Security

- Path traversal protection in install service
- Input validation through Zod schemas at system boundaries

### Bug Fixes

- Module resolution order for marked/dompurify compatibility
- Registry error handling and default registry source
- Normalized `contentPath` to prevent double-slash in registry URLs
- Write service injection into adapter for uninstall
- Tool name normalization for marketplace install/uninstall matching
- Stash-based hook toggle replacing non-functional disabled field
- Profile tool count reconciliation against current environment
- Disabled status detection for skills and commands in parsers
- Tree refresh after toggle to reflect disabled status
- Back button rendering in webview navigation
- Profile save-and-apply flow
- Restart tool disable state
- Button text labels and tree refresh on tool state changes
- Delete confirmation moved to extension host for reliability
- ESLint config scoped to exclude test files
- GitHub search rewritten to use repo URL scanner after API limitations
