Bump the version of the tool at path $ARGUMENTS.

1. Read the current manifest.json
2. Parse the current version (must be semver X.Y.Z)
3. Ask me what type of bump: major, minor, or patch
4. Calculate the new version
5. Update manifest.json with the new version
6. If a CHANGELOG.md exists in the tool directory, add a new entry at the top:
   ## [NEW_VERSION] - YYYY-MM-DD
   - (ask me for changelog entry)
7. If no CHANGELOG.md exists, ask if I want to create one
8. Remind me to run /update-registry-index to sync the version to registry.json
