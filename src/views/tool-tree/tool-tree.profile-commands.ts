import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { ProfileService } from '../../services/profile.service.js';
import type { Profile } from '../../services/profile.types.js';
import { ProfileExportBundleSchema } from '../../services/profile.types.js';
import type { ConfigService } from '../../services/config.service.js';
import type { RegistryService } from '../../services/registry.service.js';
import type { InstallService } from '../../services/install.service.js';
import type { WorkspaceProfileService } from '../../services/workspace-profile.service.js';
import type { ToolTreeProvider } from './tool-tree.provider.js';
import type { ProfileToolEntry } from '../../services/profile.types.js';
import { ToolType, ConfigScope } from '../../types/enums.js';
import { canonicalKey } from '../../utils/tool-key.utils.js';

/**
 * QuickPick item that carries an optional profile reference.
 *
 * Used by the switch and edit commands to map selected items back to
 * the underlying profile (or null for "Current Environment").
 */
interface ProfileQuickPickItem extends vscode.QuickPickItem {
  profile: Profile | null;
}

/**
 * Build a QuickPick item for a profile, reconciling tool counts against the
 * current environment. Stale entries (tools deleted since profile creation)
 * are pruned automatically.
 */
async function reconcileAndBuildItem(
  p: Profile,
  profileService: ProfileService,
  activeId: string | null,
): Promise<ProfileQuickPickItem> {
  const { valid, removed } = await profileService.reconcileProfile(p.id);
  // Re-read profile after reconciliation to get updated data
  const updated = profileService.getProfile(p.id) ?? p;
  const desc = p.id === activeId
    ? '(active)'
    : removed > 0
      ? `${valid} tools (${removed} removed)`
      : `${valid} tools`;
  return { label: updated.name, description: desc, profile: updated };
}

/**
 * Register all profile management command handlers.
 *
 * Commands:
 * - createProfile: Snapshot current tool states into a new named profile
 * - switchProfile: Diff-based switch with progress notification
 * - editProfile: Rename, edit tools, or delete an existing profile
 * - deleteProfile: Delete with confirmation
 * - saveAsProfile: Alias for createProfile (discoverability)
 */
export function registerProfileCommands(
  context: vscode.ExtensionContext,
  profileService: ProfileService,
  configService: ConfigService,
  treeProvider: ToolTreeProvider,
  registryService: RegistryService,
  installService: InstallService,
  workspaceProfileService: WorkspaceProfileService,
): void {
  // ---------------------------------------------------------------------------
  // Create Profile
  // ---------------------------------------------------------------------------

  const createCmd = vscode.commands.registerCommand(
    'agent-config-keeper.createProfile',
    async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Profile name',
        placeHolder: 'e.g., Web Dev, Data Science, Minimal',
      });

      if (!name || !name.trim()) {
        return;
      }

      const trimmedName = name.trim();

      // Check for duplicate name
      const existing = profileService.getProfiles();
      if (existing.some((p) => p.name === trimmedName)) {
        vscode.window.showWarningMessage(`A profile named "${trimmedName}" already exists.`);
        return;
      }

      const profile = await profileService.createProfile(trimmedName);
      vscode.window.showInformationMessage(
        `Profile "${trimmedName}" created with ${profile.tools.length} tools`,
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Switch Profile
  // ---------------------------------------------------------------------------

  const switchCmd = vscode.commands.registerCommand(
    'agent-config-keeper.switchProfile',
    async () => {
      const profiles = profileService.getProfiles();
      if (profiles.length === 0) {
        vscode.window.showInformationMessage('No profiles saved. Create one first.');
        return;
      }

      const activeId = profileService.getActiveProfileId();

      const profileItems = await Promise.all(
        profiles.map((p) => reconcileAndBuildItem(p, profileService, activeId)),
      );

      const items: ProfileQuickPickItem[] = [
        {
          label: 'Current Environment (No Profile)',
          description: !activeId ? '(active)' : undefined,
          profile: null,
        },
        ...profileItems,
      ];

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a profile to switch to',
      });

      if (!selected) {
        return;
      }

      const targetId = selected.profile?.id ?? null;

      // Skip if already active
      if (targetId === activeId) {
        return;
      }

      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Switching profile...',
          cancellable: false,
        },
        async () => profileService.switchProfile(targetId),
      );

      if (targetId === null) {
        treeProvider.setActiveProfile(null);
        vscode.window.showInformationMessage('Profile deactivated');
        return;
      }

      const profileName = selected.profile!.name;
      treeProvider.setActiveProfile(profileName);
      const parts = [`Switched to "${profileName}": ${result.toggled} tools changed`];
      if (result.skipped) {
        parts.push(`${result.skipped} not found`);
      }
      vscode.window.showInformationMessage(parts.join(', '));

      if (result.failed > 0) {
        vscode.window.showWarningMessage(
          `${result.failed} toggle(s) failed: ${result.errors.join('; ')}`,
        );
      }

      // Track manual override if workspace has an association
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (wsRoot) {
        const assoc = await workspaceProfileService.getAssociation(wsRoot);
        if (assoc) {
          if (profileName === assoc.profileName) {
            // User switched back to the associated profile -- clear override
            await workspaceProfileService.clearOverride(wsRoot);
          } else {
            // User switched away from the associated profile -- record override
            await workspaceProfileService.setOverride(wsRoot, profileName);
          }
        }
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Edit Profile
  // ---------------------------------------------------------------------------

  const editCmd = vscode.commands.registerCommand(
    'agent-config-keeper.editProfile',
    async () => {
      const profiles = profileService.getProfiles();
      if (profiles.length === 0) {
        vscode.window.showInformationMessage('No profiles to edit.');
        return;
      }

      // Select which profile to edit (reconcile to show accurate counts)
      const activeId = profileService.getActiveProfileId();
      const profileItems = await Promise.all(
        profiles.map((p) => reconcileAndBuildItem(p, profileService, activeId)),
      );

      const selectedProfile = await vscode.window.showQuickPick(profileItems, {
        placeHolder: 'Select a profile to edit',
      });

      if (!selectedProfile || !selectedProfile.profile) {
        return;
      }

      const profile = selectedProfile.profile;

      // Show action picker
      const action = await vscode.window.showQuickPick(
        [
          { label: 'Rename', description: 'Change the profile name' },
          { label: 'Edit Tools', description: 'Change which tools are in this profile' },
          { label: 'Delete', description: 'Delete this profile' },
        ],
        { placeHolder: `Edit "${profile.name}"` },
      );

      if (!action) {
        return;
      }

      switch (action.label) {
        case 'Rename': {
          const newName = await vscode.window.showInputBox({
            prompt: 'New profile name',
            value: profile.name,
          });

          if (!newName || !newName.trim()) {
            return;
          }

          const trimmedName = newName.trim();

          // Check for duplicate name (excluding the current profile)
          const existing = profileService.getProfiles();
          if (existing.some((p) => p.id !== profile.id && p.name === trimmedName)) {
            vscode.window.showWarningMessage(`A profile named "${trimmedName}" already exists.`);
            return;
          }

          const oldName = profile.name;
          await profileService.updateProfile(profile.id, { name: trimmedName });
          // Update sidebar header if the renamed profile is the active one
          if (profileService.getActiveProfileId() === profile.id) {
            treeProvider.setActiveProfile(trimmedName);
          }
          // Update workspace association if it references the old name
          const renameWsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (renameWsRoot) {
            const assoc = await workspaceProfileService.getAssociation(renameWsRoot);
            if (assoc && assoc.profileName === oldName) {
              await workspaceProfileService.setAssociation(renameWsRoot, trimmedName);
            }
          }
          vscode.window.showInformationMessage(`Profile renamed to "${trimmedName}"`);
          break;
        }

        case 'Edit Tools': {
          await editProfileTools(profile, profileService, configService);
          break;
        }

        case 'Delete': {
          const wasActive = profileService.getActiveProfileId() === profile.id;
          const confirm = await vscode.window.showWarningMessage(
            `Delete profile "${profile.name}"?`,
            { modal: true, detail: 'This action cannot be undone.' },
            'Delete',
          );

          if (confirm !== 'Delete') {
            return;
          }

          await profileService.deleteProfile(profile.id);
          // Clear sidebar header if the deleted profile was active
          if (wasActive) {
            treeProvider.setActiveProfile(null);
          }
          vscode.window.showInformationMessage(`Profile "${profile.name}" deleted`);
          break;
        }
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Delete Profile
  // ---------------------------------------------------------------------------

  const deleteCmd = vscode.commands.registerCommand(
    'agent-config-keeper.deleteProfile',
    async () => {
      const profiles = profileService.getProfiles();
      if (profiles.length === 0) {
        vscode.window.showInformationMessage('No profiles to delete.');
        return;
      }

      const activeId = profileService.getActiveProfileId();
      const items = await Promise.all(
        profiles.map((p) => reconcileAndBuildItem(p, profileService, activeId)),
      );

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a profile to delete',
      });

      if (!selected || !selected.profile) {
        return;
      }

      const profile = selected.profile;
      const wasActive = profileService.getActiveProfileId() === profile.id;
      const confirm = await vscode.window.showWarningMessage(
        `Delete profile "${profile.name}"?`,
        { modal: true, detail: 'This action cannot be undone.' },
        'Delete',
      );

      if (confirm !== 'Delete') {
        return;
      }

      await profileService.deleteProfile(profile.id);
      // Clear sidebar header if the deleted profile was active
      if (wasActive) {
        treeProvider.setActiveProfile(null);
      }
      vscode.window.showInformationMessage(`Profile "${profile.name}" deleted`);
    },
  );

  // ---------------------------------------------------------------------------
  // Save Current State as Profile (delegates to createProfile)
  // ---------------------------------------------------------------------------

  const saveAsCmd = vscode.commands.registerCommand(
    'agent-config-keeper.saveAsProfile',
    async () => {
      await vscode.commands.executeCommand('agent-config-keeper.createProfile');
    },
  );

  // ---------------------------------------------------------------------------
  // Export Profile
  // ---------------------------------------------------------------------------

  const exportCmd = vscode.commands.registerCommand(
    'agent-config-keeper.exportProfile',
    async () => {
      const profiles = profileService.getProfiles();
      if (profiles.length === 0) {
        vscode.window.showInformationMessage('No profiles to export. Create one first.');
        return;
      }

      const activeId = profileService.getActiveProfileId();
      const profileItems = await Promise.all(
        profiles.map((p) => reconcileAndBuildItem(p, profileService, activeId)),
      );

      const selected = await vscode.window.showQuickPick(profileItems, {
        placeHolder: 'Select a profile to export',
      });

      if (!selected || !selected.profile) {
        return;
      }

      const bundle = await profileService.exportProfile(selected.profile.id);
      if (!bundle) {
        vscode.window.showErrorMessage('Failed to export profile: profile not found.');
        return;
      }

      const profileName = selected.profile.name;

      // Warn about potential secrets in MCP env vars
      const proceed = await vscode.window.showWarningMessage(
        'This export may contain API keys in MCP server environment variables. Review the file before sharing.',
        'Continue',
        'Cancel',
      );
      if (proceed !== 'Continue') {
        return;
      }

      const defaultDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
      const defaultUri = vscode.Uri.file(path.join(defaultDir, `${profileName}.agent-profile.json`));

      const uri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { 'Agent Profile': ['json'] },
        title: `Export Profile: ${profileName}`,
      });

      if (!uri) {
        return;
      }

      await fs.writeFile(uri.fsPath, JSON.stringify(bundle));
      vscode.window.showInformationMessage(`Profile "${profileName}" exported to ${uri.fsPath}`);
    },
  );

  // ---------------------------------------------------------------------------
  // Import Profile
  // ---------------------------------------------------------------------------

  const importCmd = vscode.commands.registerCommand(
    'agent-config-keeper.importProfile',
    async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'Agent Profile': ['json'] },
        title: 'Import Profile',
      });

      if (!uris || uris.length === 0) {
        return;
      }

      // Read and validate bundle
      let raw: string;
      try {
        raw = await fs.readFile(uris[0].fsPath, 'utf-8');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to read file: ${msg}`);
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        vscode.window.showErrorMessage('Invalid JSON file.');
        return;
      }

      const validation = ProfileExportBundleSchema.safeParse(parsed);
      if (!validation.success) {
        vscode.window.showErrorMessage(
          `Invalid profile bundle: ${validation.error.message}`,
        );
        return;
      }

      const bundle = validation.data;

      // Name collision check
      let finalName = bundle.profile.name;
      const existingProfiles = profileService.getProfiles();
      const nameConflict = existingProfiles.find((p) => p.name === finalName);

      if (nameConflict) {
        const choice = await vscode.window.showQuickPick(
          [
            { label: 'Overwrite existing', description: `Replace "${finalName}"` },
            { label: `Import as "${finalName} (imported)"`, description: 'Use a different name' },
            { label: 'Cancel', description: '' },
          ],
          { placeHolder: `A profile named "${finalName}" already exists` },
        );

        if (!choice || choice.label === 'Cancel') {
          return;
        }

        if (choice.label === 'Overwrite existing') {
          await profileService.deleteProfile(nameConflict.id);
        } else {
          finalName = `${finalName} (imported)`;
        }
      }

      // Analyze import
      const analysis = await profileService.analyzeImport(bundle);

      // Handle conflicts: ask per-tool
      const resolvedConflictKeys = new Set<string>();
      for (const conflict of analysis.conflicts) {
        const resolution = await vscode.window.showQuickPick(
          [
            { label: `Use imported config for "${conflict.exported.name}"`, useImported: true },
            { label: `Keep local config for "${conflict.exported.name}"`, useImported: false },
          ] as Array<vscode.QuickPickItem & { useImported: boolean }>,
          { placeHolder: `Config conflict: "${conflict.exported.name}"` },
        );

        if (!resolution) {
          continue; // Skip this conflict (keep local)
        }

        if ((resolution as { useImported: boolean }).useImported) {
          resolvedConflictKeys.add(conflict.exported.key);
        }
      }

      // Handle missing tools
      const skipped: string[] = [];
      if (analysis.missing.length > 0) {
        const missingNames = analysis.missing.map((t) => t.name).join(', ');
        const install = await vscode.window.showWarningMessage(
          `Missing tools: ${missingNames}. Try to install from marketplace?`,
          'Yes',
          'No',
        );

        if (install === 'Yes') {
          try {
            const indexes = await registryService.fetchAllIndexes(false);
            for (const missing of analysis.missing) {
              let found = false;
              for (const { source, index } of indexes.values()) {
                const entry = index.tools.find(
                  (t) => t.name === missing.name && t.type === missing.type,
                );
                if (entry) {
                  try {
                    const manifest = await installService.getToolManifest(source, entry.contentPath);
                    const result = await installService.install({
                      manifest,
                      scope: ConfigScope.User,
                      source,
                      contentPath: entry.contentPath,
                    });
                    if (result.success) {
                      found = true;
                      break;
                    }
                  } catch {
                    // Install failed -- add to skipped
                  }
                }
              }
              if (!found) {
                skipped.push(missing.name);
              }
            }
          } catch {
            // Registry fetch failed -- all missing become skipped
            for (const missing of analysis.missing) {
              skipped.push(missing.name);
            }
          }
        } else {
          for (const missing of analysis.missing) {
            skipped.push(missing.name);
          }
        }
      }

      // Create the profile with resolved tool entries
      const resolvedEntries: ProfileToolEntry[] = [];
      for (const tool of bundle.tools) {
        resolvedEntries.push({ key: tool.key, enabled: tool.enabled });
      }

      const newProfile = await profileService.createProfile(finalName);
      await profileService.updateProfile(newProfile.id, { tools: resolvedEntries });

      // Prompt to switch
      const switchAction = await vscode.window.showInformationMessage(
        `Profile "${finalName}" imported. Switch to it now?`,
        'Switch',
      );

      if (switchAction === 'Switch') {
        await profileService.switchProfile(newProfile.id);
        treeProvider.setActiveProfile(finalName);
        treeProvider.refresh();
      }

      if (skipped.length > 0) {
        vscode.window.showWarningMessage(
          `Import complete. Could not find: ${skipped.join(', ')}`,
        );
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Associate Profile with Workspace
  // ---------------------------------------------------------------------------

  const associateCmd = vscode.commands.registerCommand(
    'agent-config-keeper.associateProfile',
    async () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        vscode.window.showWarningMessage('No workspace folder open');
        return;
      }

      const wsRoot = folders[0].uri.fsPath;
      const profiles = profileService.getProfiles();
      if (profiles.length === 0) {
        vscode.window.showInformationMessage('No profiles saved. Create one first.');
        return;
      }

      const activeId = profileService.getActiveProfileId();
      const profileItems = await Promise.all(
        profiles.map((p) => reconcileAndBuildItem(p, profileService, activeId)),
      );

      const items: ProfileQuickPickItem[] = [
        {
          label: 'None (remove association)',
          description: undefined,
          profile: null,
        },
        ...profileItems,
      ];

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a profile to associate with this workspace',
      });

      if (!selected) {
        return;
      }

      if (selected.profile === null) {
        await workspaceProfileService.removeAssociation(wsRoot);
        vscode.window.showInformationMessage('Workspace profile association removed');
      } else {
        await workspaceProfileService.setAssociation(wsRoot, selected.profile.name);
        vscode.window.showInformationMessage(
          `Workspace associated with profile "${selected.profile.name}"`,
        );
      }
    },
  );

  context.subscriptions.push(createCmd, switchCmd, editCmd, deleteCmd, saveAsCmd, exportCmd, importCmd, associateCmd);
}

// ---------------------------------------------------------------------------
// Edit Tools helper
// ---------------------------------------------------------------------------

/**
 * Present a multi-select QuickPick for editing which tools are in a profile.
 *
 * Shows all non-managed tools in the current environment. Tools that are
 * in the profile with `enabled: true` are pre-selected. After selection,
 * computes the updated tool entries: selected tools become enabled, tools
 * that were in the profile but deselected become disabled, and newly
 * picked tools are added as enabled.
 */
async function editProfileTools(
  profile: Profile,
  profileService: ProfileService,
  configService: ConfigService,
): Promise<void> {
  // Read all current tools
  const allTools = [];
  for (const type of [ToolType.Skill, ToolType.McpServer, ToolType.Hook, ToolType.Command]) {
    const tools = await configService.readAllTools(type);
    allTools.push(...tools);
  }

  // Filter out managed tools
  const editableTools = allTools.filter((t) => t.scope !== ConfigScope.Managed);

  // Build a set of profile keys that are enabled for pre-selection
  const profileKeyMap = new Map(profile.tools.map((e) => [e.key, e.enabled]));

  // Build QuickPick items
  interface ToolQuickPickItem extends vscode.QuickPickItem {
    toolKey: string;
  }

  const items: ToolQuickPickItem[] = editableTools.map((tool) => {
    const key = canonicalKey(tool);
    const isInProfile = profileKeyMap.has(key);
    const isEnabled = profileKeyMap.get(key) === true;

    return {
      label: tool.name,
      description: `[${tool.type}] ${tool.scope}`,
      picked: isEnabled,
      toolKey: key,
      detail: isInProfile ? undefined : '(not in profile)',
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: `Select tools to enable in "${profile.name}"`,
  });

  if (!selected) {
    return; // Cancelled
  }

  // Compute new tool entries
  const selectedKeys = new Set(selected.map((s) => s.toolKey));
  const allItemKeys = new Set(items.map((i) => i.toolKey));
  const newEntries: ProfileToolEntry[] = [];

  // For every tool key that was either in the original profile or shown in the picker:
  for (const key of allItemKeys) {
    const wasInProfile = profileKeyMap.has(key);
    const isSelected = selectedKeys.has(key);

    if (isSelected) {
      // Tool is selected -- include as enabled
      newEntries.push({ key, enabled: true });
    } else if (wasInProfile) {
      // Tool was in profile but deselected -- include as disabled
      newEntries.push({ key, enabled: false });
    }
    // If not in profile and not selected, don't add (keep profile lean)
  }

  await profileService.updateProfile(profile.id, { tools: newEntries });
  vscode.window.showInformationMessage(
    `Profile "${profile.name}" updated: ${newEntries.filter((e) => e.enabled).length} enabled, ${newEntries.filter((e) => !e.enabled).length} disabled`,
  );
}
