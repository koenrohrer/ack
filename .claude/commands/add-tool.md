Add a new tool to the registry at path $ARGUMENTS.

The argument should be in the format: TYPE/TOOL-NAME (e.g., skills/my-new-skill, mcp_servers/my-server, hooks/my-hook, commands/my-command).

Steps:
1. Parse the type from the directory prefix (skills -> skill, mcp_servers -> mcp_server, hooks -> hook, commands -> command)
2. Create the directory at the given path
3. Create manifest.json with all required fields:
   - type: parsed from directory
   - name: derived from directory name (kebab-case)
   - version: "1.0.0"
   - description: "" (ask me for a description)
   - For skills: files: ["SKILL.md"], config: {}
   - For mcp_servers: runtime, config.command, config.args, config.env (ask me for details)
   - For hooks: config.event, config.matcher, config.hooks (ask me for details)
   - For commands: files: ["command-name.md"], config: {}
4. Create a README.md with a template:
   - Tool name as H1
   - Description section
   - Installation section (mention ACK extension)
   - Configuration section (if applicable)
   - Usage section
5. Create the tool-specific files:
   - Skills: Create SKILL.md with a placeholder
   - Commands: Create the .md file referenced in files[]
   - Hooks/MCP: No additional files needed
6. Remind me to run /update-registry-index to add it to registry.json
