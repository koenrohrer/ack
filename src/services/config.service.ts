import type { FileIOService } from './fileio.service.js';
import type { BackupService } from './backup.service.js';
import type { SchemaService } from './schema.service.js';
import type { AdapterRegistry } from '../adapters/adapter.registry.js';
import type { NormalizedTool, ScopeEntry } from '../types/config.js';
import { ToolType, ConfigScope, ToolStatus } from '../types/enums.js';
import { canonicalKey } from '../utils/tool-key.utils.js';

/**
 * Scope precedence order (highest first).
 *
 * Managed settings override everything, then project, local, and finally user.
 * This matches Claude Code's own resolution: enterprise-managed config wins.
 */
const SCOPE_PRECEDENCE: readonly ConfigScope[] = [
  ConfigScope.Managed,
  ConfigScope.Project,
  ConfigScope.Local,
  ConfigScope.User,
];

/**
 * Which scopes apply to each tool type.
 *
 * - Skills and commands exist only at user and project level.
 * - Hooks exist in all four scopes.
 * - MCP servers exist in user, project, and managed (not local).
 */
const APPLICABLE_SCOPES: Record<ToolType, readonly ConfigScope[]> = {
  [ToolType.Skill]: [ConfigScope.User, ConfigScope.Project],
  [ToolType.Command]: [ConfigScope.User, ConfigScope.Project],
  [ToolType.Hook]: [ConfigScope.User, ConfigScope.Project, ConfigScope.Local, ConfigScope.Managed],
  [ToolType.McpServer]: [ConfigScope.User, ConfigScope.Project, ConfigScope.Managed],
};

/**
 * Service for reading and writing tool configurations with scope resolution.
 *
 * Provides the primary API that all future phases use to interact with
 * tool configurations. Handles:
 * - Multi-scope reading with precedence resolution (Managed > Project > Local > User)
 * - Multi-scope tracking via scopeEntries for the consolidation feature
 * - Safe write pipeline: re-read -> mutate -> validate -> backup -> atomic write
 *
 * Never accesses the filesystem directly -- delegates to FileIOService and
 * platform adapters for all I/O.
 */
export class ConfigService {
  constructor(
    private readonly fileIO: FileIOService,
    private readonly backup: BackupService,
    private readonly schemas: SchemaService,
    private readonly registry: AdapterRegistry,
  ) {}

  /**
   * Read all tools of a given type across all applicable scopes,
   * with scope precedence resolution applied.
   *
   * Returns the effective (winning) tool for each canonical key,
   * with `scopeEntries` tracking all scopes where the tool exists.
   */
  async readAllTools(type: ToolType): Promise<NormalizedTool[]> {
    const adapter = this.registry.getActiveAdapter();
    if (!adapter) {
      return [];
    }

    const scopes = APPLICABLE_SCOPES[type];
    const allTools: NormalizedTool[] = [];

    for (const scope of scopes) {
      try {
        const tools = await adapter.readTools(type, scope);
        allTools.push(...tools);
      } catch (err: unknown) {
        // Read errors produce an error-status tool instead of throwing.
        // This ensures one bad file never prevents loading others.
        const message = err instanceof Error ? err.message : String(err);
        allTools.push({
          id: `${type}:error:${scope}`,
          type,
          name: `Error reading ${scope} ${type}`,
          scope,
          status: ToolStatus.Error,
          statusDetail: message,
          source: { filePath: '' },
          metadata: {},
        });
      }
    }

    return this.resolveScopes(allTools);
  }

  /**
   * Read tools from a single scope only (no resolution).
   *
   * Useful for scope-specific operations like viewing what exists
   * at a particular level before writing.
   */
  async readToolsByScope(type: ToolType, scope: ConfigScope): Promise<NormalizedTool[]> {
    const adapter = this.registry.getActiveAdapter();
    if (!adapter) {
      return [];
    }

    return adapter.readTools(type, scope);
  }

  /**
   * Core scope resolution algorithm.
   *
   * Groups tools by canonical key, then for each group:
   * 1. Collects scope entries from every occurrence
   * 2. Selects the winner from the highest-precedence scope
   * 3. Attaches all scope entries to the winner for UI display
   *
   * Special case: if a tool is disabled at a higher scope but enabled
   * at a lower scope, the disabled state wins (higher precedence rules),
   * but scopeEntries shows both states so the UI can badge it.
   */
  resolveScopes(tools: NormalizedTool[]): NormalizedTool[] {
    const groups = new Map<string, NormalizedTool[]>();

    for (const tool of tools) {
      const key = this.canonicalKey(tool);
      const group = groups.get(key);
      if (group) {
        group.push(tool);
      } else {
        groups.set(key, [tool]);
      }
    }

    const resolved: NormalizedTool[] = [];

    for (const group of groups.values()) {
      // Collect all scope entries
      const scopeEntries: ScopeEntry[] = group.map((tool) => ({
        scope: tool.scope,
        status: tool.status,
        filePath: tool.source.filePath,
      }));

      // Sort group by precedence (highest first)
      group.sort(
        (a, b) => SCOPE_PRECEDENCE.indexOf(a.scope) - SCOPE_PRECEDENCE.indexOf(b.scope),
      );

      // Winner is the tool from the highest-precedence scope
      const winner = { ...group[0], scopeEntries };
      resolved.push(winner);
    }

    return resolved;
  }

  /**
   * Safe write pipeline for JSON config files.
   *
   * Sequence: re-read -> mutate -> validate -> backup -> atomic write.
   *
   * The re-read step ensures we operate on the latest file content,
   * preventing race conditions with external editors.
   * Validation failure throws immediately -- we never write invalid data.
   */
  async writeConfigFile<T>(
    filePath: string,
    schemaKey: string,
    mutate: (current: T) => T,
  ): Promise<void> {
    // 1. Re-read current content
    const readResult = await this.fileIO.readJsonFile<T>(filePath);
    let current: T;
    if (readResult.success) {
      current = (readResult.data ?? {}) as T;
    } else {
      throw new Error(`Failed to read ${filePath}: ${readResult.error}`);
    }

    // 2. Apply mutation
    const updated = mutate(current);

    // 3. Validate against schema
    const validation = this.schemas.validate(schemaKey, updated);
    if (!validation.success) {
      throw new Error(
        `Schema validation failed for ${schemaKey}: ${validation.error.message}`,
      );
    }

    // 4. Backup current file
    await this.backup.createBackup(filePath);

    // 5. Atomic write
    await this.fileIO.writeJsonFile(filePath, updated);
  }

  /**
   * Safe write pipeline for text config files (skills, commands).
   *
   * Sequence: backup -> atomic write.
   * No schema validation for free-form text content.
   */
  async writeTextConfigFile(filePath: string, content: string): Promise<void> {
    await this.backup.createBackup(filePath);
    await this.fileIO.writeTextFile(filePath, content);
  }

  /**
   * Derive a canonical key for grouping tools across scopes.
   *
   * Delegates to the shared canonicalKey utility to ensure consistent
   * key format between ConfigService and ProfileService.
   */
  private canonicalKey(tool: NormalizedTool): string {
    return canonicalKey(tool);
  }
}
