Generate or update the README.md for the tool at path $ARGUMENTS.

1. Read the tool's manifest.json to understand its type, name, description, config, and files
2. Generate a comprehensive README.md with these sections:

   # {Tool Name}

   {Description from manifest, expanded into 2-3 sentences}

   ## Installation

   Install via the [ACK extension](https://marketplace.visualstudio.com/items?itemName=koenrohrer.agent-config-keeper) for VS Code:
   1. Open the ACK Marketplace panel
   2. Search for "{tool name}"
   3. Click Install

   ## Configuration

   {For mcp_servers: list all env vars from config.env with descriptions}
   {For hooks: describe the event trigger and matcher}
   {For skills/commands: note if no configuration needed}

   ## Usage

   {Type-specific usage instructions:}
   {- Skills: "This skill is automatically available in your Claude context"}
   {- MCP Servers: "The server provides the following capabilities..."}
   {- Hooks: "This hook triggers on {event} when {matcher condition}"}
   {- Commands: "Use this command with: /command-name [args]"}

   ## Files

   | File | Purpose |
   |------|---------|
   {List each file in manifest.files[] with a description}

3. If README.md already exists, show me a diff of proposed changes before overwriting
