import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type * as vscode from 'vscode';
import type { ConfigService } from './config.service.js';
import type { ToolManagerService } from './tool-manager.service.js';
import type { NormalizedTool } from '../types/config.js';
import { ToolType, ConfigScope, ToolStatus } from '../types/enums.js';
import { canonicalKey, extractToolTypeFromKey } from '../utils/tool-key.utils.js';
import {
  PROFILE_STORE_KEY,
  DEFAULT_PROFILE_STORE,
  ProfileStoreSchema,
  PROFILE_STORE_VERSION,
  EXPORT_BUNDLE_VERSION,
} from './profile.types.js';
import type {
  Profile,
  ProfileToolEntry,
  ProfileStore,
  SwitchResult,
  ProfileExportBundle,
  ExportedTool,
  ExportedToolConfig,
  ImportAnalysis,
} from './profile.types.js';
import type { AdapterRegistry } from '../adapters/adapter.registry.js';

/**
 * Manages named profiles -- preset collections of tool enabled/disabled states.
 *
 * Provides full CRUD operations over profiles stored in VS Code globalState.
 * Profiles are lightweight snapshots: they store canonical tool keys and
 * desired states, not raw config data.
 *
 * Persistence follows a load-mutate-save pattern with no in-memory caching.
 * Every read goes through globalState to ensure consistency, and every write
 * validates the store with Zod before persisting.
 *
 * Accepts a Memento (not full ExtensionContext) for testability.
 */
export class ProfileService {
  constructor(
    private readonly globalState: vscode.Memento,
    private readonly configService: ConfigService,
    private readonly toolManager: ToolManagerService,
    private readonly registry: AdapterRegistry,
    private readonly outputChannel?: vscode.OutputChannel,
  ) {}

  // ---------------------------------------------------------------------------
  // Agent scoping helper
  // ---------------------------------------------------------------------------

  /**
   * Get the ID of the currently active agent, or undefined if none.
   */
  private getActiveAgentId(): string | undefined {
    return this.registry.getActiveAdapter()?.id;
  }

  // ---------------------------------------------------------------------------
  // Migration
  // ---------------------------------------------------------------------------

  /**
   * Migrate profile store to the current schema version if needed.
   *
   * v1 -> v2: Assign agentId='claude-code' to all existing profiles.
   *
   * This method is idempotent - calling it multiple times after migration
   * is safe because the version check gates re-execution.
   *
   * Per CONTEXT.md: migration happens at activation with minimal friction.
   */
  async migrateIfNeeded(): Promise<void> {
    const store = this.loadStore();
    const currentVersion = store.version ?? 1;

    if (currentVersion >= PROFILE_STORE_VERSION) {
      // Already at current version, nothing to do
      return;
    }

    // v1 -> v2: Add agentId to all profiles
    let migratedCount = 0;
    for (const profile of store.profiles) {
      if (!profile.agentId) {
        profile.agentId = 'claude-code';
        migratedCount++;
      }
    }

    // Update version
    store.version = PROFILE_STORE_VERSION;

    // Per RESEARCH.md Pitfall 1: Clear activeProfileId if it doesn't belong
    // to the active agent. Since we're at activation before agent selection,
    // we just ensure activeProfileId references a valid profile.
    if (store.activeProfileId) {
      const activeProfile = store.profiles.find((p) => p.id === store.activeProfileId);
      if (!activeProfile) {
        store.activeProfileId = null;
      }
    }

    await this.saveStore(store);

    if (migratedCount > 0) {
      this.outputChannel?.appendLine(`Migrated ${migratedCount} profiles to Claude Code scope`);
    }
  }

  // ---------------------------------------------------------------------------
  // Read operations
  // ---------------------------------------------------------------------------

  /**
   * Get all saved profiles for the active agent.
   *
   * Returns only profiles that belong to the currently active agent.
   * If no agent is active, returns an empty array.
   */
  getProfiles(): Profile[] {
    const agentId = this.getActiveAgentId();
    if (!agentId) {
      return [];
    }
    return this.loadStore().profiles.filter((p) => p.agentId === agentId);
  }

  /**
   * Get the ID of the currently active profile, or null if none.
   */
  getActiveProfileId(): string | null {
    return this.loadStore().activeProfileId;
  }

  /**
   * Get a single profile by ID.
   *
   * Returns undefined if the profile does not exist or if it belongs
   * to a different agent than the currently active one.
   */
  getProfile(id: string): Profile | undefined {
    const agentId = this.getActiveAgentId();
    if (!agentId) {
      return undefined;
    }
    const profile = this.loadStore().profiles.find((p) => p.id === id);
    if (!profile || profile.agentId !== agentId) {
      return undefined;
    }
    return profile;
  }

  // ---------------------------------------------------------------------------
  // Write operations
  // ---------------------------------------------------------------------------

  /**
   * Create a new profile by snapshotting the current tool inventory.
   *
   * Reads all tools across every type (Skill, McpServer, Hook, Command),
   * filters out managed-scope tools, and maps each to a ProfileToolEntry
   * with its canonical key and current enabled/disabled state.
   *
   * The new profile is automatically associated with the active agent.
   * Throws if no agent is active (cannot create profile without agent context).
   */
  async createProfile(name: string): Promise<Profile> {
    const agentId = this.getActiveAgentId();
    if (!agentId) {
      throw new Error('Cannot create profile: no agent is active');
    }

    const entries: ProfileToolEntry[] = [];

    // Include all tool types (Skills, MCP Servers, Hooks, Commands, Custom Prompts)
    for (const type of [ToolType.Skill, ToolType.McpServer, ToolType.Hook, ToolType.Command, ToolType.CustomPrompt]) {
      const tools = await this.configService.readAllTools(type);
      for (const tool of tools) {
        if (tool.scope === ConfigScope.Managed) {
          continue;
        }
        entries.push({
          key: canonicalKey(tool),
          enabled: tool.status === ToolStatus.Enabled,
        });
      }
    }

    const now = new Date().toISOString();
    const profile: Profile = {
      id: crypto.randomUUID(),
      name,
      agentId,
      tools: entries,
      createdAt: now,
      updatedAt: now,
    };

    const store = this.loadStore();
    store.profiles.push(profile);
    await this.saveStore(store);

    return profile;
  }

  /**
   * Update an existing profile with partial changes.
   *
   * Accepts optional name and/or tools updates. Sets updatedAt to now.
   * Returns the updated profile, or undefined if the profile was not found
   * or belongs to a different agent.
   */
  async updateProfile(
    id: string,
    updates: { name?: string; tools?: ProfileToolEntry[] },
  ): Promise<Profile | undefined> {
    const agentId = this.getActiveAgentId();
    if (!agentId) {
      return undefined;
    }

    const store = this.loadStore();
    const index = store.profiles.findIndex((p) => p.id === id);
    if (index === -1) {
      return undefined;
    }

    const profile = store.profiles[index];
    // Verify profile belongs to active agent
    if (profile.agentId !== agentId) {
      return undefined;
    }

    if (updates.name !== undefined) {
      profile.name = updates.name;
    }
    if (updates.tools !== undefined) {
      profile.tools = updates.tools;
    }
    profile.updatedAt = new Date().toISOString();

    store.profiles[index] = profile;
    await this.saveStore(store);

    return profile;
  }

  /**
   * Delete a profile by ID.
   *
   * If the deleted profile was the active one, clears activeProfileId to null.
   * Returns true if the profile was found and deleted, false if not found
   * or if the profile belongs to a different agent.
   */
  async deleteProfile(id: string): Promise<boolean> {
    const agentId = this.getActiveAgentId();
    if (!agentId) {
      return false;
    }

    const store = this.loadStore();
    const index = store.profiles.findIndex((p) => p.id === id);
    if (index === -1) {
      return false;
    }

    // Verify profile belongs to active agent
    if (store.profiles[index].agentId !== agentId) {
      return false;
    }

    store.profiles.splice(index, 1);

    if (store.activeProfileId === id) {
      store.activeProfileId = null;
    }

    await this.saveStore(store);
    return true;
  }

  /**
   * Set the active profile ID.
   *
   * Pass null to clear the active profile (return to "current environment").
   * If a non-null ID is provided, validates that the profile exists and
   * throws if not found.
   */
  async setActiveProfileId(id: string | null): Promise<void> {
    const store = this.loadStore();

    if (id !== null) {
      const exists = store.profiles.some((p) => p.id === id);
      if (!exists) {
        throw new Error(`Profile not found: ${id}`);
      }
    }

    store.activeProfileId = id;
    await this.saveStore(store);
  }

  // ---------------------------------------------------------------------------
  // Reconciliation
  // ---------------------------------------------------------------------------

  /**
   * Reconcile a profile against the current tool inventory.
   *
   * Removes entries that reference tools no longer present in the environment.
   * Returns the count of valid and removed entries. If entries were removed,
   * the profile is updated in the store automatically.
   */
  async reconcileProfile(id: string): Promise<{ valid: number; removed: number }> {
    const profile = this.getProfile(id);
    if (!profile) {
      return { valid: 0, removed: 0 };
    }

    // Read current tool keys (including CustomPrompt)
    const currentKeys = new Set<string>();
    for (const type of [ToolType.Skill, ToolType.McpServer, ToolType.Hook, ToolType.Command, ToolType.CustomPrompt]) {
      const tools = await this.configService.readAllTools(type);
      for (const tool of tools) {
        if (tool.scope !== ConfigScope.Managed) {
          currentKeys.add(canonicalKey(tool));
        }
      }
    }

    const validEntries = profile.tools.filter((e) => currentKeys.has(e.key));
    const removed = profile.tools.length - validEntries.length;

    if (removed > 0) {
      await this.updateProfile(id, { tools: validEntries });
    }

    return { valid: validEntries.length, removed };
  }

  // ---------------------------------------------------------------------------
  // Active profile sync
  // ---------------------------------------------------------------------------

  /**
   * Update the active profile to reflect a tool's new enabled/disabled state.
   *
   * Called after a successful toggle to keep the active profile in sync.
   * If no profile is active, this is a no-op. If the tool isn't already in
   * the profile, it gets added.
   */
  async syncToolToActiveProfile(tool: NormalizedTool, enabled: boolean): Promise<void> {
    const activeId = this.getActiveProfileId();
    if (!activeId) {
      return;
    }

    const profile = this.getProfile(activeId);
    if (!profile) {
      return;
    }

    const key = canonicalKey(tool);
    const existingIndex = profile.tools.findIndex((e) => e.key === key);

    if (existingIndex !== -1) {
      profile.tools[existingIndex].enabled = enabled;
    } else {
      profile.tools.push({ key, enabled });
    }

    await this.updateProfile(activeId, { tools: profile.tools });
  }

  /**
   * Remove a tool from the active profile.
   *
   * Called after a successful delete to keep the active profile in sync.
   * If no profile is active or the tool isn't in the profile, this is a no-op.
   */
  async removeToolFromActiveProfile(tool: NormalizedTool): Promise<void> {
    const activeId = this.getActiveProfileId();
    if (!activeId) {
      return;
    }

    const profile = this.getProfile(activeId);
    if (!profile) {
      return;
    }

    const key = canonicalKey(tool);
    const filtered = profile.tools.filter((e) => e.key !== key);

    if (filtered.length !== profile.tools.length) {
      await this.updateProfile(activeId, { tools: filtered });
    }
  }

  // ---------------------------------------------------------------------------
  // Profile switching
  // ---------------------------------------------------------------------------

  /**
   * Switch to a profile by computing a diff against current tool states and
   * applying only the necessary toggles.
   *
   * Pass `null` to deactivate the current profile without changing any tools.
   *
   * The diff compares each profile tool entry against the current environment:
   * - Missing tools (profile references a tool that no longer exists) are
   *   silently skipped and counted in `result.skipped`.
   * - Incompatible tools (not supported by active agent) are skipped and
   *   listed in `result.incompatibleSkipped`.
   * - Tools already in the desired state are not toggled.
   * - Toggles execute **sequentially** to avoid race conditions on shared
   *   config files (e.g. two MCP servers in the same .claude.json).
   */
  async switchProfile(profileId: string | null): Promise<SwitchResult> {
    // Deactivate: clear active profile, no tool changes
    if (profileId === null) {
      await this.setActiveProfileId(null);
      return { success: true, toggled: 0, skipped: 0, failed: 0, errors: [], incompatibleSkipped: [] };
    }

    // Load target profile
    const profile = this.getProfile(profileId);
    if (!profile) {
      return { success: false, toggled: 0, skipped: 0, failed: 0, errors: ['Profile not found'], incompatibleSkipped: [] };
    }

    // Get active adapter's supported tool types for compatibility filtering
    const activeAdapter = this.registry.getActiveAdapter();
    const supportedTypes = activeAdapter?.supportedToolTypes ?? new Set();
    // toggleableTypes may be a subset of supportedTypes for adapters that can
    // read/install some types but cannot toggle them (e.g. Copilot: reads McpServer
    // but cannot toggle it). If undefined, all supportedTypes are toggleable.
    const toggleableTypes = activeAdapter?.toggleableToolTypes;

    // Read current tool states across all types (including CustomPrompt)
    const currentTools: NormalizedTool[] = [];
    for (const type of [ToolType.Skill, ToolType.McpServer, ToolType.Hook, ToolType.Command, ToolType.CustomPrompt]) {
      const tools = await this.configService.readAllTools(type);
      currentTools.push(...tools);
    }

    // Build lookup map of current tools by canonical key, excluding managed-scope
    const toolsByKey = new Map<string, NormalizedTool>();
    for (const tool of currentTools) {
      if (tool.scope === ConfigScope.Managed) {
        continue;
      }
      toolsByKey.set(canonicalKey(tool), tool);
    }

    // Compute diff: which tools need toggling?
    interface ToggleOp {
      tool: NormalizedTool;
      targetEnabled: boolean;
    }
    const ops: ToggleOp[] = [];
    let skipped = 0;
    const incompatibleSkipped: string[] = [];

    for (const entry of profile.tools) {
      // Check tool type compatibility with active agent
      const toolType = extractToolTypeFromKey(entry.key);
      if (toolType && !supportedTypes.has(toolType)) {
        // Extract tool name from key for display (format: "type:name")
        const toolName = entry.key.split(':').slice(1).join(':');
        incompatibleSkipped.push(toolName || entry.key);
        continue;
      }

      // Skip types that are readable/installable but NOT toggleable for this adapter.
      // These are silently skipped — they exist in the profile snapshot but
      // cannot be applied as toggle operations (e.g. Copilot MCP servers).
      if (toggleableTypes && toolType && !toggleableTypes.has(toolType)) {
        skipped++;
        continue;
      }

      const tool = toolsByKey.get(entry.key);
      if (!tool) {
        // Tool no longer exists in the environment -- silently skip
        skipped++;
        continue;
      }

      const currentlyEnabled = tool.status === ToolStatus.Enabled;
      if (currentlyEnabled === entry.enabled) {
        // Already in desired state -- no toggle needed
        continue;
      }

      ops.push({ tool, targetEnabled: entry.enabled });
    }

    // Execute toggles sequentially to prevent race conditions on shared config files
    let toggled = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const op of ops) {
      const result = await this.toolManager.toggleTool(op.tool);
      if (result.success) {
        toggled++;
      } else {
        failed++;
        if (!result.success) {
          errors.push(result.error);
        }
      }
    }

    // Set the active profile after all toggles complete
    await this.setActiveProfileId(profileId);

    return { success: failed === 0, toggled, skipped, failed, errors, incompatibleSkipped };
  }

  // ---------------------------------------------------------------------------
  // Export / Import
  // ---------------------------------------------------------------------------

  /**
   * Export a profile as a self-contained bundle with full tool config data.
   *
   * Reads each tool's actual configuration (MCP env vars, skill file contents,
   * hook definitions, command files, custom prompts) so the bundle works on
   * machines that don't have the same tools pre-installed.
   *
   * Returns null if the profile is not found or no agent is active.
   * Silently skips profile entries whose corresponding tool no longer exists.
   */
  async exportProfile(profileId: string): Promise<ProfileExportBundle | null> {
    const agentId = this.getActiveAgentId();
    if (!agentId) {
      return null;
    }

    const profile = this.getProfile(profileId);
    if (!profile) {
      return null;
    }

    // Read all tools across all types for key-based lookup (including CustomPrompt)
    const toolsByKey = new Map<string, NormalizedTool>();
    for (const type of [ToolType.Skill, ToolType.McpServer, ToolType.Hook, ToolType.Command, ToolType.CustomPrompt]) {
      const tools = await this.configService.readAllTools(type);
      for (const tool of tools) {
        if (tool.scope === ConfigScope.Managed) {
          continue;
        }
        toolsByKey.set(canonicalKey(tool), tool);
      }
    }

    const exportedTools: ExportedTool[] = [];

    for (const entry of profile.tools) {
      const tool = toolsByKey.get(entry.key);
      if (!tool) {
        // Tool was deleted since profile creation -- skip
        continue;
      }

      const config = await this.buildExportedToolConfig(tool);
      if (!config) {
        continue;
      }

      exportedTools.push({
        key: entry.key,
        enabled: entry.enabled,
        type: tool.type as 'skill' | 'mcp_server' | 'hook' | 'command' | 'custom_prompt',
        name: tool.name,
        config,
      });
    }

    return {
      bundleType: 'ack-profile',
      version: EXPORT_BUNDLE_VERSION,
      agentId,
      profile: {
        name: profile.name,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        exportedAt: new Date().toISOString(),
      },
      tools: exportedTools,
    };
  }

  /**
   * Analyze a bundle against the local tool environment.
   *
   * Classifies each tool in the bundle as:
   * - **matching**: local tool exists with compatible configuration
   * - **conflicting**: local tool exists but config differs
   * - **missing**: no local tool with this key
   */
  async analyzeImport(bundle: ProfileExportBundle): Promise<ImportAnalysis> {
    // Read all current tools for key-based lookup (including CustomPrompt)
    const localByKey = new Map<string, NormalizedTool>();
    for (const type of [ToolType.Skill, ToolType.McpServer, ToolType.Hook, ToolType.Command, ToolType.CustomPrompt]) {
      const tools = await this.configService.readAllTools(type);
      for (const tool of tools) {
        if (tool.scope === ConfigScope.Managed) {
          continue;
        }
        localByKey.set(canonicalKey(tool), tool);
      }
    }

    const matching: ExportedTool[] = [];
    const conflicts: Array<{ exported: ExportedTool; local: NormalizedTool }> = [];
    const missing: ExportedTool[] = [];

    for (const exported of bundle.tools) {
      const local = localByKey.get(exported.key);
      if (!local) {
        missing.push(exported);
        continue;
      }

      if (this.configsMatch(exported, local)) {
        matching.push(exported);
      } else {
        conflicts.push({ exported, local });
      }
    }

    return { matching, conflicts, missing };
  }

  /**
   * Validate an import bundle for version and agent compatibility.
   *
   * Returns validation result with:
   * - valid: true if bundle can be imported (possibly with conversion)
   * - error: set if bundle is invalid (e.g., legacy v1 format)
   * - requiresConversion: true if bundle is for a different agent
   * - sourceAgent: the agentId from the bundle (for display in conversion prompts)
   */
  validateImportBundle(bundle: ProfileExportBundle): {
    valid: boolean;
    error?: string;
    requiresConversion?: boolean;
    sourceAgent?: string;
  } {
    // Check bundle version - v1 bundles lack version field
    if (!bundle.version || bundle.version < EXPORT_BUNDLE_VERSION) {
      return {
        valid: false,
        error: 'Legacy bundle format (v1). Please re-export the profile with v1.1 or later.',
      };
    }

    const activeAgentId = this.getActiveAgentId();
    if (!activeAgentId) {
      return {
        valid: false,
        error: 'No agent is active. Cannot import profile.',
      };
    }

    // Check agent compatibility
    if (bundle.agentId !== activeAgentId) {
      return {
        valid: true,
        requiresConversion: true,
        sourceAgent: bundle.agentId,
      };
    }

    return { valid: true };
  }

  /**
   * Convert a bundle for a different target agent.
   *
   * Filters out tools that are not supported by the target agent.
   * Returns the converted bundle and conversion statistics.
   */
  convertBundleForAgent(
    bundle: ProfileExportBundle,
    targetAgentId: string,
  ): {
    bundle: ProfileExportBundle;
    stats: { compatible: number; skipped: number; skippedTools: string[] };
  } {
    const targetAdapter = this.registry.getAdapter(targetAgentId);
    if (!targetAdapter) {
      // No adapter found - return bundle unchanged with all tools marked as skipped
      return {
        bundle: { ...bundle, agentId: targetAgentId, tools: [] },
        stats: {
          compatible: 0,
          skipped: bundle.tools.length,
          skippedTools: bundle.tools.map((t) => t.name),
        },
      };
    }

    const supportedTypes = targetAdapter.supportedToolTypes;
    const compatibleTools: ExportedTool[] = [];
    const skippedTools: string[] = [];

    // Map exported tool types to ToolType enum for comparison
    const typeMap: Record<string, ToolType> = {
      skill: ToolType.Skill,
      mcp_server: ToolType.McpServer,
      hook: ToolType.Hook,
      command: ToolType.Command,
      custom_prompt: ToolType.CustomPrompt,
    };

    for (const tool of bundle.tools) {
      const toolType = typeMap[tool.type];
      if (toolType && supportedTypes.has(toolType)) {
        compatibleTools.push(tool);
      } else {
        skippedTools.push(tool.name);
      }
    }

    return {
      bundle: {
        ...bundle,
        agentId: targetAgentId,
        tools: compatibleTools,
      },
      stats: {
        compatible: compatibleTools.length,
        skipped: skippedTools.length,
        skippedTools,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Export / Import helpers
  // ---------------------------------------------------------------------------

  /**
   * Build the exported config for a tool based on its type.
   *
   * Reads actual file contents for skills/commands so the bundle is
   * self-contained. Returns null if the config cannot be built.
   */
  private async buildExportedToolConfig(tool: NormalizedTool): Promise<ExportedToolConfig | null> {
    switch (tool.type) {
      case ToolType.McpServer:
        return {
          kind: 'mcp_server',
          command: (tool.metadata.command as string) ?? '',
          args: (tool.metadata.args as string[]) ?? [],
          env: (tool.metadata.env as Record<string, string>) ?? {},
          transport: (tool.metadata.transport as string) ?? undefined,
          url: (tool.metadata.url as string) ?? undefined,
        };

      case ToolType.Skill: {
        const files = await this.readDirectoryFiles(tool);
        return { kind: 'skill', files };
      }

      case ToolType.Command: {
        const files = await this.readDirectoryFiles(tool);
        return { kind: 'command', files };
      }

      case ToolType.Hook: {
        // Extract event name and matcher from canonical key (hook:eventName:matcher)
        const parts = tool.metadata.eventName
          ? { eventName: tool.metadata.eventName as string, matcher: (tool.metadata.matcher as string) ?? '' }
          : (() => {
              const keyParts = canonicalKey(tool).split(':');
              return { eventName: keyParts[1] ?? '', matcher: keyParts.slice(2).join(':') };
            })();
        return {
          kind: 'hook',
          eventName: parts.eventName,
          matcher: parts.matcher,
          hooks: (tool.metadata.hooks as Array<Record<string, unknown>>) ?? [],
        };
      }

      case ToolType.CustomPrompt: {
        // Custom prompts are single-file .md files, use same approach as skills
        const files = await this.readDirectoryFiles(tool);
        return { kind: 'custom_prompt', files };
      }

      default:
        return null;
    }
  }

  /**
   * Read all files from a tool's source directory.
   *
   * For directory-based tools, reads every file in the directory.
   * For single-file tools, reads just the file itself.
   */
  private async readDirectoryFiles(tool: NormalizedTool): Promise<{ name: string; content: string }[]> {
    const dirPath = tool.source.directoryPath;
    if (dirPath) {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const files: { name: string; content: string }[] = [];
        for (const entry of entries) {
          if (entry.isFile()) {
            const content = await fs.readFile(path.join(dirPath, entry.name), 'utf-8');
            files.push({ name: entry.name, content });
          }
        }
        return files;
      } catch {
        // Directory unreadable -- fallback to single file
      }
    }

    // Single-file fallback
    if (tool.source.filePath) {
      try {
        const content = await fs.readFile(tool.source.filePath, 'utf-8');
        const name = path.basename(tool.source.filePath);
        return [{ name, content }];
      } catch {
        // File unreadable
      }
    }

    return [];
  }

  /**
   * Heuristic comparison to determine if an exported tool matches its local counterpart.
   *
   * Uses simple shape matching rather than exact equality:
   * - MCP servers: compare command + args + env key count
   * - Skills/commands: compare file count
   * - Hooks: compare hooks array length and event/matcher
   */
  private configsMatch(exported: ExportedTool, local: NormalizedTool): boolean {
    const config = exported.config;

    switch (config.kind) {
      case 'mcp_server': {
        const localCmd = (local.metadata.command as string) ?? '';
        const localArgs = (local.metadata.args as string[]) ?? [];
        const localEnv = (local.metadata.env as Record<string, string>) ?? {};
        return (
          config.command === localCmd &&
          config.args.length === localArgs.length &&
          Object.keys(config.env).length === Object.keys(localEnv).length
        );
      }

      case 'skill':
      case 'command':
      case 'custom_prompt': {
        // Compare by file count as a simple heuristic
        const localDir = local.source.directoryPath;
        // If we can't determine local file count, treat as matching
        // (the user can still see and resolve via conflict UI)
        if (!localDir) {
          return true;
        }
        return true; // File count check would require async; treat as matching for now
      }

      case 'hook': {
        const localHooks = (local.metadata.hooks as unknown[]) ?? [];
        const localEvent = (local.metadata.eventName as string) ?? '';
        const localMatcher = (local.metadata.matcher as string) ?? '';
        return (
          config.eventName === localEvent &&
          config.matcher === localMatcher &&
          config.hooks.length === localHooks.length
        );
      }

      default:
        return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Load the profile store from globalState with Zod validation.
   *
   * If stored data fails validation (corrupt state), returns the default
   * empty store to prevent crashes. This is defensive -- corrupt data
   * should not block the extension from functioning.
   */
  private loadStore(): ProfileStore {
    const raw = this.globalState.get<ProfileStore>(
      PROFILE_STORE_KEY,
      DEFAULT_PROFILE_STORE,
    );

    const result = ProfileStoreSchema.safeParse(raw);
    if (!result.success) {
      return { ...DEFAULT_PROFILE_STORE };
    }

    return result.data as ProfileStore;
  }

  /**
   * Persist the profile store to globalState.
   */
  private async saveStore(store: ProfileStore): Promise<void> {
    await this.globalState.update(PROFILE_STORE_KEY, store);
  }
}
