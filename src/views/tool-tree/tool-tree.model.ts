import type { ConfigService } from '../../services/config.service.js';
import type { AdapterRegistry } from '../../adapters/adapter.registry.js';
import type { NormalizedTool } from '../../types/config.js';
import { ToolType, ConfigScope, ToolStatus } from '../../types/enums.js';
import type {
  TreeNode,
  GroupNode,
  EventGroupNode,
  ToolNode,
  SubToolNode,
} from './tool-tree.nodes.js';

/**
 * Display names for each tool type group.
 */
const GROUP_DISPLAY_NAMES: Record<ToolType, string> = {
  [ToolType.Skill]: 'Skills',
  [ToolType.McpServer]: 'MCP Servers',
  [ToolType.Hook]: 'Hooks',
  [ToolType.Command]: 'Commands',
};

/**
 * Human-readable labels for hook event names.
 */
const HOOK_EVENT_DISPLAY_NAMES: Record<string, string> = {
  PreToolUse: 'Pre-tool Use',
  PostToolUse: 'Post-tool Use',
  Notification: 'Notification',
  Stop: 'Stop',
  SubagentStop: 'Subagent Stop',
};

/**
 * Which scopes apply to each tool type.
 *
 * Mirrors the constant in ConfigService -- duplicated here because
 * the model reads per-scope and needs to know which scopes to query.
 */
const APPLICABLE_SCOPES: Record<ToolType, readonly ConfigScope[]> = {
  [ToolType.Skill]: [ConfigScope.User, ConfigScope.Project],
  [ToolType.Command]: [ConfigScope.User, ConfigScope.Project],
  [ToolType.Hook]: [
    ConfigScope.User,
    ConfigScope.Project,
    ConfigScope.Local,
    ConfigScope.Managed,
  ],
  [ToolType.McpServer]: [
    ConfigScope.User,
    ConfigScope.Project,
    ConfigScope.Managed,
  ],
};

/**
 * Scope precedence order (highest first).
 *
 * Managed overrides everything, then project/local, then user.
 * Used to determine which dual-scope entry is the effective one.
 */
const SCOPE_PRECEDENCE: readonly ConfigScope[] = [
  ConfigScope.Managed,
  ConfigScope.Project,
  ConfigScope.Local,
  ConfigScope.User,
];

/**
 * Ordered list of tool types for group display.
 */
const GROUP_ORDER: readonly ToolType[] = [
  ToolType.Skill,
  ToolType.McpServer,
  ToolType.Hook,
  ToolType.Command,
];

/**
 * Scope ordering for sort: global-scope tools first, then project-scope.
 *
 * User and Managed map to 0 (global), Project and Local map to 1 (project).
 */
function scopeSortOrder(scope: ConfigScope): number {
  switch (scope) {
    case ConfigScope.User:
    case ConfigScope.Managed:
      return 0;
    case ConfigScope.Project:
    case ConfigScope.Local:
      return 1;
  }
}

/**
 * Transforms NormalizedTool[] into a tree hierarchy for the sidebar view.
 *
 * Reads tools per-scope (not readAllTools) so that tools existing at both
 * global and project scope appear as separate entries. Runs precedence
 * logic to mark the effective entry with `isEffective`.
 *
 * Tree structure:
 * - GroupNode (Skills, MCP Servers, Hooks, Commands)
 *   - ToolNode (individual tools) or EventGroupNode (hook event types)
 *     - SubToolNode (MCP server config details)
 */
export class ToolTreeModel {
  private groups: GroupNode[] = [];

  /**
   * Rebuild the entire tree from ConfigService data.
   *
   * Reads all tool types across all applicable scopes, builds the
   * hierarchy, and stores it for retrieval via getRootGroups().
   */
  async rebuild(
    configService: ConfigService,
    registry: AdapterRegistry,
  ): Promise<void> {
    const adapter = registry.getActiveAdapter();
    if (!adapter) {
      this.groups = [];
      return;
    }

    const newGroups: GroupNode[] = [];

    for (const type of GROUP_ORDER) {
      if (!adapter.supportedToolTypes.has(type)) {
        continue;
      }

      // Read from all applicable scopes to get separate entries
      const allTools: NormalizedTool[] = [];
      const applicableScopes = APPLICABLE_SCOPES[type];

      for (const scope of applicableScopes) {
        try {
          const tools = await configService.readToolsByScope(type, scope);
          allTools.push(...tools);
        } catch {
          // Silently skip scope read errors -- they'll surface as
          // error-status tools when readAllTools is used elsewhere
        }
      }

      if (allTools.length === 0) {
        continue; // Hide empty groups
      }

      // Mark effective entries for dual-scope tools
      const effectiveKeys = this.findEffectiveKeys(allTools);

      // Sort: global-first (User/Managed), then project (Project/Local), alphabetical within
      allTools.sort((a, b) => {
        const scopeDiff = scopeSortOrder(a.scope) - scopeSortOrder(b.scope);
        if (scopeDiff !== 0) return scopeDiff;
        return a.name.localeCompare(b.name);
      });

      // Build the group
      const group = this.buildGroup(type, allTools, effectiveKeys);
      newGroups.push(group);
    }

    this.groups = newGroups;
  }

  /**
   * Return the top-level group nodes.
   */
  getRootGroups(): GroupNode[] {
    return this.groups;
  }

  /**
   * Find the parent of any tree node.
   *
   * Returns the stored parent reference, which is set during tree construction.
   */
  findParent(node: TreeNode): TreeNode | undefined {
    return node.parent;
  }

  /**
   * Find which tools are the effective (winning) entry for dual-scope scenarios.
   *
   * Returns a Set of tool identifiers (`type:name:scope`) that are effective.
   * The highest-precedence scope wins for each canonical key.
   */
  private findEffectiveKeys(tools: NormalizedTool[]): Set<string> {
    const canonical = new Map<string, NormalizedTool>();

    for (const tool of tools) {
      const key = this.canonicalKey(tool);
      const existing = canonical.get(key);

      if (!existing) {
        canonical.set(key, tool);
      } else {
        // Higher precedence (lower index) wins
        const existingPrecedence = SCOPE_PRECEDENCE.indexOf(existing.scope);
        const newPrecedence = SCOPE_PRECEDENCE.indexOf(tool.scope);
        if (newPrecedence < existingPrecedence) {
          canonical.set(key, tool);
        }
      }
    }

    const effectiveIds = new Set<string>();
    for (const tool of canonical.values()) {
      effectiveIds.add(this.toolIdentity(tool));
    }

    return effectiveIds;
  }

  /**
   * Canonical key for grouping tools across scopes (scope-agnostic).
   */
  private canonicalKey(tool: NormalizedTool): string {
    if (tool.type === ToolType.Hook) {
      const eventName = tool.metadata.eventName as string | undefined;
      const matcher = tool.metadata.matcher as string | undefined;
      if (eventName) {
        return `hook:${eventName}:${matcher ?? ''}`;
      }
    }
    return `${tool.type}:${tool.name}`;
  }

  /**
   * Unique identity for a specific tool instance (scope-aware).
   */
  private toolIdentity(tool: NormalizedTool): string {
    return `${tool.type}:${tool.name}:${tool.scope}`;
  }

  /**
   * Build a GroupNode for a tool type with all its children.
   */
  private buildGroup(
    type: ToolType,
    tools: NormalizedTool[],
    effectiveKeys: Set<string>,
  ): GroupNode {
    const displayName = GROUP_DISPLAY_NAMES[type];

    // Create the group node (parent: undefined for root-level groups)
    const group: GroupNode = {
      kind: 'group',
      toolType: type,
      label: `${displayName} (${tools.length})`,
      // children will be set below via Object.defineProperty to maintain readonly interface
      children: [],
      parent: undefined,
    };

    if (type === ToolType.Hook) {
      // Group hooks by event type into EventGroupNodes
      (group as { children: TreeNode[] }).children =
        this.buildHookEventGroups(tools, effectiveKeys, group);
    } else {
      // Direct tool children
      (group as { children: TreeNode[] }).children = tools.map((tool) =>
        this.buildToolNode(tool, effectiveKeys, group),
      );
    }

    return group;
  }

  /**
   * Build EventGroupNode intermediates for hooks grouped by event name.
   */
  private buildHookEventGroups(
    tools: NormalizedTool[],
    effectiveKeys: Set<string>,
    parentGroup: GroupNode,
  ): EventGroupNode[] {
    // Group by eventName
    const byEvent = new Map<string, NormalizedTool[]>();
    for (const tool of tools) {
      const eventName = (tool.metadata.eventName as string) ?? 'Unknown';
      const group = byEvent.get(eventName);
      if (group) {
        group.push(tool);
      } else {
        byEvent.set(eventName, [tool]);
      }
    }

    const eventGroups: EventGroupNode[] = [];
    for (const [eventName, eventTools] of byEvent) {
      const displayName =
        HOOK_EVENT_DISPLAY_NAMES[eventName] ?? eventName;

      const eventGroup: EventGroupNode = {
        kind: 'event-group',
        eventName,
        label: displayName,
        children: [],
        parent: parentGroup,
      };

      (eventGroup as { children: ToolNode[] }).children = eventTools.map(
        (tool) => this.buildToolNode(tool, effectiveKeys, eventGroup) as ToolNode,
      );

      eventGroups.push(eventGroup);
    }

    return eventGroups;
  }

  /**
   * Build a ToolNode, optionally with SubToolNode children for MCP servers.
   */
  private buildToolNode(
    tool: NormalizedTool,
    effectiveKeys: Set<string>,
    parent: GroupNode | EventGroupNode,
  ): ToolNode {
    const isEffective = effectiveKeys.has(this.toolIdentity(tool));

    const node: ToolNode = {
      kind: 'tool',
      tool,
      parent,
      isEffective,
      children: undefined,
    };

    // MCP servers get sub-tool children showing config details
    if (tool.type === ToolType.McpServer) {
      const subTools = this.buildMcpSubTools(tool, node);
      if (subTools.length > 0) {
        (node as { children: SubToolNode[] }).children = subTools;
      }
    }

    return node;
  }

  /**
   * Build SubToolNode children for an MCP server showing its config details,
   * per-tool entries (enabled_tools/disabled_tools), and env var entries.
   *
   * Order: config info first, then per-tool entries (alphabetical),
   * then env var entries (alphabetical).
   */
  private buildMcpSubTools(tool: NormalizedTool, parent: ToolNode): SubToolNode[] {
    const subTools: SubToolNode[] = [];
    const meta = tool.metadata;

    // -- Config info children (subKind: 'config') --

    if (meta.command) {
      const args = Array.isArray(meta.args)
        ? (meta.args as string[]).join(' ')
        : '';
      subTools.push({
        kind: 'subtool',
        subKind: 'config',
        label: 'Command',
        detail: args ? `${meta.command as string} ${args}` : (meta.command as string),
        parentTool: tool,
        parent,
      });
    }

    if (meta.url) {
      subTools.push({
        kind: 'subtool',
        subKind: 'config',
        label: 'URL',
        detail: meta.url as string,
        parentTool: tool,
        parent,
      });
    }

    if (meta.transportType) {
      subTools.push({
        kind: 'subtool',
        subKind: 'config',
        label: 'Transport',
        detail: meta.transportType as string,
        parentTool: tool,
        parent,
      });
    }

    // -- Per-tool entries (subKind: 'mcp-tool') --

    const enabledTools = Array.isArray(meta.enabled_tools)
      ? (meta.enabled_tools as string[])
      : [];
    const disabledTools = Array.isArray(meta.disabled_tools)
      ? new Set(meta.disabled_tools as string[])
      : new Set<string>();

    if (enabledTools.length > 0 || disabledTools.size > 0) {
      // Collect all unique tool names; disabled_tools takes priority
      const allToolNames = new Set<string>([
        ...enabledTools,
        ...disabledTools,
      ]);
      const sortedToolNames = [...allToolNames].sort((a, b) =>
        a.localeCompare(b),
      );

      for (const toolName of sortedToolNames) {
        const isDisabled = disabledTools.has(toolName);
        subTools.push({
          kind: 'subtool',
          subKind: 'mcp-tool',
          label: toolName,
          detail: isDisabled ? 'disabled' : 'enabled',
          parentTool: tool,
          parent,
        });
      }
    }

    // -- Env var entries (subKind: 'env-var') --

    const env = meta.env as Record<string, string> | undefined;
    if (env && typeof env === 'object') {
      const sortedKeys = Object.keys(env).sort((a, b) => a.localeCompare(b));

      for (const key of sortedKeys) {
        subTools.push({
          kind: 'subtool',
          subKind: 'env-var',
          label: key,
          detail: '********',
          parentTool: tool,
          parent,
        });
      }
    }

    return subTools;
  }
}
