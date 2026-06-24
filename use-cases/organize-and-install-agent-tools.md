# Use Case: Enable, Organize, and Install Agent Tools from Local Sources

> **Status:** Draft  ·  **Created:** 2026-06-20  ·  **Type:** Software

## 1. Brief Description

The developer curates exactly which tools the active AI agent can use — toggling tools on/off, moving them between global and project scope, deleting unwanted ones, and installing new ones from files already on their machine. Every edit writes to the agent's own config through the provider. In ACK 2.0 there is **no remote registry**: installs come only from local sources. The value is **fine-grained control**: trim an agent down to the tools a task actually needs.

## 2. Actors

| Actor | Type | Role in this use case |
|-------|------|-----------------------|
| Developer | Human | Performs the action on a tool. **Initiator.** |
| Active provider (Claude Code / Codex / Copilot) | Internal component | Executes the type-aware write (toggle / move / delete / install) |
| Active AI agent's config store | External system (on-disk) | Target of every write; the agent reads it on its next run |
| Local source file/folder | External data | Origin of an install (skill folder, command/prompt file, etc.) |
| VS Code extension host | External system | Provides menus, modals, the file picker, file watchers |

_Primary actor (initiator):_ Developer.

## 3. Preconditions

- ACK is active and an agent is detected and active.
- For project-scope actions, a workspace folder is open.
- For an install, a well-formed local source file/folder is available.
- The developer has write access to the target config location, and the tool's type supports the requested action on the active agent.

## 4. Basic Flow (Main Success Scenario) — Toggle (most common action)

1. Developer right-clicks a tool in the tree, or clicks its inline toggle icon.
2. ACK verifies the tool's type is in the provider's `toggleableToolTypes`.
3. ACK calls the provider's `toggleTool`, which routes by type (MCP: set the `disabled` field; hook: flag the matcher group; skill/command: rename the dir/file with a `.disabled` suffix).
4. The change is written atomically with a backup; the file watcher (or an explicit refresh) updates the tree.
5. If a profile is active, ACK syncs the tool's new enabled/disabled state into that profile.

## 5. Alternative Flows (Extensions)

### 5a. Install from a local source — branches from step 1
- Developer clicks "+" on a tool-type group and picks a local source: a **skill folder**, a **command file/folder**, a **custom-prompt / instruction file**, or **guided input for an MCP server**. ACK reads the content and calls the provider's `installSkill` / `installCommand` / `installMcpServer`. The tool appears in the tree.
- **Decided:** installing a brand-new **hook** from a file is **out of scope** for 2.0 — a hook is a matcher-group fragment inside `settings.json`, not a portable file. Hooks remain toggleable/deletable and editable in-file, but are not "imported."

### 5b. Move between scopes — branches from step 1
- Developer chooses *Move To → Global (User)* or *Project*. ACK checks for a name conflict at the target scope; on conflict it shows an "already exists — Overwrite?" modal. On confirm, the provider relocates the tool.

### 5c. Delete a tool — branches from step 1
- Developer chooses *Delete*. Unless `ack.skipDeleteConfirmation` is set, ACK shows a modal ("cannot be undone") with *Delete* and *Delete & Don't Ask Again*. On confirm, the provider removes the tool and ACK removes it from the active profile.

### 5d. Action unsupported for this type/agent — branches from step 2
- The command is hidden by its menu `when`-clause; if reached anyway, the service rejects it (e.g. Codex custom prompts are not toggleable/movable; Copilot MCP servers are not toggleable).

### 5e. Invalid install source — branches from 5a
- The picked file fails validation (e.g. Copilot requires `.instructions.md` / `.prompt.md`); ACK shows an error and aborts without writing.

### 5f. Write fails / permission denied — branches from step 3 (or 5a–5c)
- ACK surfaces an error toast; the atomic-write + backup guarantee leaves the prior config intact.

## 6. Postconditions

- The agent's on-disk config reflects the change; the agent will use the new tool set on its next run.
- The active profile (if any) is updated to match.
- The tree shows the current state.

## 7. Business Rules

- **Install is local-only** — never a remote registry (the defining 2.0 constraint).
- Toggleability and movability are gated per provider via `toggleableToolTypes` / `movableToolTypes` (undefined ⇒ all supported types qualify).
- Scope model: User / Project / Local / Managed; **Managed** tools expose no edit/delete/move actions.
- Destructive actions are confirmed by default; the user may opt out of delete confirmation globally.
- All writes are atomic and backed up.

## 8. Nonfunctional Requirements

- **Performance:** a single tool action completes and is reflected in the tree within ~1–2 s. ⚠️ target to confirm.
- **Reliability:** a failed or partial write must never leave an unreadable config (atomic write + backup).
- **Security & privacy:** MCP environment-variable secrets are written only into the agent's own config files and never transmitted anywhere; reveal-to-clipboard is an explicit, separate action.
- **Usability:** unsupported actions are hidden rather than shown-and-erroring; every action gives clear inline feedback.

## 9. Assumptions

- The developer has rights to edit the relevant config.
- Local install sources are well-formed and laid out as the provider expects.
- The provider can resolve the correct target directory for each type + scope.

## 10. Notes / Additional Information

- In 2.0 the group "+" action (`ack.installTool`) is repurposed from "open Marketplace" to "install from local source."
- The currently Codex/Copilot-only file installers are slated to be generalized into provider methods so any agent gains local install (phased plan, Phases 2 & 4).
- Related use cases: *Discover and Inspect Installed Agent Tools*; *Capture, Switch, and Share Tool Profiles*.
