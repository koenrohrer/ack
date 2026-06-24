# Use Case: Capture, Switch, and Share Tool Profiles

> **Status:** Draft  ·  **Created:** 2026-06-20  ·  **Type:** Software

## 1. Brief Description

A profile is a named snapshot of which tools are enabled or disabled for an agent. The developer captures their current setup as a profile, switches between profiles to reshape the agent's tool set in one action, optionally associates a profile with a workspace so it auto-activates, and can export/import profiles to share a setup. The value is **fast, repeatable context switching**: "manually toggling ten tools for this project" becomes one click, and the same curated set can be reused or shared.

## 2. Actors

| Actor | Type | Role in this use case |
|-------|------|-----------------------|
| Developer | Human | Creates, switches, edits, associates, exports/imports profiles. **Initiator.** |
| Active provider | Internal component | Applies toggles on switch; defines tool identity, supported types, and toggleability |
| Profile store (VS Code global state) | External system | Persists profiles, keyed by `agentId` |
| Active AI agent's config store | External system (on-disk) | Mutated when a profile is applied |
| File system | External system | Holds exported/imported `.ackprofile` bundles |

_Primary actor (initiator):_ Developer (also the extension, for workspace auto-activation on folder open).

## 3. Preconditions

- ACK is active and an agent is active.
- At least one tool exists to capture (for create); at least one profile exists (for switch/edit/export).
- For workspace association/auto-activation, a workspace folder is open.

## 4. Basic Flow (Main Success Scenario) — Create then Switch

1. Developer runs *ACK: Create Profile* and enters a name.
2. ACK snapshots the current enabled/disabled state of the active agent's tools into a new profile, scoped to that agent's id.
3. Later, the developer runs *ACK: Switch Profile* and picks a profile.
4. ACK diffs the profile against the current state and toggles, via the provider, only the tools that differ.
5. ACK reports the outcome: tools changed, tools not found (skipped), and non-toggleable/incompatible tools skipped.
6. The sidebar header shows the active profile's name.

## 5. Alternative Flows (Extensions)

### 5a. Profile references a tool not installed locally — branches from step 4
- The tool is **skipped and reported** — no install offer. **Decided:** report-and-skip only (matches `switchProfile`'s existing behavior). A local-install offer was rejected because profiles store tool *references*, not content, so ACK cannot fulfill a missing tool automatically anyway.

### 5b. Profile contains a type the active agent can't toggle — branches from step 4
- The entry is skipped with an explanatory message (e.g. MCP servers on Copilot).

### 5c. Import a profile built for a different agent — branches from an import trigger
- ACK detects the agent mismatch and offers to convert, keeping compatible tools and listing the skipped ones; the developer confirms before anything is created.

### 5d. Export a profile
- ACK warns that the bundle may contain secrets in MCP environment variables before writing the `.ackprofile` file, so the developer can review before sharing.

### 5e. Name collision on create/import — branches from step 1 (or import)
- ACK warns and offers to overwrite or import under a "(imported)" suffix.

### 5f. Workspace auto-activation — branches from folder-open
- On opening a workspace, if it is associated with a profile for the *active* agent and no manual override is recorded (and `ack.autoActivateWorkspaceProfiles` is on), ACK switches to that profile automatically. Missing tools are reported with a plain warning (2.0: no marketplace prompt).

### 5g. Edit / rename / delete / clone-to-agent
- Each is its own sub-flow: edit-tools via a multi-select picker, rename (with collision check and association update), delete (modal confirm), and clone-to-agent (copy compatible tools into a new profile for another agent).

## 6. Postconditions

- Profiles are persisted in global state, scoped per agent.
- After a switch, the agent's config matches the profile (minus skipped tools); the active profile name is shown.
- Any workspace association or manual override is recorded as applicable.

## 7. Business Rules

- A profile belongs to exactly one agent (`agentId`-scoped); switching agent shows that agent's profiles.
- Only non-**Managed** tools are profileable.
- Switching toggles only the differences (diff-based), not a blind re-apply.
- Export carries a secrets warning; bundles are plain, inspectable JSON.
- Switching away from an associated profile records a manual override until the developer switches back.
- Reconciliation prunes stale tool entries (tools deleted since the profile was created).

## 8. Nonfunctional Requirements

- **Performance:** applying a typical profile completes within ~2 s. ⚠️ target to confirm.
- **Reliability:** a switch is effectively transactional — partial failures are reported, never silently swallowed; an interrupted switch leaves configs readable (atomic writes + backups).
- **Security & privacy:** no secret leaves the machine without an explicit export plus warning; no network is involved in any profile operation.
- **Usability:** the active profile is visible in the sidebar header; switch/edit pickers show accurate (reconciled) tool counts.

## 9. Assumptions

- Developers genuinely want per-project / per-task tool sets.
- VS Code global state is durable across sessions.
- Exported bundles are shared deliberately (the team-sharing reach), with the developer accepting responsibility for any secrets they choose to include.

## 10. Notes / Additional Information

- Profiles are intentionally a **shared, agent-agnostic service**, not a per-provider concern — the provider only supplies the tool identity and capability data profiles consume.
- The 1.x behavior of auto-installing missing tools from the marketplace during import/auto-activation is intentionally removed in 2.0.
- Related use cases: *Enable, Organize, and Install Agent Tools from Local Sources*; *Detect and Switch the Active AI Agent*.
