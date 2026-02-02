import * as vscode from 'vscode';
import type { ProfileService } from '../../services/profile.service.js';
import type { Profile } from '../../services/profile.types.js';
import type { ConfigService } from '../../services/config.service.js';
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

      const items: ProfileQuickPickItem[] = [
        {
          label: 'Current Environment (No Profile)',
          description: !activeId ? '(active)' : undefined,
          profile: null,
        },
        ...profiles.map((p): ProfileQuickPickItem => ({
          label: p.name,
          description: p.id === activeId ? '(active)' : `${p.tools.length} tools`,
          profile: p,
        })),
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

      // Select which profile to edit
      const profileItems: ProfileQuickPickItem[] = profiles.map((p) => ({
        label: p.name,
        description: `${p.tools.length} tools`,
        profile: p,
      }));

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

          await profileService.updateProfile(profile.id, { name: trimmedName });
          // Update sidebar header if the renamed profile is the active one
          if (profileService.getActiveProfileId() === profile.id) {
            treeProvider.setActiveProfile(trimmedName);
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

      const items: ProfileQuickPickItem[] = profiles.map((p) => ({
        label: p.name,
        description: `${p.tools.length} tools`,
        profile: p,
      }));

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

  context.subscriptions.push(createCmd, switchCmd, editCmd, deleteCmd, saveAsCmd);
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
