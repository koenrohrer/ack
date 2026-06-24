# Use Case: Discover and Inspect Installed Agent Tools

> **Status:** Draft  ·  **Created:** 2026-06-20  ·  **Type:** Software

## 1. Brief Description

From a single VS Code sidebar, the developer sees every tool the active AI coding agent can use — MCP servers, skills, commands, hooks, and custom prompts — grouped by type and scope, each showing at-a-glance status (enabled / disabled / error). It replaces hunting through scattered dotfiles across `~/.claude`, `~/.codex`, and a project's `.github`. The value is **control through visibility**: you cannot curate what an agent can do until you can see it in one place.

## 2. Actors

| Actor | Type | Role in this use case |
|-------|------|-----------------------|
| Developer | Human | Opens the view and inspects tools. **Initiator.** |
| Active AI agent's config store | External system (on-disk files/dirs) | Source of truth ACK reads — e.g. `~/.claude/` + `.claude/`, `~/.codex/config.toml` + `~/.codex/prompts/`, workspace `.github/` |
| Active provider (Claude Code / Codex / Copilot) | Internal component | Declares `supportedToolTypes` and reads/normalizes tools for each type+scope |
| VS Code extension host | External system | Renders the tree, supplies file watchers and theming |

_Primary actor (initiator):_ Developer.

## 3. Preconditions

- ACK is active in VS Code (engine ≥ 1.105).
- At least one supported agent is detected and selected as the active agent (see *Detect and Switch the Active AI Agent*).
- The developer has filesystem read access to the active agent's user-scope config dir, and project-scope dir if a workspace folder is open.

## 4. Basic Flow (Main Success Scenario)

1. Developer opens the ACK "Tools" view in the activity bar.
2. ACK asks the active provider for its `supportedToolTypes` and reads all tools of each type across the applicable scopes (User, Project, Local, Managed).
3. ACK groups the results by tool type, then by scope, and builds the tree.
4. For each tool, ACK computes status (enabled / disabled / error) and renders a scope- and status-specific icon.
5. Developer expands a group (e.g. *MCP Servers*) to view individual tools; provider-specific sub-nodes expand further (e.g. a Codex MCP server's per-tool toggles and environment variables).
6. Developer clicks a tool — or runs *ACK: Open Tool Source* — to open its backing file in the editor.

## 5. Alternative Flows (Extensions)

### 5a. No agent detected — branches from step 2
- The tree shows the welcome view: "No agent tools found. Install a supported agent (Claude Code or Codex) to get started." No error is raised.

### 5b. Malformed config file — branches from step 4
- The affected entry renders as an **error node** with an error icon and a tooltip describing the parse failure; the rest of the tree still loads. A bad `config.toml` or `.mcp.json` never crashes the view.

### 5c. External change while the view is open — branches from step 6
- A file watcher fires on the agent's watched paths; ACK refreshes the affected branch. If `ack.showChangeNotifications` is on, an "ACK: Config updated" toast appears.

### 5d. Scope or tool type absent — branches from step 3
- A scope with no entries (e.g. no project config) is simply omitted — no empty-state error. A tool type the active provider does not support is not shown at all (driven by `supportedToolTypes`).

## 6. Postconditions

- No state change — this is a read-only flow.
- The developer has an accurate, current picture of the active agent's tools; the tree reflects on-disk reality at the moment of the last read/refresh.

## 7. Business Rules

- Only the **active** agent's tools are shown — exactly one agent at a time.
- Tools are organized by the scope model: **User** (global), **Project**, **Local**, **Managed**.
- **Managed** tools are displayed read-only (no edit affordances).
- The tool types shown are exactly the active provider's declared `supportedToolTypes`; nothing is invented for an agent that doesn't support it.

## 8. Nonfunctional Requirements

- **Performance:** initial tree render ≤ ~2 s for a typical config; refresh after a watched change ≤ ~1 s. ⚠️ targets to confirm against real configs.
- **Security & privacy:** read-only; discovery performs no writes and no network calls. MCP environment-variable values are never displayed inline (revealed only on explicit action elsewhere).
- **Reliability:** parse errors degrade to error nodes, never an exception that blanks the tree.
- **Usability / accessibility:** light/dark icon variants; scope and status legible from the icon alone.
- **Portability:** correct path resolution on macOS, Linux, and Windows.

## 9. Assumptions

- Each agent's config lives in the conventional locations its provider knows how to read.
- The developer has read permission to those locations.
- One-agent-at-a-time is the desired mental model (not a merged cross-agent view).

## 10. Notes / Additional Information

- Sub-node depth is provider-specific (Codex MCP servers expose per-tool toggles + env vars; others are flatter).
- A shared `APPLICABLE_SCOPES` map already governs which scopes each tool type can appear in.
- Related use cases: *Enable, Organize, and Install Agent Tools from Local Sources*; *Detect and Switch the Active AI Agent*.
