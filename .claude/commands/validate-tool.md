Validate the tool at path $ARGUMENTS against the registry manifest schema.

Check ALL of the following:

1. **manifest.json exists** at the given path
2. **Required fields present:** type, name, version, config
3. **Type is valid:** must be one of: skill, mcp_server, hook, command
4. **Version is semver:** matches X.Y.Z format
5. **Directory matches type:** path starts with the correct type directory (skills/, mcp_servers/, hooks/, commands/)
6. **README.md exists** in the tool directory
7. **Files referenced exist:** every entry in manifest.files[] has a corresponding file in the directory
8. **Type-specific validation:**
   - skill: must have files[] with at least one entry
   - mcp_server: must have config.command and config.args
   - hook: must have config.event and config.hooks
   - command: must have files[] with at least one entry
9. **Name consistency:** manifest.name matches directory name
10. **No extra unexpected files** that are not referenced in manifest.json or README.md

Print a clear PASS/FAIL report with details for each check.
