Perform a comprehensive audit of the entire tools registry.

Check all of the following:

1. **registry.json integrity:**
   - Valid JSON
   - Has required top-level fields: version, lastUpdated, tools
   - No duplicate tool IDs
   - All entries have required fields: id, name, type, description, author, version, tags, readmePath, contentPath

2. **Tool directory completeness:**
   - Every entry in registry.json has a corresponding directory on disk
   - Every tool directory on disk has an entry in registry.json
   - Flag orphaned directories (on disk but not in index) and ghost entries (in index but not on disk)

3. **Manifest validation (for each tool):**
   - manifest.json exists and is valid JSON
   - Has required fields: type, name, version, config
   - Version is valid semver
   - Type matches directory prefix
   - All files in files[] exist on disk

4. **README coverage:**
   - Every tool has a README.md
   - README is non-empty (more than just a title)

5. **Consistency checks:**
   - registry.json entry version matches manifest.json version
   - registry.json entry name matches manifest.json name
   - registry.json entry type matches manifest.json type
   - contentPath points to an actual directory

6. **Quality signals:**
   - Tools with empty descriptions
   - Tools with no tags
   - Tools with version "0.0.0" or "0.0.1" (possibly unpublished)

Print a structured report:
- PASS: checks that passed with count
- WARN: non-blocking issues
- FAIL: blocking issues that need fixing
- Summary line: "X tools audited, Y passed, Z warnings, W failures"
