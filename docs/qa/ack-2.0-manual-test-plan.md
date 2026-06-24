# ACK 2.0 — Manual Test Plan

A by-hand QA pass over everything that changed in the 2.0 update (the `2.0-core`
marketplace-removal/local-install/provider-seam work **plus** the `multi-agent-ux`
branch: Codex detection, startup activation, state-aware welcome). Work top to bottom
and check each box. Every expected result is observable in the VS Code UI or on disk.

**Test target:** Claude Code only (your environment). Codex/Copilot behavior is tested
where it can be **scaffolded on disk** (detection is pure filesystem); cases that
genuinely need those agents installed are quarantined in
[§ Blocked / out-of-environment](#blocked--out-of-environment).

---

## Setup / Prerequisites

### 1. Build

```bash
cd /home/koen/Code/ack
npm install
npm run compile          # or: npm run watch   (rebuilds on edit)
```

### 2. Launch the Extension Development Host (EDH) in an isolated sandbox

The extension reads/writes real config under `$HOME` (`~/.claude`, `~/.codex`,
`~/.claude.json`). `getHomeDir()` → `os.homedir()`, which **honors `$HOME`**, so we
point the EDH at a throwaway home and a clean VS Code user-data dir. This keeps every
test off your real config and gives a deterministic "no agent chosen yet" state.

Add this configuration to `.vscode/launch.json` (keep the existing "Run Extension"):

```jsonc
{
  "name": "Run Extension (QA sandbox)",
  "type": "extensionHost",
  "request": "launch",
  "args": [
    "--extensionDevelopmentPath=${workspaceFolder}",
    "--user-data-dir=/tmp/ack-edh-userdata"   // isolates settings + globalState (persisted agent)
  ],
  "env": { "HOME": "/tmp/ack-test-home" },     // isolates ~/.claude, ~/.codex, ~/.claude.json
  "outFiles": ["${workspaceFolder}/dist/**/*.js"]
}
```

> On Linux `os.homedir()` returns `$HOME`. Verified: setting `HOME=/tmp/ack-test-home`
> redirects `os.homedir()` to that path. The managed scope (`/etc/claude-code`) is
> outside `$HOME` and not exercised here.

Seed the sandbox so **only Claude Code** is detected, then press **F5 → "Run Extension
(QA sandbox)"**:

```bash
# Sandbox home with a minimal Claude Code install (dir presence = detected)
mkdir -p /tmp/ack-test-home/.claude/skills /tmp/ack-test-home/.claude/commands
# A throwaway workspace so Project scope is available inside the EDH
mkdir -p /tmp/ack-test-ws
```

In the EDH window: **File → Open Folder → `/tmp/ack-test-ws`** (needed for any
Project-scope test). Click the **ACK icon** in the activity bar to open the sidebar.

### 3. Reset state between tests

- **Filesystem/config:** `rm -rf /tmp/ack-test-home && mkdir -p /tmp/ack-test-home/.claude/skills /tmp/ack-test-home/.claude/commands`
- **Persisted active agent + ACK settings** (globalState key `ack.activeAgentId`,
  settings `ack.skipDeleteConfirmation` etc.): `rm -rf /tmp/ack-edh-userdata`, then relaunch.
- A full reset = remove both dirs and relaunch. The Output panel → **"ACK"** channel
  logs detection (`Claude Code: detected`, `Active agent: …`) — keep it open throughout.

### Reference — exact identifiers (verified against source)

| Thing | Value |
|---|---|
| Commands present | `ack.installTool` ("Install…" — inline `+` only), `ack.addMcpServer`, `ack.redetectAgents` ("ACK: Re-detect Agents"), `ack.switchAgent` ("ACK: Switch Agent"), `ack.activateAgent`, `ack.openConfigPanel` ("ACK: Configure Agent"), profile cmds, `ack.installCustomPromptFile` |
| Commands **removed** | `ack.openMarketplace` (gone) |
| Settings present | `ack.showChangeNotifications` (true), `ack.skipDeleteConfirmation` (false), `ack.autoActivateWorkspaceProfiles` (true) |
| Settings **removed** | `ack.userRepositories`, `ack.registrySources` (gone) |
| Welcome context keys | `ack.noAgents`, `ack.chooseAgent`, `ack.noTools`, `ack.agentDetected.{claudecode,codex,copilot}` |
| Claude Code caps | `mcpEnvVars: false`, `mcpServerToolToggle: false`, `customPromptFileInstall: false` |
| Claude Code MCP file | User → `~/.claude.json` (`mcpServers`); Project → `{root}/.mcp.json` |
| Codex detection markers | `~/.codex/config.toml` **or** `~/.codex/prompts/` **or** `~/.codex/skills/` |

---

## Coverage matrix

| 2.0 feature | Test cases | Env |
|---|---|---|
| Build + activation smoke | TC-1 | ✅ |
| Marketplace removed / no network (breaking) | TC-2 – TC-6 | ✅ |
| Codex detection tightened | TC-7 – TC-11 | ✅ scaffolded |
| Startup last-used-first activation | TC-12 – TC-16 | ✅ scaffolded |
| State-aware welcome (3 states) | TC-17 – TC-21 | ✅ scaffolded |
| Local install — Skills | TC-22 – TC-28 | ✅ |
| Local install — Commands | TC-29 – TC-32 | ✅ |
| Add MCP server (any MCP-capable agent) | TC-33 – TC-38 | ✅ |
| Capability gating (Claude Code negatives) | TC-39 – TC-41 | ✅ |
| Inline tool actions (toggle/move/delete/open) | TC-42 – TC-49 | ✅ |
| Provider seam rename + profile migration | TC-50 – TC-52 | ✅ (cross-agent part blocked) |
| Profiles (create-by-selection/switch/edit-tools/export/import/associate) | TC-53 – TC-60 | ✅ (clone blocked) |
| Config panel | TC-61 – TC-63 | ✅ |
| File watcher / change notifications | TC-64 – TC-65 | ✅ |
| Codex/Copilot install, MCP TOML, env vars, clone | B-1 – B-6 | ⛔ needs agent |

---

## Test cases

### Build & activation

### TC-1: Extension builds and activates
1. Run `npm run compile`; confirm no errors.
2. F5 → "Run Extension (QA sandbox)".
3. Open the **ACK** activity-bar icon; open Output panel → channel **ACK**.
- Expected: extension activates with no error notification; Output shows `Claude Code: detected` and `ACK activated`; the Tools sidebar renders.
- [ ] Pass  [ ] Fail   Notes: ______

---

### Marketplace removal & no-network (breaking-change regressions)

### TC-2: `ACK: Open Marketplace` no longer exists
1. `Ctrl+Shift+P`, type `ACK: Open Marketplace`.
- Expected: no such command. (Only the current ACK commands appear — Configure Agent, Switch Agent, Re-detect Agents, profile commands, etc.)
- [ ] Pass  [ ] Fail   Notes: ______

### TC-3: No marketplace UI anywhere
1. Inspect the ACK sidebar, command palette, and any view titles.
- Expected: no "Marketplace" panel, view, button, or tab exists.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-4: Removed settings are absent and stale values are ignored
1. Open Settings UI, search `ack.`.
2. Separately, put a stale value in the sandbox settings and relaunch:
   `mkdir -p /tmp/ack-edh-userdata/User && echo '{ "ack.userRepositories": ["x"], "ack.registrySources": ["y"] }' > /tmp/ack-edh-userdata/User/settings.json`
- Expected: Settings UI shows only `ack.showChangeNotifications`, `ack.skipDeleteConfirmation`, `ack.autoActivateWorkspaceProfiles`. No `ack.userRepositories` / `ack.registrySources`. After relaunch with stale values, activation still succeeds and the values are silently ignored (no error, no migration prompt).
- [ ] Pass  [ ] Fail   Notes: ______

### TC-5: No network traffic
1. Disconnect from the network (or watch a traffic monitor).
2. Relaunch the EDH; browse the tree; install a local skill (TC-22); import a profile (TC-57).
- Expected: every operation works fully offline; nothing is fetched.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-6: Settings surface is exactly the three ACK settings
1. Settings UI → search `ACK - Agent Config Keeper`.
- Expected: exactly the three boolean settings above, with the documented defaults.
- [ ] Pass  [ ] Fail   Notes: ______

---

### Codex detection (scaffolded — no Codex install needed)

> The detection rule: `~/.codex` is detected only if it contains `config.toml`, a
> `prompts/` dir, or a `skills/` dir. Run `ACK: Re-detect Agents` after each change and
> watch the Output → ACK channel line `Codex: detected / not detected`.

### TC-7: Bare `~/.codex` is NOT detected
1. `mkdir -p /tmp/ack-test-home/.codex` (empty — optionally add a junk file `touch /tmp/ack-test-home/.codex/memory.db`).
2. Run `ACK: Re-detect Agents`.
- Expected: Output shows `Codex: not detected`. (No Codex anywhere in the UI.)
- [ ] Pass  [ ] Fail   Notes: ______

### TC-8: `config.toml` marker → detected
1. `touch /tmp/ack-test-home/.codex/config.toml`.
2. Run `ACK: Re-detect Agents`.
- Expected: Output shows `Codex: detected`.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-9: `prompts/` marker → detected AND "create config.toml?" prompt fires
1. `rm -f /tmp/ack-test-home/.codex/config.toml && mkdir -p /tmp/ack-test-home/.codex/prompts`.
2. Run `ACK: Re-detect Agents`.
- Expected: `Codex: detected`; and because Codex is detected but has no `config.toml`, an info prompt **"Codex detected but no config.toml found. Create one?"** appears. (Confirms the marker change keeps that flow reachable.)
- [ ] Pass  [ ] Fail   Notes: ______

### TC-10: `skills/` marker → detected
1. `rm -rf /tmp/ack-test-home/.codex/prompts && mkdir -p /tmp/ack-test-home/.codex/skills`.
2. Run `ACK: Re-detect Agents`.
- Expected: `Codex: detected`.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-11: Removing all markers → not detected
1. `rm -rf /tmp/ack-test-home/.codex`.
2. Run `ACK: Re-detect Agents`.
- Expected: `Codex: not detected`.
- [ ] Pass  [ ] Fail   Notes: ______ (Tear down: ensure `/tmp/ack-test-home/.codex` is gone before later tests unless a test asks for it.)

---

### Startup activation / reconcile

### TC-12: Single agent detected → auto-activated
1. Full reset (remove both sandbox dirs); re-seed only `~/.claude` (TC setup step 2); relaunch.
- Expected: Claude Code is auto-activated without prompting; status bar shows the Claude Code agent; Output: `Active agent: Claude Code`.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-13: Last-used agent wins on next launch (persistence)
1. With Claude Code active, scaffold a second agent: `mkdir -p /tmp/ack-test-home/.codex/skills`.
2. Run `ACK: Re-detect Agents` (now 2 detected, but Claude Code already persisted/active).
3. Relaunch the EDH (do NOT clear `/tmp/ack-edh-userdata`).
- Expected: on restart Claude Code reactivates automatically (persisted + still detected wins) — no chooser appears even though 2 agents are detected.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-14: Two detected + no usable history → chooser (no auto-pick)
1. Clear persistence only: `rm -rf /tmp/ack-edh-userdata`.
2. Ensure 2 detected: `~/.claude` present and `mkdir -p /tmp/ack-test-home/.codex/skills`.
3. Relaunch.
- Expected: NO agent auto-activates; the sidebar shows the **"Multiple agents detected — choose one:"** welcome with one button per detected agent. Output: `Multiple agents detected, awaiting choice: …`.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-15: Persisted agent disappears, one remains → that one activates
1. From TC-13 state (Claude Code persisted), make Claude Code the persisted choice, then remove its marker so only Codex remains: keep `/tmp/ack-test-home/.codex/skills`, then `rm -rf /tmp/ack-test-home/.claude /tmp/ack-test-home/.claude.json`.
2. Relaunch.
- Expected: persisted (Claude Code) is no longer detected, exactly one agent (Codex) remains → Codex auto-activates (no chooser). *(Restore `~/.claude` afterward.)*
- [ ] Pass  [ ] Fail   Notes: ______

### TC-16: `ACK: Re-detect Agents` re-runs reconcile + config checks
1. With the chooser showing (TC-14), add/remove a marker and run `ACK: Re-detect Agents`.
- Expected: detection re-runs, the welcome/keys update to match the new set, the Output channel is shown, and any provider config prompts (e.g. Codex "create config.toml?") re-surface.
- [ ] Pass  [ ] Fail   Notes: ______

---

### State-aware welcome view (exactly one state at a time)

### TC-17: No-agents state
1. Full reset; remove ALL markers: `rm -rf /tmp/ack-test-home && mkdir -p /tmp/ack-test-home`; `rm -rf /tmp/ack-edh-userdata`; relaunch.
- Expected: sidebar shows **"No agent tools found. Install a supported agent to get started."** with `Claude Code` / `Codex` links. Output: `No supported agent platforms detected`.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-18: Choose-agent state shows only detected agents
1. Reach the chooser (TC-14: Claude Code + Codex detected, no persistence).
- Expected: header "Multiple agents detected — choose one:" plus **Activate Claude Code** and **Activate Codex** buttons. **No "Activate GitHub Copilot" button** (Copilot undetected → `hideWhenUndetected` preserved).
- [ ] Pass  [ ] Fail   Notes: ______

### TC-19: Clicking a chooser button activates that agent
1. In the chooser, click **Activate Codex**.
- Expected: Codex becomes active (status bar updates); the chooser welcome disappears; the tree switches to Codex's tools. *(Then switch back via `ACK: Switch Agent`.)*
- [ ] Pass  [ ] Fail   Notes: ______

### TC-20: No-tools (empty) state
1. Make exactly one agent active with zero tools: full reset, seed `~/.claude` with **empty** skills/commands dirs and no MCP/hooks; relaunch so Claude Code activates.
- Expected: tree shows **"No tools configured for the active agent yet. Use the + on a tool group (Skills, Commands, MCP) to install one…"** — and this only renders because an agent IS active (distinct from no-agents/chooser).
- [ ] Pass  [ ] Fail   Notes: ______

### TC-21: Mutual exclusivity
1. Cycle through TC-17 (none) → TC-14 (choose) → TC-20 (empty) → install a tool (TC-22, now non-empty).
- Expected: at each step exactly one welcome (or none, once tools exist) is visible — never two stacked.
- [ ] Pass  [ ] Fail   Notes: ______

---

### Local install — Skills (Claude Code)

> Prep a sample skill on disk:
> `mkdir -p /tmp/sample-skill && printf -- '---\nname: sample-skill\ndescription: demo\n---\nbody\n' > /tmp/sample-skill/SKILL.md`

### TC-22: Install a skill at User scope
1. Click the **+** on the **Skills** group (inline icon on the group row).
2. Pick `/tmp/sample-skill`. When asked, choose **User (Global)**.
- Expected: confirmation toast `Skill "sample-skill" installed (1 file).`; skill appears under Skills; on disk `/tmp/ack-test-home/.claude/skills/sample-skill/SKILL.md` exists.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-23: Install a skill at Project scope
1. Ensure `/tmp/ack-test-ws` is the open folder. Click **+** on Skills, pick the sample, choose **Project (Workspace)**.
- Expected: file written to `/tmp/ack-test-ws/.claude/skills/sample-skill/SKILL.md`; shown under Skills at project scope.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-24: Subfolders are reported, not silently dropped
1. `mkdir -p /tmp/sample-skill/nested && echo x > /tmp/sample-skill/nested/extra.md`.
2. Install the skill again (overwrite when prompted).
- Expected: toast notes `Subfolders not copied: nested.`; only top-level files were copied.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-25: Empty folder is rejected
1. `mkdir -p /tmp/empty-skill`. Click **+** on Skills, pick `/tmp/empty-skill`.
- Expected: error `"empty-skill" has no files to install.`; nothing written.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-26: Overwrite confirmation on name collision
1. Install `sample-skill` at User (already exists from TC-22).
- Expected: a **modal** "sample-skill already exists at this scope. Overwrite?" — choosing **Overwrite** proceeds; **Cancel/Esc** aborts with nothing changed.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-27: Cancelling mid-flow is a no-op
1. Click **+** on Skills, then Esc at the folder picker. Repeat, Esc at the scope picker.
- Expected: no install, no error, tree unchanged.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-28: Scope picker depends on workspace
1. With a folder open, install a skill → you ARE asked User vs Project. Then **File → Close Folder** and install again.
- Expected: with no workspace open, no scope prompt appears — it installs to **User** directly.
- [ ] Pass  [ ] Fail   Notes: ______

---

### Local install — Commands (Claude Code)

> Prep: `printf -- '---\ndescription: hi\n---\nhello\n' > /tmp/mycmd.md` and
> `mkdir -p /tmp/mycmd-folder && echo a > /tmp/mycmd-folder/a.md && echo b > /tmp/mycmd-folder/b.md`

### TC-29: Install a single-file command
1. Click **+** on **Commands** → choose **Single file** → pick `/tmp/mycmd.md` → scope **User**.
- Expected: written to `/tmp/ack-test-home/.claude/commands/mycmd.md`; appears under Commands.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-30: Install a multi-file folder command
1. Click **+** on Commands → **Folder (multi-file)** → pick `/tmp/mycmd-folder` → scope **User**.
- Expected: written under `…/.claude/commands/mycmd-folder/` containing `a.md` and `b.md`; toast `Command "mycmd-folder" installed (2 files).`
- [ ] Pass  [ ] Fail   Notes: ______

### TC-31: Command overwrite conflict naming
1. Reinstall the single-file command (TC-29) → conflict is on the **file name** (`mycmd.md`). Reinstall the folder command → conflict is on the **command/folder name** (`mycmd-folder`).
- Expected: a modal overwrite prompt in each case, naming the right target.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-32: Cancel the single/folder quick pick
1. Click **+** on Commands, then Esc at the "Single file / Folder" pick.
- Expected: no-op.
- [ ] Pass  [ ] Fail   Notes: ______

---

### Add MCP server (now works for any MCP-capable agent)

### TC-33: Add a stdio MCP server (User)
1. Click **+** on the **MCP Servers** group. Enter name `demo-mcp` (step 1/5) → scope **User** → transport **stdio (command)** → command `npx` → args `-y, @modelcontextprotocol/server-github`.
- Expected: toast `MCP server 'demo-mcp' added.`; appears under MCP Servers; on disk `~/.claude.json` (`/tmp/ack-test-home/.claude.json`) has `mcpServers.demo-mcp` with `command`/`args`.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-34: Add an HTTP MCP server
1. **+** on MCP Servers → name `http-mcp` → User → **HTTP (url)** → url `https://mcp.example.com/mcp`.
- Expected: written with `{ "url": "https://mcp.example.com/mcp" }`; appears in tree.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-35: Server-name validation
1. Start the flow; try an empty name, then a name with a space (`my server`).
- Expected: inline validation blocks both (`Server name is required` / `Server name cannot contain spaces`).
- [ ] Pass  [ ] Fail   Notes: ______

### TC-36: stdio command not on PATH → warn-and-continue
1. Add a stdio server with command `definitely-not-a-real-binary`.
- Expected: warning `Command 'definitely-not-a-real-binary' not found on PATH. Continue anyway?` with **Continue** / **Cancel**; Continue writes it, Cancel aborts.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-37: Add an MCP server at Project scope
1. With `/tmp/ack-test-ws` open, add a stdio server, choose **Project (Workspace)**.
- Expected: written to `/tmp/ack-test-ws/.mcp.json` (`mcpServers`), not `~/.claude.json`.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-38: Cancel at any step writes nothing
1. Start the flow; Esc at name / scope / transport / command in separate runs.
- Expected: no config write each time.
- [ ] Pass  [ ] Fail   Notes: ______

---

### Capability gating — Claude Code negatives (intentionally absent affordances)

### TC-39: No "Custom Prompts" install affordance for Claude Code
1. With Claude Code active, inspect the tree groups and right-click menus.
- Expected: there is **no Custom Prompts group `+`** and `ACK: Install Custom Prompt from File` does nothing useful (Claude Code `customPromptFileInstall: false`). Custom prompts are a Codex/Copilot concept.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-40: No env-var menu on a Claude Code MCP server
1. Right-click the `demo-mcp` server from TC-33.
- Expected: **no "Add Environment Variable"** item (Claude Code `mcpEnvVars: false`).
- [ ] Pass  [ ] Fail   Notes: ______

### TC-41: No per-tool MCP toggle for Claude Code
1. Expand a Claude Code MCP server node.
- Expected: individual MCP tools (if any) show **no toggle** action (`mcpServerToolToggle: false`).
- [ ] Pass  [ ] Fail   Notes: ______

---

### Inline tool actions

### TC-42: Toggle a skill disables via `SKILL.md` rename (not the directory)
1. Toggle the installed `sample-skill` off (toggle icon or right-click → Toggle Enable/Disable).
- Expected: tree marks it `(disabled)`; on disk the file is renamed to `…/sample-skill/SKILL.md.disabled` while the **directory keeps its original name**. Toggling on restores `SKILL.md`.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-43: Re-enable a legacy directory-disabled skill
1. Simulate the old scheme: `mv /tmp/ack-test-home/.claude/skills/sample-skill /tmp/ack-test-home/.claude/skills/sample-skill.disabled`; refresh the tree; toggle it **on**.
- Expected: the directory is renamed back (`.disabled` suffix removed); skill re-enabled with its `SKILL.md` intact.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-44: Toggle a command
1. Toggle the `mycmd` command off, then on.
- Expected: file/dir gains/loses a `.disabled` suffix accordingly; tree status follows.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-45: Toggle an MCP server
1. Toggle `demo-mcp` off, then on.
- Expected: shows `(disabled)`; in config the server gets `"disabled": true` (it is NOT removed); toggling on clears it.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-46: Move a tool between scopes (with conflict)
1. Right-click `sample-skill` (user) → **Move To… → Project**. Then create a same-named project skill and move a user one again to force a conflict.
- Expected: tool relocates between `~/.claude/skills` and `{ws}/.claude/skills`; on a name clash a modal "already exists at project/global scope. Overwrite?" appears.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-47: Delete with confirmation, then "Don't Ask Again"
1. Right-click a tool → **Delete Tool**.
- Expected: modal "Delete …?" with detail "This action cannot be undone." and buttons **Delete** / **Delete & Don't Ask Again**.
2. Choose **Delete & Don't Ask Again**; delete another tool.
- Expected: first deletes; the setting `ack.skipDeleteConfirmation` flips to `true` (check Settings); the second delete proceeds with no prompt.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-48: Open Tool Source
1. Click a leaf tool (or right-click → Open Tool Source).
- Expected: the backing file opens (e.g. the skill's `SKILL.md`, or `~/.claude.json` for an MCP server).
- [ ] Pass  [ ] Fail   Notes: ______

### TC-49: Refresh the tree
1. Run `ACK: Refresh Tool Tree` (or the refresh icon).
- Expected: tree rebuilds without error; current tools remain.
- [ ] Pass  [ ] Fail   Notes: ______

---

### Provider seam rename + profile migration (regressions)

### TC-50: The adapter→provider rename is invisible
1. Use the extension normally; scan command titles, notifications, settings labels.
- Expected: no broken behavior and no user-facing "adapter" terminology; everything that worked in 1.x still works.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-51: A 1.x profile (no `agentId`) still loads (migration)
1. Seed a legacy profile into globalState before launch is awkward, so instead verify the migration path: create a profile (TC-53), then inspect that profiles carry `agentId: "claude-code"`; Output logs `Migrated N profiles to Claude Code scope` only when legacy ones exist.
- Expected: profiles load and switch normally; legacy ones are silently migrated to Claude Code scope (idempotent — no repeated migration on relaunch).
- [ ] Pass  [ ] Fail   Notes: ______

### TC-52: Profiles are scoped per agent
1. Create a profile while Claude Code is active. Activate Codex (scaffolded) and open the profile list.
- Expected: the Claude-Code profile does NOT appear under Codex. *(Switching back shows it again. The Codex-active half overlaps Blocked B-5 for full tool behavior.)*
- [ ] Pass  [ ] Fail   Notes: ______

---

### Profiles

### TC-53: Create a profile by selecting tools
> Profiles are now built by **picking** which tools to enable (not by snapshotting
> the current state). Each profile is a **complete preset**: selected tools are
> enabled and every other tool is turned off when you switch to it.
1. Activate an agent that has several tools (the QA seed `docs/qa/seed-sandbox.sh` gives every agent skills/MCP/prompts; or install a few via TC-22 / TC-29 / TC-33).
2. `ACK: Create Profile` → name it `setA`.
3. In the multi-select that appears, confirm: tools are **grouped by type** (Skills / MCP Servers / Commands / Hooks / Custom Prompts) with separators; **nothing is pre-checked** (blank slate); each row shows its scope and ` · on` for tools that are currently enabled.
4. Check a subset (e.g. one skill + one MCP server) → OK.
- Expected: toast `Profile "setA" created — 2 of N tools enabled`; `setA` appears in the profile list; the sidebar header shows the active profile name.
5. Run `ACK: Save Tools as Profile` → name `setB`.
- Expected: it opens the **same** tool-selection picker (the old snapshot-everything "Save Current State" behavior is gone; both commands now select tools).
- [ ] Pass  [ ] Fail   Notes: ______

### TC-53a: Create — complete-preset semantics, blank slate, cancel, empty selection
1. With two or three tools currently **enabled**, `ACK: Create Profile` → `presetC` → select only **one** of them in the picker → OK.
2. Manually toggle a couple of *other* tools **on**, then `ACK: Switch Profile` → `presetC`.
- Expected: switching enables exactly the one selected tool and **disables everything else** (complete preset) — the tools you turned on by hand are turned back off.
3. Cancel: `ACK: Create Profile` → enter a name → press **Esc** at the tool picker.
- Expected: no profile is created (Esc after the name aborts).
4. Empty preset: `ACK: Create Profile` → `presetEmpty` → press OK with **nothing** checked.
- Expected: the profile is created as a valid "all-off" preset; toast reads `0 of N tools enabled`; switching to it disables every toggleable tool.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-54: Switch profile applies tool state (+ reports missing)
1. `ACK: Create Profile` → select a subset of tools (some checked, some left off). Manually change a few tool states, then `ACK: Switch Profile` back to that profile.
- Expected: tool states reapply to match the profile (selected → enabled, unselected → disabled). If the profile references a tool no longer on disk, a message notes `N not found` (report-and-skip — no auto-install).
- [ ] Pass  [ ] Fail   Notes: ______

### TC-55: Edit and delete a profile
1. `ACK: Edit Profile` → pick `setA` → **Rename**. `ACK: Edit Profile` → pick `setB` → **Delete** (or `ACK: Delete Profile`).
- Expected: changes reflected in the list immediately; deleting the active profile clears the sidebar header.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-55a: Edit Tools — re-sync a profile to the current tool set
> Covers the "a preset is only complete as of creation time" fix: editing re-captures
> **every** current tool, including ones added after the profile was made.
1. `ACK: Create Profile` → `editMe` → select **one** skill (leave the rest unchecked) → OK.
2. Add a **new** tool to the active agent *after* creating the profile — install a skill (TC-22) or add an MCP server (TC-33), or drop one on disk and run `ACK: Refresh Tool Tree`.
3. `ACK: Edit Profile` → pick `editMe` → **Edit Tools**.
- Expected: the picker opens with the profile's currently-**enabled** tools **pre-checked**; the tool you just added appears in the list **unchecked** (it wasn't in the profile). Custom Prompts also appear (regression check — they were previously omitted from the edit picker).
4. Check the new tool (optionally uncheck the original) → OK.
- Expected: toast `Profile "editMe" updated — K of M tools enabled`; `ACK: Switch Profile` → `editMe` now enables the newly-added tool and applies the rewritten complete preset (the new tool is no longer left untouched).
5. Cancel: re-open **Edit Tools** and press **Esc**.
- Expected: the profile is left unchanged.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-56: Export a profile
1. `ACK: Export Profile` → choose `setA` → save JSON.
- Expected: a JSON bundle is written containing the profile and agent-compatibility metadata (its `agentId`).
- [ ] Pass  [ ] Fail   Notes: ______

### TC-57: Import a profile (same agent + legacy conversion)
1. `ACK: Import Profile` → select the file from TC-56.
- Expected: imported and visible; tools missing on disk are reported (`X not found` / `X tool(s) skipped (not supported by Claude Code)`), nothing fetched.
2. Hand-craft a v1 bundle (remove `version`/`agentId` from the JSON) and import it.
- Expected: prompt "This profile was created for … Convert to Claude Code?"; on convert, incompatible tools are skipped and listed.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-58: Associate a profile with the workspace + auto-activate
1. With `/tmp/ack-test-ws` open, `ACK: Associate Profile with Workspace` → pick `setA`.
2. Close and reopen the folder (or relaunch).
- Expected: `.vscode/agent-profile.json` is written (agent-scoped); on reopen, with `ack.autoActivateWorkspaceProfiles` on, `setA` auto-activates with a `Switched to profile: setA` toast; any missing tools are reported.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-59: Disable workspace auto-activation
1. Set `ack.autoActivateWorkspaceProfiles` to `false`; reopen the folder.
- Expected: the associated profile does NOT auto-activate.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-60: Clone profile to another agent — see Blocked B-6
- [ ] N/A in this environment

---

### Config panel

### TC-61: Open the config panel
1. `ACK: Configure Agent` (`ack.openConfigPanel`).
- Expected: a webview opens with form fields for model, permissions, custom instructions, and MCP configuration (no raw JSON editing required); icons render.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-62: Edit and save a setting
1. Change a field (e.g. model or a permission) and Save.
- Expected: the value persists to the underlying Claude Code config file; the Save button disables while saving and shows a success confirmation; it does **not** get stuck on "Saving…".
- [ ] Pass  [ ] Fail   Notes: ______

### TC-63: Profiles inside the panel
1. In the panel, view the profiles list/editor.
- Expected: profiles created via commands appear here and stay in sync after a save.
- [ ] Pass  [ ] Fail   Notes: ______

---

### File watcher / change notifications

### TC-64: External config edit refreshes the tree
1. With `ack.showChangeNotifications` true, edit a watched file outside VS Code, e.g. `echo '{}' >> /tmp/ack-test-home/.claude/settings.json` (or add a server to `~/.claude.json`).
- Expected: the tree refreshes automatically and an `ACK: Config updated` toast appears.
- [ ] Pass  [ ] Fail   Notes: ______

### TC-65: Notifications can be silenced
1. Set `ack.showChangeNotifications` to `false`; edit a watched file again.
- Expected: the tree still refreshes, but no toast is shown.
- [ ] Pass  [ ] Fail   Notes: ______

---

## Blocked / out-of-environment

These need Codex or GitHub Copilot actually installed/active and cannot be fully
exercised with Claude Code only. Detection of both **is** covered above (scaffolded);
what remains blocked is their **write/install** behavior.

### B-1: Codex MCP server writes to `config.toml` (TOML, not JSON) — **[Requires Codex]**
With Codex active, `Add MCP Server` should embed the server in `~/.codex/config.toml`
(or `{root}/.codex/config.toml`), valid TOML. *(Can partly observe by activating a
scaffolded Codex and adding a server, but verifying a real Codex consumes it needs Codex.)*

### B-2: Codex MCP env-var editing — **[Requires Codex]**
Codex has `mcpEnvVars: true`, so Add/Edit/Remove Environment Variable menus appear on
Codex MCP servers and must write valid TOML. Not available under Claude Code.

### B-3: Codex custom-prompt install (`~/.codex/prompts/*.md`) — **[Requires Codex]**
`+` on the Custom Prompts group / `ACK: Install Custom Prompt from File` installs a `.md`
prompt for Codex, with an overwrite confirmation. Gated off for Claude Code.

### B-4: Codex has no commands — **[Requires Codex]**
With Codex active, the Commands group install should be unavailable (`getCommandsDir`
throws `ProviderScopeError`). Capability-gating only verifiable with Codex active.

### B-5: Copilot detection + instruction/prompt routing — **[Requires Copilot]**
Copilot uses `hideWhenUndetected: true` and routes `*.instructions.md` / `*.prompt.md`
into `.github/`. Most Copilot write ops are not yet implemented (Phase 21+) and will
throw — confirm graceful handling when Copilot is the active agent.

### B-6: Clone profile to another agent (`ACK: Clone Profile to Agent`) — **[Requires 2nd agent]**
Cloning copies a profile to a target agent, filtering to compatible tools. Needs a real
second agent to verify the filtered result is usable there.

---

## Teardown

```bash
rm -rf /tmp/ack-test-home /tmp/ack-edh-userdata /tmp/ack-test-ws \
       /tmp/sample-skill /tmp/empty-skill /tmp/mycmd.md /tmp/mycmd-folder
```
Remove the "Run Extension (QA sandbox)" entry from `.vscode/launch.json` if you don't
want to keep it. Your real `~/.claude` was never touched (all paths were sandboxed via `HOME`).
