Regenerate the registry.json index file from the actual tool directories on disk.

Steps:
1. Read the current registry.json to preserve existing metadata (stars, installs, createdAt)
2. Scan all four type directories: skills/, mcp_servers/, hooks/, commands/
3. For each tool directory found:
   a. Read its manifest.json
   b. If tool exists in current registry.json, preserve: stars, installs, createdAt, author
   c. If tool is NEW (not in registry.json), set: stars=0, installs=0, createdAt=now, author="" (ask me)
   d. Always update: updatedAt=now, and sync name/type/version/description from manifest.json
   e. Set readmePath to TYPE_DIR/TOOL_NAME/README.md
   f. Set contentPath to TYPE_DIR/TOOL_NAME
   g. Generate id as TYPE/TOOL_NAME (e.g., "skills/my-skill")
   h. Set tags from manifest description keywords or existing tags
4. Remove entries for tools that no longer have directories on disk
5. Sort tools array by type, then by name
6. Update the top-level lastUpdated to current ISO timestamp
7. Keep version field unchanged (bump manually)
8. Write the formatted registry.json with 2-space indentation

Show me a diff summary of what changed (added, removed, updated tools) before writing.
