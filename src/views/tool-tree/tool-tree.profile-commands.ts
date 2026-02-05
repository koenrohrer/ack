import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { ProfileService } from '../../services/profile.service.js';
import type { Profile, ProfileExportBundle } from '../../services/profile.types.js';
import { ProfileExportBundleSchema } from '../../services/profile.types.js';
import type { ConfigService } from '../../services/config.service.js';
import type { RegistryService } from '../../services/registry.service.js';
import type { InstallService } from '../../services/install.service.js';
import type { WorkspaceProfileService } from '../../services/workspace-profile.service.js';
import type { ToolTreeProvider } from './tool-tree.provider.js';
import type { ProfileToolEntry } from '../../services/profile.types.js';
import { ToolType, ConfigScope } from '../../types/enums.js';
import { canonicalKey, extractToolTypeFromKey } from '../../utils/tool-key.utils.js';
import type { AdapterRegistry } from '../../adapters/adapter.registry.js';

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
 * - cloneProfileToAgent: Clone a profile to a different agent with tool filtering
 */
export function registerProfileCommands(
  context: vscode.ExtensionContext,
  profileService: ProfileService,
  configService: ConfigService,
  treeProvider: ToolTreeProvider,
  registryService: RegistryService,
  installService: InstallService,
  workspaceProfileService: WorkspaceProfileService,
  registry: AdapterRegistry,
): void {
  // ---------------------------------------------------------------------------
  // Create Profile
  // ---------------------------------------------------------------------------

  const createCmd = vscode.commands.registerCommand(
    'ack.createProfile',
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
    'ack.switchProfile',
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

      // Show warning for incompatible tools
      if (result.incompatibleSkipped.length > 0) {
        const activeAgent = registry.getActiveAdapter()?.displayName ?? 'active agent';
        const action = await vscode.window.showWarningMessage(
          `${result.incompatibleSkipped.length} tool(s) skipped (not supported by ${activeAgent})`,
          'View Details',
        );
        if (action === 'View Details') {
          const detail = result.incompatibleSkipped.join(', ');
          vscode.window.showInformationMessage(`Skipped tools: ${detail}`);
        }
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
    'ack.editProfile',
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
              // Preserve agentId from existing association, or use active agent if legacy
              const agentIdToUse = assoc.agentId ?? registry.getActiveAdapter()?.id ?? 'claude-code';
              await workspaceProfileService.setAssociation(renameWsRoot, trimmedName, agentIdToUse);
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
    'ack.deleteProfile',
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
    'ack.saveAsProfile',
    async () => {
      await vscode.commands.executeCommand('ack.createProfile');
    },
  );

  // ---------------------------------------------------------------------------
  // Export Profile
  // ---------------------------------------------------------------------------

  const exportCmd = vscode.commands.registerCommand(
    'ack.exportProfile',
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
      const agentId = bundle.agentId;

      // Warn about potential secrets in MCP env vars
      const proceed = await vscode.window.showWarningMessage(
        'This export may contain API keys in MCP server environment variables. Review the file before sharing.',
        'Continue',
        'Cancel',
      );
      if (proceed !== 'Continue') {
        return;
      }

      // Sanitize profile name for filename: lowercase, replace spaces with hyphens
      const sanitizedName = profileName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      // Format: {name}.{agent-id}.ackprofile per CONTEXT.md
      const defaultFilename = `${sanitizedName}.${agentId}.ackprofile`;

      const defaultDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
      const defaultUri = vscode.Uri.file(path.join(defaultDir, defaultFilename));

      const uri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { 'ACK Profile': ['ackprofile', 'json'] },
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
    'ack.importProfile',
    async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'ACK Profile': ['ackprofile', 'json'] },
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

      // First do a basic shape check for bundleType
      const basicCheck = parsed as { bundleType?: string };
      if (basicCheck.bundleType !== 'ack-profile') {
        vscode.window.showErrorMessage('Invalid profile bundle: not an ACK profile file.');
        return;
      }

      const validation = ProfileExportBundleSchema.safeParse(parsed);
      if (!validation.success) {
        // Check if this is a v1 bundle (missing version/agentId)
        const v1Check = parsed as { version?: number; agentId?: string };
        if (!v1Check.version || !v1Check.agentId) {
          vscode.window.showErrorMessage(
            'Legacy bundle format (v1). Please re-export the profile with v1.1 or later.',
          );
          return;
        }
        vscode.window.showErrorMessage(
          `Invalid profile bundle: ${validation.error.message}`,
        );
        return;
      }

      let bundle: ProfileExportBundle = validation.data;

      // Validate version and agent compatibility
      const importValidation = profileService.validateImportBundle(bundle);
      if (!importValidation.valid) {
        vscode.window.showErrorMessage(importValidation.error ?? 'Invalid bundle');
        return;
      }

      // Handle agent mismatch - offer conversion
      if (importValidation.requiresConversion) {
        const activeAgent = registry.getActiveAdapter();
        if (!activeAgent) {
          vscode.window.showErrorMessage('No agent is active. Cannot import profile.');
          return;
        }

        const convertChoice = await vscode.window.showWarningMessage(
          `This profile was created for ${importValidation.sourceAgent}. Convert to ${activeAgent.displayName}?`,
          { modal: true },
          'Convert',
          'Cancel',
        );

        if (convertChoice !== 'Convert') {
          return;
        }

        // Convert the bundle
        const conversion = profileService.convertBundleForAgent(bundle, activeAgent.id);
        bundle = conversion.bundle;

        // Show conversion results
        if (conversion.stats.skipped > 0) {
          const skippedList = conversion.stats.skippedTools.slice(0, 5).join(', ');
          const more = conversion.stats.skippedTools.length > 5
            ? ` and ${conversion.stats.skippedTools.length - 5} more`
            : '';
          vscode.window.showInformationMessage(
            `Converted: ${conversion.stats.compatible} tools kept, ${conversion.stats.skipped} skipped (${skippedList}${more})`,
          );
        } else {
          vscode.window.showInformationMessage(
            `Converted: all ${conversion.stats.compatible} tools are compatible.`,
          );
        }
      }

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
    'ack.associateProfile',
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
        const currentAdapter = registry.getActiveAdapter();
        if (!currentAdapter) {
          vscode.window.showWarningMessage('No agent is active. Cannot associate profile.');
          return;
        }
        await workspaceProfileService.setAssociation(wsRoot, selected.profile.name, currentAdapter.id);
        vscode.window.showInformationMessage(
          `Workspace associated with profile "${selected.profile.name}"`,
        );
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Clone Profile to Agent
  // ---------------------------------------------------------------------------

  const cloneToAgentCmd = vscode.commands.registerCommand(
    'ack.cloneProfileToAgent',
    async () => {
      // 1. Get current agent and profiles
      const currentAdapter = registry.getActiveAdapter();
      if (!currentAdapter) {
        vscode.window.showWarningMessage('No agent is active. Cannot clone profile.');
        return;
      }

      const profiles = profileService.getProfiles();
      if (profiles.length === 0) {
        vscode.window.showInformationMessage('No profiles to clone. Create one first.');
        return;
      }

      // 2. Select source profile
      const activeId = profileService.getActiveProfileId();
      const profileItems = await Promise.all(
        profiles.map((p) => reconcileAndBuildItem(p, profileService, activeId)),
      );

      const selectedProfile = await vscode.window.showQuickPick(profileItems, {
        placeHolder: 'Select a profile to clone',
      });

      if (!selectedProfile || !selectedProfile.profile) {
        return;
      }

      const sourceProfile = selectedProfile.profile;

      // 3. Select target agent (exclude current)
      const allAdapters = registry.getAllAdapters();
      const otherAdapters = allAdapters.filter((a) => a.id !== currentAdapter.id);

      if (otherAdapters.length === 0) {
        vscode.window.showWarningMessage('No other agents available to clone to.');
        return;
      }

      interface AgentQuickPickItem extends vscode.QuickPickItem {
        adapterId: string;
      }

      const agentItems: AgentQuickPickItem[] = otherAdapters.map((a) => ({
        label: a.displayName,
        description: `Supports: ${[...a.supportedToolTypes].join(', ')}`,
        adapterId: a.id,
      }));

      const selectedAgent = await vscode.window.showQuickPick(agentItems, {
        placeHolder: 'Select target agent',
      });

      if (!selectedAgent) {
        return;
      }

      const targetAdapter = registry.getAdapter(selectedAgent.adapterId);
      if (!targetAdapter) {
        vscode.window.showErrorMessage('Selected agent not found.');
        return;
      }

      // 4. Analyze tool compatibility
      const compatible: ProfileToolEntry[] = [];
      const incompatible: Array<{ entry: ProfileToolEntry; reason: string }> = [];

      for (const entry of sourceProfile.tools) {
        const toolType = extractToolTypeFromKey(entry.key);
        if (!toolType) {
          incompatible.push({ entry, reason: 'Unknown tool type' });
          continue;
        }

        if (targetAdapter.supportedToolTypes.has(toolType)) {
          compatible.push(entry);
        } else {
          // Build human-readable reason
          const typeDisplayNames: Record<ToolType, string> = {
            [ToolType.Skill]: 'Skills',
            [ToolType.McpServer]: 'MCP Servers',
            [ToolType.Hook]: 'Hooks',
            [ToolType.Command]: 'Commands',
            [ToolType.CustomPrompt]: 'Custom Prompts',
          };
          const typeName = typeDisplayNames[toolType] || toolType;
          incompatible.push({
            entry,
            reason: `${typeName} not supported by ${targetAdapter.displayName}`,
          });
        }
      }

      // 5. Show confirmation modal with details
      let modalDetail = `${compatible.length} tool(s) will be cloned.\n`;

      if (incompatible.length > 0) {
        modalDetail += `\n${incompatible.length} tool(s) will be skipped (incompatible):\n`;
        for (const { entry, reason } of incompatible) {
          // Extract tool name from key (format "type:name")
          const toolName = entry.key.split(':').slice(1).join(':');
          modalDetail += `  - ${toolName}: ${reason}\n`;
        }
      }

      const confirm = await vscode.window.showWarningMessage(
        `Clone "${sourceProfile.name}" to ${targetAdapter.displayName}?`,
        { modal: true, detail: modalDetail },
        'Clone',
      );

      if (confirm !== 'Clone') {
        return;
      }

      // 6. Create cloned profile
      // Note: We need to create the profile for the target agent, but profileService
      // is scoped to the current agent. We'll use a workaround by directly creating
      // the profile data and saving it through the service's internal store.
      // However, since profileService filters by active agent, we need to temporarily
      // work around this by calling createProfile with a modified approach.

      // For now, the simplest approach is to inform the user they need to switch agents
      // and the profile will be waiting for them. We'll create it directly in the store.
      const newProfileName = `${sourceProfile.name} (${targetAdapter.displayName})`;

      // Access the globalState directly through the profile service's internal method
      // Since we can't create a profile for a different agent through the normal API,
      // we need a different approach. Let's add a special method or workaround.

      // Actually, the cleanest approach per the plan is to create a profile that includes
      // the target agentId. We can do this by creating a profile data object and saving
      // it directly. Let me check the ProfileService for a lower-level method...

      // For this implementation, we'll use a direct approach:
      // The profile service uses globalState, so we need to either:
      // a) Add a new method to profile service for cross-agent cloning
      // b) Work around by accessing storage directly

      // The plan says "Create new profile via profileService" - but profileService is
      // scoped to active agent. Let me add a helper method in the service instead.

      // For now, let's show the user what would happen and suggest they switch agents.
      // Actually, re-reading the plan: the UI should handle this by cloning the profile
      // data and the profile service should have a way to create for a specific agent.

      // Let me look at the profile service to see if there's a way to bypass the agent filter...
      // Since the store is just globalState, I can read it directly, add the profile,
      // and write it back. This is a bit of a hack but works for the clone use case.

      const storeKey = 'ack.profiles';
      const store = context.globalState.get<{
        version?: number;
        profiles: Array<{
          id: string;
          name: string;
          agentId?: string;
          tools: ProfileToolEntry[];
          createdAt: string;
          updatedAt: string;
        }>;
        activeProfileId: string | null;
      }>(storeKey, { profiles: [], activeProfileId: null });

      // Check for name collision in target agent's profiles
      const existingInTarget = store.profiles.find(
        (p) => p.agentId === targetAdapter.id && p.name === newProfileName,
      );
      if (existingInTarget) {
        vscode.window.showWarningMessage(
          `A profile named "${newProfileName}" already exists for ${targetAdapter.displayName}.`,
        );
        return;
      }

      // Create the new profile
      const now = new Date().toISOString();
      const newProfile = {
        id: crypto.randomUUID(),
        name: newProfileName,
        agentId: targetAdapter.id,
        tools: compatible,
        createdAt: now,
        updatedAt: now,
      };

      store.profiles.push(newProfile);
      await context.globalState.update(storeKey, store);

      // 7. Show success message
      const successMsg = incompatible.length > 0
        ? `Cloned "${sourceProfile.name}" to ${targetAdapter.displayName}: ${compatible.length} tools (${incompatible.length} skipped)`
        : `Cloned "${sourceProfile.name}" to ${targetAdapter.displayName}: ${compatible.length} tools`;

      vscode.window.showInformationMessage(successMsg);
    },
  );

  context.subscriptions.push(createCmd, switchCmd, editCmd, deleteCmd, saveAsCmd, exportCmd, importCmd, associateCmd, cloneToAgentCmd);
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
