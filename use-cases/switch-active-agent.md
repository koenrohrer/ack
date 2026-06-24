# Use Case: Detect and Switch the Active AI Agent

> **Status:** Draft  ·  **Created:** 2026-06-20  ·  **Type:** Software

## 1. Brief Description

ACK determines which supported AI agents are installed on the machine and lets the developer choose which one ACK currently manages. Switching re-points the entire UI — the tool tree, profiles, and file watchers — at the selected agent. Exactly one agent is active at a time, and the choice persists across restarts. The value is a **single control surface** that adapts to whichever agent you are working with, without learning three different config formats.

## 2. Actors

| Actor | Type | Role in this use case |
|-------|------|-----------------------|
| Developer | Human | Chooses / changes the active agent. **Initiator** (also triggered automatically at startup). |
| Candidate AI agents | External systems | Claude Code, Codex, GitHub Copilot — each detected by the presence of its config footprint or installed VS Code extension |
| Provider registry | Internal component | Holds registered providers; runs detection; tracks the active id |
| VS Code extension host | External system | Status bar, quick pick, persisted global state, file watchers |

_Primary actor (initiator):_ Developer (interactive switch) or the extension itself (startup detection).

## 3. Preconditions

- ACK is active. (Zero detected agents is a valid, handled state.)

## 4. Basic Flow (Main Success Scenario)

1. On startup, ACK runs `detect()` on every registered provider.
2. ACK reconciles a selection: if a previously-active agent is persisted **and** still detected, restore it; else if exactly one agent is detected, auto-select it; else defer to the developer.
3. ACK sets the active-agent context, updates the status bar, points file watchers at the active agent's paths, and refreshes the tree.
4. Developer clicks the status bar item — or runs *ACK: Switch Agent* — to change the active agent.
5. ACK shows a quick pick of agents; detected agents are selectable, undetected ones are shown as such, except agents marked `hideWhenUndetected` (Copilot) which are omitted while absent.
6. Developer selects an agent; ACK persists it and re-points every UI surface (status bar, watchers, tree, open panels, and workspace-profile auto-activation for the new agent).

## 5. Alternative Flows (Extensions)

### 5a. No agents detected — branches from step 2
- ACK shows "No supported agent platforms detected…" and the tree falls back to its welcome view. The developer can install an agent and re-detect.

### 5b. Multiple detected, none persisted — branches from step 2
- ACK shows "Multiple agents detected. Use the status bar to select one." and waits for an interactive choice.

### 5c. Re-detect requested — branches from step 1
- Developer runs *ACK: Re-detect Agents*; ACK re-runs detection, logs results, and may prompt to switch to a newly-found agent.

### 5d. Agent-specific first-run setup — branches from step 3
- A detected agent needs setup (e.g. Codex with no `config.toml`): ACK offers to create it; the developer's dismissal is remembered. ⚠️ In 2.0 this moves behind a generic provider lifecycle hook rather than a hard-coded per-agent branch.

### 5e. Active agent's config later disappears — branches from step 2 (next run)
- On the next detection the agent is no longer restorable; ACK falls through to auto-select-one or the no-agent state.

## 6. Postconditions

- Exactly one (or zero) active agent.
- The selection is persisted across sessions.
- The tree, profiles, watchers, and any open panels all reflect the active agent.

## 7. Business Rules

- Exactly one active agent at a time.
- Auto-selection happens only when exactly one agent is detected; otherwise the developer chooses.
- `hideWhenUndetected` agents are never shown while absent.
- The tree and profiles are always scoped to the active agent.

## 8. Nonfunctional Requirements

- **Performance:** detection across all providers completes ≤ ~2 s at startup; an interactive switch re-renders the tree ≤ ~1–2 s. ⚠️ targets to confirm.
- **Reliability:** detection is side-effect-free apart from the persisted selection; a failure detecting one agent does not block detecting the others.
- **Security & privacy:** detection and switching require no network and no account.
- **Usability:** the active agent is always visible in the status bar; switching is reachable from both the status bar and the command palette.

## 9. Assumptions

- An agent's installation is reliably inferable from its on-disk footprint or installed VS Code extension.
- The developer wants to manage one agent at a time rather than a merged multi-agent view.

## 10. Notes / Additional Information

- The provider-registry design is what makes adding a fourth agent "write one provider and register it" — a core ACK 2.0 goal.
- Switching agent also re-evaluates whether the current workspace has an associated profile for the newly active agent.
- Related use cases: *Discover and Inspect Installed Agent Tools*; *Capture, Switch, and Share Tool Profiles*.
