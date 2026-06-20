# Using ACK

A walkthrough of every feature in ACK, from first install to advanced workflows.

---

## Table of Contents

- [Installation](#installation)
- [Switching Agents](#switching-agents)
- [The Tool Tree](#the-tool-tree)
- [Installing Tools from Local Files](#installing-tools-from-local-files)
- [Managing Tools](#managing-tools)
- [Profiles](#profiles)
- [The Config Panel](#the-config-panel)
- [Tips and Workflows](#tips-and-workflows)

---

## Installation

Install from the VS Code Marketplace:

```
ext install koenrohrer.ack
```

Or from the command line:

```bash
code --install-extension koenrohrer.ack
```

After installation, the ACK icon appears in the activity bar.

---

## Switching Agents

ACK auto-detects which agent CLIs are installed on your machine. The status bar shows the active agent by name.

**To switch agents:**

- Click the agent name in the status bar, or
- Run `ACK: Switch Agent` from the command palette

A QuickPick lists all detected agents with their detection status. Selecting one instantly switches the sidebar and config panel to that agent's tools.

**If you just installed Codex or Copilot** and it isn't listed yet, run `ACK: Re-detect Agents` to refresh detection without restarting VS Code.

### Codex setup

The first time you switch to Codex for a project, run `ACK: Initialize Codex for This Project`. This scaffolds:

```
.codex/
  config.toml     ← MCP server configuration
  skills/         ← project-scoped skills
```

Global Codex config lives in `~/.codex/`.

### Copilot setup

No special initialization is needed. ACK detects Copilot by checking for the `GitHub.copilot` or `GitHub.copilot-chat` VS Code extensions. Copilot config files live in standard locations:

```
.vscode/mcp.json                              ← workspace MCP servers
.github/copilot-instructions.md                ← always-on instructions
.github/instructions/*.instructions.md         ← file-pattern instructions
.github/prompts/*.prompt.md                    ← reusable prompts
.github/agents/*.agent.md                      ← custom agents
```

User-scoped MCP servers are stored in your VS Code user profile `mcp.json`.

---

## The Tool Tree

The sidebar is the heart of ACK. It automatically discovers your agent's configuration and displays every tool grouped by type.

<!-- Screenshot: full tool tree with expanded groups -->
<p align="center">
  <img src="https://raw.githubusercontent.com/koenrohrer/ack/master/media/screenshots/tool-tree-expanded.png" alt="Tool tree with MCP servers, commands, hooks, and skills expanded" width="700" />
  <br/>
  <sub>Tools are organized by type and labeled with their scope -- user (global) or project (workspace).</sub>
</p>

### What you'll see

The groups displayed depend on the active agent:

| Group | Claude Code | Codex | Copilot |
|-------|-------------|-------|---------|
| **MCP Servers** | ✓ | ✓ | ✓ |
| **Skills** | ✓ | ✓ | — |
| **Slash Commands** | ✓ | — | — |
| **Hooks** | ✓ | — | — |
| **Custom Prompts** | — | ✓ | — |
| **Custom Instructions** | — | — | ✓ |
| **Custom Agents** | — | — | ✓ |

### Scopes

Every tool has a scope badge:

- **User** (globe icon) -- Configured globally (`~/.claude/`, `~/.codex/`, or VS Code user profile), available in all projects
- **Project** (folder icon) -- Configured in `.claude/`, `.codex/`, `.vscode/`, or `.github/` within the current workspace

### Status indicators

- **Green** -- Enabled and healthy
- **Gray** -- Disabled (still configured, but toggled off)
- **Yellow** -- Warning (e.g., missing fields)
- **Red** -- Error (e.g., invalid config, unreachable server)

---

## Installing Tools from Local Files

ACK installs tools from your own disk -- there is no remote registry, and nothing is fetched over the network.

### Skills and commands

Click the **+** on a tool group's row in the sidebar:

- **Skill** -- pick a folder; ACK installs its files under the active agent's skills directory, named after the folder.
- **Command** (Claude Code) -- choose **Single file** or **Folder (multi-file)**, pick it, and ACK installs it under the commands directory.

You'll be asked for a scope -- **User** (global) or **Project** (workspace) -- when the active agent supports both. If a tool with the same name already exists, ACK asks before overwriting.

### Custom prompts and instructions

For Codex and Copilot, the **+** on the Custom Prompts group (or `ACK: Install Custom Prompt from File`) installs a `.md` file: Codex prompts go to `~/.codex/prompts/`, and Copilot routes `*.instructions.md` / `*.prompt.md` into `.github/`.

### MCP servers

The **+** on the MCP Servers group runs a guided flow (name, scope, transport, command/URL) and writes the server to the active agent's config. This works for any agent that supports MCP.

The tool appears in your tree immediately. No restart needed -- the file watcher picks up the change.

---

## Managing Tools

### Toggle enable/disable

Click the **toggle icon** on any tool in the tree, or right-click and select **Toggle Enable/Disable**. Disabled tools stay in your config but are marked inactive.

### Move between scopes

Right-click a tool and choose **Move To... > Global (User)** or **Move To... > Project**. The tool is removed from the old scope and written to the new one.

### Delete a tool

Right-click and select **Delete Tool**. By default, ACK asks for confirmation. To skip this dialog, set `ack.skipDeleteConfirmation` to `true`.

### Open the source file

Right-click any tool and select **Open Tool Source** to jump directly to the config file where the tool is defined (JSON for Claude Code tools, TOML for Codex tools, JSON or Markdown for Copilot tools).

---

## Profiles

Profiles are named snapshots of your tool configuration. Use them to maintain different setups for different workflows.

Profiles are **scoped per agent** -- each agent maintains its own profile list. A profile you create while Claude Code is active won't appear when you switch to Codex or Copilot.

### Create a profile

1. Run `ACK: Create Profile` from the command palette
2. Enter a name
3. The profile is saved with your current tool state

Or use `ACK: Save Current State as Profile` to snapshot everything as-is.

### Switch profiles

Click the **profile icon** in the tool tree title bar, or run `ACK: Switch Profile`. Select a profile and your tools update immediately. If no profiles exist yet, you'll be prompted to create one with a single click.

<!-- Screenshot: profile switcher quick pick -->
<p align="center">
  <img src="https://raw.githubusercontent.com/koenrohrer/ack/master/media/screenshots/profiles.png" alt="Profile switcher showing saved configurations" width="600" />
  <br/>
  <sub>Switching profiles updates your tools instantly -- no restart, no reload.</sub>
</p>

### Import and export

- `ACK: Export Profile` -- Save a profile as a `.ackprofile` file to share or back up. The file includes the agent ID so ACK knows which agent it belongs to.
- `ACK: Import Profile` -- Load a profile from a `.ackprofile` file. If the agent doesn't match, ACK offers to convert the profile, filtering to compatible tool types.

### Clone to another agent

Run `ACK: Clone Profile to Agent` to copy a profile from one agent to another. ACK shows how many tools are compatible and which will be skipped (e.g., hooks are skipped when cloning to Codex or Copilot, which have no hook system).

### Workspace association

Run `ACK: Associate Profile with Workspace` to bind a profile to the current workspace. When `ack.autoActivateWorkspaceProfiles` is enabled (the default), opening that workspace automatically activates the associated profile for the active agent.

Each agent can have its own workspace association -- switching from Claude Code to Codex activates the Codex profile for that workspace, if one is set.

---

## The Config Panel

Run `ACK: Configure Agent` to open a visual editor for your agent's settings.

<!-- Screenshot: config panel showing model, permissions, and instructions -->
<p align="center">
  <img src="https://raw.githubusercontent.com/koenrohrer/ack/master/media/screenshots/config-panel.png" alt="Config panel with model selection, permission toggles, and instruction editor" width="800" />
  <br/>
  <sub>Every setting is a form field. Edit, save, and your agent picks up the change.</sub>
</p>

### What you can configure

- **Model** -- Select which model your agent uses
- **Permissions** -- Toggle permission levels for file access, command execution, etc.
- **Custom instructions** -- Write instructions that shape your agent's behavior
- **MCP server settings** -- Configure server-specific parameters

Changes are written directly to your agent's config files. The config panel reads and writes the same files your agent does -- ACK is not a separate config layer.

---

## Tips and Workflows

### Project onboarding

1. Set up the tools your project needs
2. Save them as a profile (`ACK: Save Current State as Profile`)
3. Export the profile (`ACK: Export Profile`)
4. Commit the `.ackprofile` file to your repo
5. Teammates import it and associate it with the workspace

### Experimenting with tools

1. Save your current setup as a profile
2. Install and try new tools freely
3. If things break, switch back to your saved profile

### Keeping configs in sync

Enable `ack.showChangeNotifications` to get notified when config files change outside VS Code (e.g., when your agent modifies its own config, or when you edit files in a terminal).

---

*For technical details, architecture, and contributing instructions, see [CONTRIBUTING.md](CONTRIBUTING.md).*
