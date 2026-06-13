# Releasing ACK

ACK publishes the Visual Studio Marketplace extension `koenrohrer.ack`.

## One-time GitHub setup

1. Create the GitHub Environment `vscode-marketplace`.
2. Add any required reviewers to that environment so Marketplace publishing requires approval.
3. Create a Visual Studio Marketplace publishing credential.
   - Follow the official VS Code publishing guidance: <https://code.visualstudio.com/api/working-with-extensions/publishing-extension>.
   - Microsoft recommends Entra ID-based publishing for long-running automation.
   - If using a Personal Access Token, create it in Azure DevOps with the Marketplace `Manage` scope and the shortest practical expiration.
4. Store the credential as the `VSCE_PAT` secret on the `vscode-marketplace` environment.

Do not store `VSCE_PAT` as a repository secret unless the environment cannot be used. Pull request CI never receives this secret.

## Patch release flow

From a clean `master` checkout:

```bash
npm ci
npm run check-types
npm run lint
npm run test:unit
npm run package
npx @vscode/vsce package
npm version patch
git push origin master --follow-tags
```

Pushing the `v*` tag starts the release workflow. The workflow reruns the blocking verification gate, packages the VSIX, waits for the `vscode-marketplace` environment approval, publishes with `VSCE_PAT`, and attaches the VSIX to the GitHub release.

`workflow_dispatch` can also run the release workflow manually from GitHub Actions. Run it only from `master` or a `v*` tag, and only for an intentional Marketplace publish.

## CI artifacts vs Marketplace publishing

Green CI on pull requests and pushes to `master` produces an installable `ack.vsix` artifact. It does not publish to the Marketplace.

Marketplace publishing happens only through the release workflow on a pushed `v*` tag or an approved manual `workflow_dispatch` run.

## Integration test gap

`npm run test:integration` currently fails before running tests because the repo has no `.vscode-test` config. CI and release workflows run it as a visible non-blocking probe and write the gap to the workflow summary. After adding CI-ready VS Code extension-host tests, make that step blocking in both workflows.
