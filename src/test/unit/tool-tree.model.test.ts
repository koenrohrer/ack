import { describe, it, expect, beforeEach } from 'vitest';
import { ToolTreeModel } from '../../views/tool-tree/tool-tree.model.js';
import { ToolType, ConfigScope, ToolStatus } from '../../types/enums.js';
import type { NormalizedTool } from '../../types/config.js';
import type { ConfigService } from '../../services/config.service.js';
import type { AdapterRegistry } from '../../adapters/adapter.registry.js';
import type { IPlatformAdapter } from '../../types/adapter.js';
import type { GroupNode, EventGroupNode, ToolNode, SubToolNode } from '../../views/tool-tree/tool-tree.nodes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(
  overrides: Partial<NormalizedTool> & { name: string; scope: ConfigScope },
): NormalizedTool {
  return {
    id: `${overrides.type ?? ToolType.Skill}:${overrides.name}:${overrides.scope}`,
    type: overrides.type ?? ToolType.Skill,
    name: overrides.name,
    description: overrides.description,
    scope: overrides.scope,
    status: overrides.status ?? ToolStatus.Enabled,
    statusDetail: overrides.statusDetail,
    source: overrides.source ?? {
      filePath: `/fake/${overrides.scope}/${overrides.name}`,
    },
    metadata: overrides.metadata ?? {},
    scopeEntries: overrides.scopeEntries,
  };
}

function createMockConfigService(
  toolsByScope: Record<string, NormalizedTool[]>,
): ConfigService {
  return {
    readToolsByScope(
      type: ToolType,
      scope: ConfigScope,
    ): Promise<NormalizedTool[]> {
      const key = `${type}:${scope}`;
      return Promise.resolve(toolsByScope[key] ?? []);
    },
  } as unknown as ConfigService;
}

function createMockRegistry(
  supportedTypes: Set<ToolType> = new Set([
    ToolType.Skill,
    ToolType.McpServer,
    ToolType.Hook,
    ToolType.Command,
  ]),
): AdapterRegistry {
  const adapter: IPlatformAdapter = {
    id: 'mock',
    displayName: 'Mock',
    supportedToolTypes: supportedTypes,
    async readTools() {
      return [];
    },
    async writeTool() {},
    async removeTool() {},
    getWatchPaths() {
      return [];
    },
    async detect() {
      return true;
    },
  };

  return {
    getActiveAdapter(): IPlatformAdapter {
      return adapter;
    },
  } as unknown as AdapterRegistry;
}

function createInactiveRegistry(): AdapterRegistry {
  return {
    getActiveAdapter(): IPlatformAdapter | undefined {
      return undefined;
    },
  } as unknown as AdapterRegistry;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ToolTreeModel', () => {
  let model: ToolTreeModel;

  beforeEach(() => {
    model = new ToolTreeModel();
  });

  // -----------------------------------------------------------------------
  // Empty state
  // -----------------------------------------------------------------------

  it('returns empty groups when no active adapter', async () => {
    const configService = createMockConfigService({});
    const registry = createInactiveRegistry();

    await model.rebuild(configService, registry);

    expect(model.getRootGroups()).toEqual([]);
  });

  it('returns empty groups when all tool types have zero tools', async () => {
    const configService = createMockConfigService({});
    const registry = createMockRegistry();

    await model.rebuild(configService, registry);

    expect(model.getRootGroups()).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Single type group
  // -----------------------------------------------------------------------

  it('builds one group for 2 skills sorted alphabetically', async () => {
    const tools: Record<string, NormalizedTool[]> = {
      [`${ToolType.Skill}:${ConfigScope.User}`]: [
        makeTool({ name: 'Zebra Skill', scope: ConfigScope.User }),
        makeTool({ name: 'Alpha Skill', scope: ConfigScope.User }),
      ],
    };
    const configService = createMockConfigService(tools);
    const registry = createMockRegistry();

    await model.rebuild(configService, registry);

    const groups = model.getRootGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Skills (2)');
    expect(groups[0].toolType).toBe(ToolType.Skill);

    const children = groups[0].children as ToolNode[];
    expect(children).toHaveLength(2);
    expect(children[0].tool.name).toBe('Alpha Skill');
    expect(children[1].tool.name).toBe('Zebra Skill');
  });

  // -----------------------------------------------------------------------
  // Sort order: global first then alpha
  // -----------------------------------------------------------------------

  it('sorts global tools before project tools, then alphabetical', async () => {
    const tools: Record<string, NormalizedTool[]> = {
      [`${ToolType.Skill}:${ConfigScope.User}`]: [
        makeTool({ name: 'Bravo', scope: ConfigScope.User }),
      ],
      [`${ToolType.Skill}:${ConfigScope.Project}`]: [
        makeTool({ name: 'Alpha', scope: ConfigScope.Project }),
        makeTool({ name: 'Charlie', scope: ConfigScope.Project }),
      ],
    };
    const configService = createMockConfigService(tools);
    const registry = createMockRegistry();

    await model.rebuild(configService, registry);

    const groups = model.getRootGroups();
    const children = groups[0].children as ToolNode[];
    expect(children).toHaveLength(3);

    // Global (User) tools first
    expect(children[0].tool.name).toBe('Bravo');
    expect(children[0].tool.scope).toBe(ConfigScope.User);

    // Then project tools alphabetically
    expect(children[1].tool.name).toBe('Alpha');
    expect(children[1].tool.scope).toBe(ConfigScope.Project);
    expect(children[2].tool.name).toBe('Charlie');
    expect(children[2].tool.scope).toBe(ConfigScope.Project);
  });

  // -----------------------------------------------------------------------
  // Empty groups hidden
  // -----------------------------------------------------------------------

  it('hides groups with zero tools', async () => {
    const tools: Record<string, NormalizedTool[]> = {
      [`${ToolType.Skill}:${ConfigScope.User}`]: [
        makeTool({ name: 'Some Skill', scope: ConfigScope.User }),
      ],
      // No MCP servers, hooks, or commands
    };
    const configService = createMockConfigService(tools);
    const registry = createMockRegistry();

    await model.rebuild(configService, registry);

    const groups = model.getRootGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].toolType).toBe(ToolType.Skill);
  });

  // -----------------------------------------------------------------------
  // Hook event grouping
  // -----------------------------------------------------------------------

  it('groups hooks by event type into EventGroupNodes', async () => {
    const tools: Record<string, NormalizedTool[]> = {
      [`${ToolType.Hook}:${ConfigScope.User}`]: [
        makeTool({
          name: 'lint-check',
          scope: ConfigScope.User,
          type: ToolType.Hook,
          metadata: { eventName: 'PreToolUse', matcher: 'Bash' },
        }),
        makeTool({
          name: 'log-output',
          scope: ConfigScope.User,
          type: ToolType.Hook,
          metadata: { eventName: 'PostToolUse', matcher: '*' },
        }),
        makeTool({
          name: 'format-check',
          scope: ConfigScope.User,
          type: ToolType.Hook,
          metadata: { eventName: 'PreToolUse', matcher: 'Write' },
        }),
      ],
    };
    const configService = createMockConfigService(tools);
    const registry = createMockRegistry();

    await model.rebuild(configService, registry);

    const groups = model.getRootGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Hooks (3)');

    const eventGroups = groups[0].children as EventGroupNode[];
    expect(eventGroups).toHaveLength(2);

    // PreToolUse group
    const preToolUse = eventGroups.find((g) => g.eventName === 'PreToolUse');
    expect(preToolUse).toBeDefined();
    expect(preToolUse!.label).toBe('Pre-tool Use');
    expect(preToolUse!.children).toHaveLength(2);

    // PostToolUse group
    const postToolUse = eventGroups.find((g) => g.eventName === 'PostToolUse');
    expect(postToolUse).toBeDefined();
    expect(postToolUse!.label).toBe('Post-tool Use');
    expect(postToolUse!.children).toHaveLength(1);
  });

  it('uses event name as-is for unknown hook events', async () => {
    const tools: Record<string, NormalizedTool[]> = {
      [`${ToolType.Hook}:${ConfigScope.User}`]: [
        makeTool({
          name: 'custom-hook',
          scope: ConfigScope.User,
          type: ToolType.Hook,
          metadata: { eventName: 'CustomEvent' },
        }),
      ],
    };
    const configService = createMockConfigService(tools);
    const registry = createMockRegistry();

    await model.rebuild(configService, registry);

    const groups = model.getRootGroups();
    const eventGroups = groups[0].children as EventGroupNode[];
    expect(eventGroups[0].label).toBe('CustomEvent');
  });

  // -----------------------------------------------------------------------
  // MCP sub-tools
  // -----------------------------------------------------------------------

  it('creates SubToolNode children for MCP servers with config details', async () => {
    const tools: Record<string, NormalizedTool[]> = {
      [`${ToolType.McpServer}:${ConfigScope.User}`]: [
        makeTool({
          name: 'my-mcp',
          scope: ConfigScope.User,
          type: ToolType.McpServer,
          metadata: {
            command: 'npx',
            args: ['-y', '@some/mcp-server'],
            transportType: 'stdio',
          },
        }),
      ],
    };
    const configService = createMockConfigService(tools);
    const registry = createMockRegistry();

    await model.rebuild(configService, registry);

    const groups = model.getRootGroups();
    const mcpNode = groups[0].children[0] as ToolNode;
    expect(mcpNode.children).toBeDefined();
    expect(mcpNode.children).toHaveLength(2);

    const labels = mcpNode.children!.map((c) => c.label);
    expect(labels).toContain('Command');
    expect(labels).toContain('Transport');

    const cmdNode = mcpNode.children!.find(
      (c) => c.label === 'Command',
    ) as SubToolNode;
    expect(cmdNode.detail).toBe('npx -y @some/mcp-server');

    const transportNode = mcpNode.children!.find(
      (c) => c.label === 'Transport',
    ) as SubToolNode;
    expect(transportNode.detail).toBe('stdio');
  });

  it('creates URL sub-tool for MCP servers with url metadata', async () => {
    const tools: Record<string, NormalizedTool[]> = {
      [`${ToolType.McpServer}:${ConfigScope.User}`]: [
        makeTool({
          name: 'sse-server',
          scope: ConfigScope.User,
          type: ToolType.McpServer,
          metadata: {
            url: 'https://example.com/mcp',
          },
        }),
      ],
    };
    const configService = createMockConfigService(tools);
    const registry = createMockRegistry();

    await model.rebuild(configService, registry);

    const groups = model.getRootGroups();
    const mcpNode = groups[0].children[0] as ToolNode;
    expect(mcpNode.children).toHaveLength(1);

    const urlNode = mcpNode.children![0] as SubToolNode;
    expect(urlNode.label).toBe('URL');
    expect(urlNode.detail).toBe('https://example.com/mcp');
  });

  // -----------------------------------------------------------------------
  // Dual-scope entries
  // -----------------------------------------------------------------------

  it('shows separate entries for same tool at User and Project scope', async () => {
    const tools: Record<string, NormalizedTool[]> = {
      [`${ToolType.Skill}:${ConfigScope.User}`]: [
        makeTool({ name: 'shared-skill', scope: ConfigScope.User }),
      ],
      [`${ToolType.Skill}:${ConfigScope.Project}`]: [
        makeTool({ name: 'shared-skill', scope: ConfigScope.Project }),
      ],
    };
    const configService = createMockConfigService(tools);
    const registry = createMockRegistry();

    await model.rebuild(configService, registry);

    const groups = model.getRootGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Skills (2)');

    const children = groups[0].children as ToolNode[];
    expect(children).toHaveLength(2);

    // Both have the same name but different scopes
    expect(children[0].tool.scope).toBe(ConfigScope.User);
    expect(children[1].tool.scope).toBe(ConfigScope.Project);
  });

  it('marks project-scope entry as effective when same tool exists at both scopes', async () => {
    const tools: Record<string, NormalizedTool[]> = {
      [`${ToolType.Skill}:${ConfigScope.User}`]: [
        makeTool({ name: 'shared-skill', scope: ConfigScope.User }),
      ],
      [`${ToolType.Skill}:${ConfigScope.Project}`]: [
        makeTool({ name: 'shared-skill', scope: ConfigScope.Project }),
      ],
    };
    const configService = createMockConfigService(tools);
    const registry = createMockRegistry();

    await model.rebuild(configService, registry);

    const children = model.getRootGroups()[0].children as ToolNode[];

    // User-scope entry is NOT effective (overridden by project)
    const userEntry = children.find(
      (c) => c.tool.scope === ConfigScope.User,
    );
    expect(userEntry!.isEffective).toBe(false);

    // Project-scope entry IS effective (higher precedence)
    const projectEntry = children.find(
      (c) => c.tool.scope === ConfigScope.Project,
    );
    expect(projectEntry!.isEffective).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Group labels include count
  // -----------------------------------------------------------------------

  it('includes item count in group labels', async () => {
    const tools: Record<string, NormalizedTool[]> = {
      [`${ToolType.Command}:${ConfigScope.User}`]: [
        makeTool({
          name: 'cmd1',
          scope: ConfigScope.User,
          type: ToolType.Command,
        }),
        makeTool({
          name: 'cmd2',
          scope: ConfigScope.User,
          type: ToolType.Command,
        }),
        makeTool({
          name: 'cmd3',
          scope: ConfigScope.User,
          type: ToolType.Command,
        }),
      ],
    };
    const configService = createMockConfigService(tools);
    const registry = createMockRegistry();

    await model.rebuild(configService, registry);

    const groups = model.getRootGroups();
    expect(groups[0].label).toBe('Commands (3)');
  });

  // -----------------------------------------------------------------------
  // Parent references
  // -----------------------------------------------------------------------

  it('sets correct parent references on all nodes', async () => {
    const tools: Record<string, NormalizedTool[]> = {
      [`${ToolType.McpServer}:${ConfigScope.User}`]: [
        makeTool({
          name: 'my-server',
          scope: ConfigScope.User,
          type: ToolType.McpServer,
          metadata: { command: 'node', args: ['server.js'] },
        }),
      ],
      [`${ToolType.Hook}:${ConfigScope.User}`]: [
        makeTool({
          name: 'my-hook',
          scope: ConfigScope.User,
          type: ToolType.Hook,
          metadata: { eventName: 'PreToolUse' },
        }),
      ],
    };
    const configService = createMockConfigService(tools);
    const registry = createMockRegistry();

    await model.rebuild(configService, registry);

    const groups = model.getRootGroups();

    // GroupNode parent is undefined (root level)
    for (const group of groups) {
      expect(group.parent).toBeUndefined();
    }

    // MCP server group -> tool node -> sub-tool node
    const mcpGroup = groups.find(
      (g) => g.toolType === ToolType.McpServer,
    )!;
    const mcpTool = mcpGroup.children[0] as ToolNode;
    expect(mcpTool.parent).toBe(mcpGroup);
    expect(model.findParent(mcpTool)).toBe(mcpGroup);

    if (mcpTool.children && mcpTool.children.length > 0) {
      const subTool = mcpTool.children[0];
      expect(subTool.parent).toBe(mcpTool);
      expect(model.findParent(subTool)).toBe(mcpTool);
    }

    // Hook group -> event group -> tool node
    const hookGroup = groups.find(
      (g) => g.toolType === ToolType.Hook,
    )!;
    const eventGroup = hookGroup.children[0] as EventGroupNode;
    expect(eventGroup.parent).toBe(hookGroup);
    expect(model.findParent(eventGroup)).toBe(hookGroup);

    const hookTool = eventGroup.children[0] as ToolNode;
    expect(hookTool.parent).toBe(eventGroup);
    expect(model.findParent(hookTool)).toBe(eventGroup);
  });

  // -----------------------------------------------------------------------
  // Group ordering
  // -----------------------------------------------------------------------

  it('maintains group order: Skills, MCP Servers, Hooks, Commands', async () => {
    const tools: Record<string, NormalizedTool[]> = {
      [`${ToolType.Command}:${ConfigScope.User}`]: [
        makeTool({
          name: 'cmd',
          scope: ConfigScope.User,
          type: ToolType.Command,
        }),
      ],
      [`${ToolType.Skill}:${ConfigScope.User}`]: [
        makeTool({ name: 'skill', scope: ConfigScope.User }),
      ],
      [`${ToolType.Hook}:${ConfigScope.User}`]: [
        makeTool({
          name: 'hook',
          scope: ConfigScope.User,
          type: ToolType.Hook,
          metadata: { eventName: 'Stop' },
        }),
      ],
      [`${ToolType.McpServer}:${ConfigScope.User}`]: [
        makeTool({
          name: 'server',
          scope: ConfigScope.User,
          type: ToolType.McpServer,
        }),
      ],
    };
    const configService = createMockConfigService(tools);
    const registry = createMockRegistry();

    await model.rebuild(configService, registry);

    const groups = model.getRootGroups();
    expect(groups).toHaveLength(4);
    expect(groups[0].toolType).toBe(ToolType.Skill);
    expect(groups[1].toolType).toBe(ToolType.McpServer);
    expect(groups[2].toolType).toBe(ToolType.Hook);
    expect(groups[3].toolType).toBe(ToolType.Command);
  });

  // -----------------------------------------------------------------------
  // Unsupported tool types excluded
  // -----------------------------------------------------------------------

  it('skips tool types not supported by the adapter', async () => {
    const tools: Record<string, NormalizedTool[]> = {
      [`${ToolType.Skill}:${ConfigScope.User}`]: [
        makeTool({ name: 'skill', scope: ConfigScope.User }),
      ],
      [`${ToolType.McpServer}:${ConfigScope.User}`]: [
        makeTool({
          name: 'server',
          scope: ConfigScope.User,
          type: ToolType.McpServer,
        }),
      ],
    };
    const configService = createMockConfigService(tools);
    // Only supports Skills
    const registry = createMockRegistry(new Set([ToolType.Skill]));

    await model.rebuild(configService, registry);

    const groups = model.getRootGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].toolType).toBe(ToolType.Skill);
  });

  // -----------------------------------------------------------------------
  // MCP servers without config produce no sub-tools
  // -----------------------------------------------------------------------

  it('produces no sub-tools for MCP servers without config metadata', async () => {
    const tools: Record<string, NormalizedTool[]> = {
      [`${ToolType.McpServer}:${ConfigScope.User}`]: [
        makeTool({
          name: 'bare-server',
          scope: ConfigScope.User,
          type: ToolType.McpServer,
          metadata: {},
        }),
      ],
    };
    const configService = createMockConfigService(tools);
    const registry = createMockRegistry();

    await model.rebuild(configService, registry);

    const groups = model.getRootGroups();
    const mcpNode = groups[0].children[0] as ToolNode;
    expect(mcpNode.children).toBeUndefined();
  });
});
