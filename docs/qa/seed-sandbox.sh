#!/usr/bin/env bash
#
# Seed the ACK QA sandbox with one basic tool of every type each provider
# supports, so the Extension Development Host ("Run Extension (QA sandbox)")
# shows real, testable tools for all five agents.
#
# Paths match .vscode/launch.json:
#   HOME           -> /tmp/ack-test-home   (isolates ~/.claude ~/.codex ~/.pi ~/.hermes ~/.claude.json)
#   --user-data-dir-> /tmp/ack-edh-userdata (Copilot user-scope mcp.json lives under here)
#   open folder    -> /tmp/ack-test-ws     (Project scope)
#
# Idempotent: re-running overwrites the seeded files to a known state. It does
# NOT delete anything else. For a fully clean slate first run:
#   rm -rf /tmp/ack-test-home /tmp/ack-test-ws /tmp/ack-edh-userdata
#
# After seeding: press F5 -> "Run Extension (QA sandbox)", open /tmp/ack-test-ws,
# then use "ACK: Switch Agent" (or the multi-agent chooser) to test each agent.
set -euo pipefail

HOME_DIR=/tmp/ack-test-home
WS=/tmp/ack-test-ws
USERDATA=/tmp/ack-edh-userdata

MCP_CMD='"npx"'
MCP_ARGS='["-y", "@modelcontextprotocol/server-everything"]'

seed() { # $1 = path; file body on stdin
  mkdir -p "$(dirname "$1")"
  cat > "$1"
  echo "  + $1"
}

echo "Seeding ACK QA sandbox (HOME=$HOME_DIR, WS=$WS)"
mkdir -p "$HOME_DIR" "$WS" "$USERDATA/User"

# ===========================================================================
# Claude Code  (detect: ~/.claude dir or ~/.claude.json)  types: skill, command, mcp, hook
# ===========================================================================
echo "Claude Code:"
seed "$HOME_DIR/.claude/skills/hello-claude/SKILL.md" <<'EOF'
---
name: hello-claude
description: Basic seeded Claude Code skill for QA testing.
---
# Hello (Claude Code)
Seeded skill body.
EOF

seed "$HOME_DIR/.claude/commands/greet.md" <<'EOF'
---
description: Seeded Claude Code greeting command.
argument-hint: <name>
---
Say hello to $1.
EOF

seed "$HOME_DIR/.claude.json" <<EOF
{
  "mcpServers": {
    "everything": { "command": $MCP_CMD, "args": $MCP_ARGS }
  }
}
EOF

seed "$HOME_DIR/.claude/settings.json" <<'EOF'
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "echo seeded-pretooluse-hook" } ] }
    ]
  }
}
EOF

# Claude Code — Project scope (in the workspace)
seed "$WS/.claude/skills/proj-claude/SKILL.md" <<'EOF'
---
name: proj-claude
description: Seeded Claude Code project-scope skill.
---
Project skill body.
EOF
seed "$WS/.claude/commands/proj-greet.md" <<'EOF'
---
description: Seeded Claude Code project command.
---
Project greeting.
EOF
seed "$WS/.mcp.json" <<EOF
{
  "mcpServers": {
    "proj-server": { "command": $MCP_CMD, "args": $MCP_ARGS }
  }
}
EOF
seed "$WS/.claude/settings.json" <<'EOF'
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Write", "hooks": [ { "type": "command", "command": "echo seeded-project-hook" } ] }
    ]
  }
}
EOF

# ===========================================================================
# Codex  (detect: ~/.codex/config.toml | prompts/ | skills/)  types: skill, mcp, custom_prompt
# ===========================================================================
echo "Codex:"
seed "$HOME_DIR/.codex/config.toml" <<EOF
model = "gpt-5-codex"

[mcp_servers.everything]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-everything"]

[mcp_servers.disabled_demo]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-time"]
enabled = false
EOF

seed "$HOME_DIR/.codex/skills/hello-codex/SKILL.md" <<'EOF'
---
name: hello-codex
description: Basic seeded Codex skill for QA testing.
---
Seeded Codex skill body.
EOF

seed "$HOME_DIR/.codex/prompts/review.md" <<'EOF'
---
description: Seeded Codex custom prompt.
argument-hint: <path>
---
Review the changes in $1.
EOF

# Codex — Project scope
seed "$WS/.codex/config.toml" <<'EOF'
[mcp_servers.proj_server]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-everything"]
EOF
seed "$WS/.codex/skills/proj-codex/SKILL.md" <<'EOF'
---
name: proj-codex
description: Seeded Codex project-scope skill.
---
Project Codex skill body.
EOF

# ===========================================================================
# Pi  (detect: ~/.pi/agent dir | settings.json | mcp.json)  types: skill, mcp, custom_prompt
# ===========================================================================
echo "Pi:"
seed "$HOME_DIR/.pi/agent/settings.json" <<'EOF'
{ "theme": "default" }
EOF

seed "$HOME_DIR/.pi/agent/skills/hello-pi/SKILL.md" <<'EOF'
---
name: hello-pi
description: Basic seeded Pi skill for QA testing.
---
Seeded Pi skill body.
EOF

seed "$HOME_DIR/.pi/agent/prompts/review.md" <<'EOF'
---
description: Seeded Pi prompt template.
argument-hint: <path>
---
Review $1.
EOF

seed "$HOME_DIR/.pi/agent/mcp.json" <<EOF
{
  "settings": { "toolPrefix": "mcp" },
  "mcpServers": {
    "everything": { "command": $MCP_CMD, "args": $MCP_ARGS, "transport": "stdio", "lifecycle": "lazy" },
    "remote-demo": { "url": "https://mcp.example.com/mcp", "transport": "streamable-http", "lifecycle": "eager" }
  }
}
EOF

# Pi — Project scope
seed "$WS/.pi/skills/proj-pi/SKILL.md" <<'EOF'
---
name: proj-pi
description: Seeded Pi project-scope skill.
---
Project Pi skill body.
EOF
seed "$WS/.pi/prompts/proj.md" <<'EOF'
---
description: Seeded Pi project prompt template.
---
Project Pi prompt.
EOF
seed "$WS/.pi/mcp.json" <<EOF
{
  "mcpServers": {
    "proj-server": { "command": $MCP_CMD, "args": $MCP_ARGS, "transport": "stdio" }
  }
}
EOF

# ===========================================================================
# Hermes  (detect: ~/.hermes dir | config.yaml)  types: mcp, skill, custom_prompt(SOUL.md)
# user scope only in the sandbox (managed /etc/hermes is not seeded).
# ===========================================================================
echo "Hermes:"
seed "$HOME_DIR/.hermes/config.yaml" <<'EOF'
model: hermes-4
mcp_servers:
  everything:
    command: npx
    args:
      - "-y"
      - "@modelcontextprotocol/server-everything"
    env:
      EXAMPLE_TOKEN: seed-value
  legacy-disabled:
    url: https://mcp.legacy.example/mcp
    enabled: false
EOF

seed "$HOME_DIR/.hermes/skills/hello-hermes/SKILL.md" <<'EOF'
---
name: hello-hermes
description: Basic seeded Hermes skill for QA testing.
---
Seeded Hermes skill body.
EOF

seed "$HOME_DIR/.hermes/SOUL.md" <<'EOF'
You are a meticulous, concise engineering assistant. (Seeded SOUL.md identity.)
EOF

# ===========================================================================
# GitHub Copilot  (detect: GitHub.copilot VS Code extension — only appears if
# that extension is installed in the EDH).  types: mcp, custom_prompt, skill(agents)
# ===========================================================================
echo "GitHub Copilot (only visible if the Copilot extension is installed in the EDH):"
seed "$USERDATA/User/mcp.json" <<EOF
{
  "servers": {
    "user-everything": { "command": $MCP_CMD, "args": $MCP_ARGS }
  }
}
EOF
seed "$WS/.vscode/mcp.json" <<EOF
{
  "servers": {
    "everything": { "command": $MCP_CMD, "args": $MCP_ARGS }
  }
}
EOF
seed "$WS/.github/copilot-instructions.md" <<'EOF'
# Seeded Copilot instructions
Be concise and cite files by path.
EOF
seed "$WS/.github/instructions/general.instructions.md" <<'EOF'
---
applyTo: "**"
---
Seeded per-file Copilot instructions.
EOF
seed "$WS/.github/prompts/review.prompt.md" <<'EOF'
---
description: Seeded Copilot reusable prompt.
---
Review the current diff.
EOF
seed "$WS/.github/agents/helper.agent.md" <<'EOF'
---
name: helper
description: Seeded Copilot agent for QA testing.
---
You are a helper agent.
EOF

echo
echo "Done. Launch: F5 -> 'Run Extension (QA sandbox)', open folder $WS,"
echo "then use 'ACK: Switch Agent' to cycle Claude Code / Codex / Pi / Hermes"
echo "(Copilot appears only if its VS Code extension is installed in the EDH)."
