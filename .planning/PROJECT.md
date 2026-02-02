# Agent Config Keeper

## What This Is

A VS Code extension that provides a unified marketplace and management interface for agentic tools — skills, MCP servers, hooks, and slash commands. It replaces the fragmented workflow of browser-searching for tools, terminal-installing them, and manually toggling configs, with a single sidebar and rich UI that handles discovery, installation, configuration, and context-aware environment management.

## Core Value

Developers can discover, install, configure, and switch between sets of agent tools without leaving VS Code or touching config files manually.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Sidebar tree view showing current agent environment (skills, MCP servers, hooks, slash commands)
- [ ] File preview when clicking .md files in the sidebar tree
- [ ] "Configure Agent" panel with profile management (preset tool collections)
- [ ] Install/enable/disable/delete controls for each tool type
- [ ] "Marketplace" panel for discovering and installing tools
- [ ] GitHub-based registry for community-contributed tools
- [ ] Marketplace sources skills and MCP from GitHub, hooks and commands from community registry
- [ ] Profile system for switching between tool sets (e.g., "web dev", "data", "minimal")
- [ ] Global + per-project configuration (VS Code settings model)
- [ ] Claude Code as the v1 supported agent

### Out of Scope

- Multi-agent support beyond Claude Code — architecture should support it, but v1 is Claude Code only
- Dedicated backend/API server for marketplace — GitHub-based registry is sufficient for v1
- Ratings/reviews system for marketplace listings — defer until community grows
- Auto-detection of project type for tool suggestions — future enhancement
- Tool authoring/publishing workflow from within the extension — contributors use GitHub directly

## Context

- Claude Code's tool ecosystem includes skills (`~/.claude/skills/<skill>/SKILL.md`, `.claude/skills/<skill>/SKILL.md`), slash commands (`.claude/commands/` is still supported), hooks in settings files (`~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, managed settings), and MCP servers (`~/.claude.json`, `.mcp.json`, managed-mcp.json)
- Current pain points: discovery requires browser search across multiple sources, installation is terminal-based with restarts, toggling tools requires navigating Claude Code's /plugin command, viewing tool contents requires opening files in a separate editor, constant /clear and tool disabling to manage context window size
- No unified marketplace exists for hooks or slash commands today
- The GitHub-based registry model (like Homebrew formulas) keeps infrastructure simple while enabling community contributions
- VS Code extension API provides TreeView for sidebar, WebviewPanel for rich UIs, and workspace/global configuration APIs

## Constraints

- **Platform**: VS Code extension (Extension API) — must work with VS Code's extension model
- **Agent v1**: Claude Code — reads/writes Claude Code config files (skills in `~/.claude/skills` and `.claude/skills`, commands in `.claude/commands`, settings in `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, MCP in `~/.claude.json` and `.mcp.json`; managed settings/MCP are system-level)
- **Registry**: GitHub-based — a GitHub repository serves as the tool index/registry
- **Architecture**: Agent-agnostic internals — tool management layer must not be hard-coded to Claude Code, even though v1 only implements Claude Code adapters

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Claude Code first, other agents later | Most concrete tool ecosystem to target; user's primary agent | — Pending |
| GitHub-based registry over dedicated backend | Simpler infrastructure, community familiarity, lower maintenance | — Pending |
| Profiles as first-class concept | Core pain point is context window management via tool set switching | — Pending |
| Global + per-project config model | Mirrors VS Code's own settings model; natural for developers | — Pending |

---
*Last updated: 2026-02-01 after initialization*
