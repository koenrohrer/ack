import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolType, ConfigScope, ToolStatus } from '../../types/enums.js';
import type { NormalizedTool } from '../../types/config.js';
import type { AgentProvider } from '../../types/provider.js';
import type { ConfigService } from '../../services/config.service.js';
import { createMockProvider as createBaseMockProvider } from './helpers/mock-provider.js';
import { ProviderRegistry } from '../../providers/provider.registry.js';
import { ToolManagerService } from '../../services/tool-manager.service.js';
import {
  buildToolContextValue,
  getAvailableActions,
  getMoveTargets,
  isManaged,
  buildDeleteDescription,
  isToggleDisable,
} from '../../services/tool-manager.utils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(overrides: Partial<NormalizedTool> = {}): NormalizedTool {
  return {
    id: 'skill:test-tool',
    type: ToolType.Skill,
    name: 'test-tool',
    scope: ConfigScope.User,
    status: ToolStatus.Enabled,
    source: {
      filePath: '/home/user/.claude/skills/test-tool/SKILL.md',
      directoryPath: '/home/user/.claude/skills/test-tool',
      isDirectory: true,
    },
    metadata: {},
    ...overrides,
  };
}

function makeMcpTool(overrides: Partial<NormalizedTool> = {}): NormalizedTool {
  return makeTool({
    id: 'mcp_server:my-server',
    type: ToolType.McpServer,
    name: 'my-server',
    source: {
      filePath: '/home/user/.claude.json',
    },
    metadata: { command: 'node', args: ['server.js'] },
    ...overrides,
  });
}

function makeHookTool(overrides: Partial<NormalizedTool> = {}): NormalizedTool {
  return makeTool({
    id: 'hook:user:PreToolUse:0',
    type: ToolType.Hook,
    name: 'PreToolUse (Bash)',
    source: {
      filePath: '/home/user/.claude/settings.json',
    },
    metadata: { eventName: 'PreToolUse', matcher: 'Bash' },
    ...overrides,
  });
}

function makeCommandTool(overrides: Partial<NormalizedTool> = {}): NormalizedTool {
  return makeTool({
    id: 'command:review',
    type: ToolType.Command,
    name: 'review',
    source: {
      filePath: '/workspace/.claude/commands/review.md',
      isDirectory: false,
    },
    scope: ConfigScope.Project,
    metadata: {},
    ...overrides,
  });
}

function makeCustomPromptTool(overrides: Partial<NormalizedTool> = {}): NormalizedTool {
  return makeTool({
    id: 'custom_prompt:summarize',
    type: ToolType.CustomPrompt,
    name: 'summarize',
    source: {
      filePath: '/home/user/.codex/prompts/summarize.md',
      isDirectory: false,
    },
    metadata: {},
    ...overrides,
  });
}

function createMockProvider(): AgentProvider {
  return createBaseMockProvider({
    id: 'claude-code',
    displayName: 'Claude Code',
    supportedToolTypes: new Set([ToolType.Skill, ToolType.McpServer, ToolType.Hook, ToolType.Command]),
    readTools: vi.fn().mockResolvedValue([]),
    writeTool: vi.fn().mockResolvedValue(undefined),
    removeTool: vi.fn().mockResolvedValue(undefined),
    toggleTool: vi.fn().mockResolvedValue(undefined),
    getWatchPaths: vi.fn().mockReturnValue([]),
    detect: vi.fn().mockResolvedValue(true),
  });
}

function createMockConfigService(): ConfigService {
  return {
    readAllTools: vi.fn().mockResolvedValue([]),
    readToolsByScope: vi.fn().mockResolvedValue([]),
    resolveScopes: vi.fn().mockReturnValue([]),
    writeConfigFile: vi.fn().mockResolvedValue(undefined),
    writeTextConfigFile: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConfigService;
}

// ---------------------------------------------------------------------------
// Utils tests
// ---------------------------------------------------------------------------

describe('tool-manager.utils', () => {
  describe('getAvailableActions', () => {
    it('returns empty array for managed scope tool', () => {
      const tool = makeTool({ scope: ConfigScope.Managed });
      expect(getAvailableActions(tool)).toEqual([]);
    });

    it('returns toggle, delete, move for enabled skill', () => {
      const tool = makeTool({ status: ToolStatus.Enabled });
      expect(getAvailableActions(tool)).toEqual(['toggle', 'delete', 'move']);
    });

    it('returns toggle, delete, move for enabled MCP server', () => {
      const tool = makeMcpTool({ status: ToolStatus.Enabled });
      expect(getAvailableActions(tool)).toEqual(['toggle', 'delete', 'move']);
    });

    it('returns toggle, delete, move for enabled hook', () => {
      const tool = makeHookTool({ status: ToolStatus.Enabled });
      expect(getAvailableActions(tool)).toEqual(['toggle', 'delete', 'move']);
    });

    it('returns toggle, delete, move for enabled command', () => {
      const tool = makeCommandTool({ status: ToolStatus.Enabled });
      expect(getAvailableActions(tool)).toEqual(['toggle', 'delete', 'move']);
    });

    it('returns only delete for error-status tool', () => {
      const tool = makeTool({ status: ToolStatus.Error });
      expect(getAvailableActions(tool)).toEqual(['delete']);
    });

    it('returns toggle, delete, move for disabled tool (non-managed)', () => {
      const tool = makeTool({ status: ToolStatus.Disabled });
      expect(getAvailableActions(tool)).toEqual(['toggle', 'delete', 'move']);
    });

    it('omits toggle and move when provider capabilities exclude the tool type', () => {
      const tool = makeMcpTool({ status: ToolStatus.Enabled });
      expect(
        getAvailableActions(tool, {
          toggleableToolTypes: new Set([ToolType.Skill]),
          movableToolTypes: new Set([ToolType.Skill]),
        }),
      ).toEqual(['delete']);
    });

    it('keeps Claude/Codex default action availability when no capability subset is provided', () => {
      const tool = makeMcpTool({ status: ToolStatus.Enabled });
      expect(getAvailableActions(tool, {})).toEqual(['toggle', 'delete', 'move']);
    });

    it('does not expose toggle or move for custom prompts', () => {
      const tool = makeCustomPromptTool({ status: ToolStatus.Enabled });
      expect(getAvailableActions(tool)).toEqual(['delete']);
    });
  });

  describe('getMoveTargets', () => {
    it('returns [Project] for user-scope skill', () => {
      const tool = makeTool({ scope: ConfigScope.User });
      expect(getMoveTargets(tool)).toEqual([ConfigScope.Project]);
    });

    it('returns [User] for project-scope MCP server', () => {
      const tool = makeMcpTool({ scope: ConfigScope.Project });
      expect(getMoveTargets(tool)).toEqual([ConfigScope.User]);
    });

    it('returns empty array for managed-scope tool', () => {
      const tool = makeTool({ scope: ConfigScope.Managed });
      expect(getMoveTargets(tool)).toEqual([]);
    });

    it('returns [User] for project-scope hook', () => {
      const tool = makeHookTool({ scope: ConfigScope.Project });
      expect(getMoveTargets(tool)).toEqual([ConfigScope.User]);
    });

    it('returns [User, Project] for local-scope hook (neither user nor project)', () => {
      const tool = makeHookTool({ scope: ConfigScope.Local });
      expect(getMoveTargets(tool)).toEqual([ConfigScope.User, ConfigScope.Project]);
    });

    it('returns empty array when provider capabilities exclude moves for the tool type', () => {
      const tool = makeMcpTool({ scope: ConfigScope.Project });
      expect(
        getMoveTargets(tool, {
          movableToolTypes: new Set([ToolType.Skill]),
        }),
      ).toEqual([]);
    });

    it('returns empty array for custom prompts', () => {
      const tool = makeCustomPromptTool({ scope: ConfigScope.User });
      expect(getMoveTargets(tool)).toEqual([]);
    });
  });

  describe('buildToolContextValue', () => {
    it('includes action markers before the final scope segment by default', () => {
      const tool = makeMcpTool({ scope: ConfigScope.User });
      expect(buildToolContextValue(tool)).toBe(
        'tool:mcp_server:enabled:toggleable:deletable:movable:user',
      );
    });

    it('omits unavailable action markers while preserving the final scope segment', () => {
      const tool = makeMcpTool({ scope: ConfigScope.Project });
      expect(
        buildToolContextValue(tool, {
          toggleableToolTypes: new Set([ToolType.Skill]),
          movableToolTypes: new Set([ToolType.Skill]),
        }),
      ).toBe('tool:mcp_server:enabled:deletable:project');
    });

    it('omits toggleable and movable markers for custom prompts', () => {
      const tool = makeCustomPromptTool({ scope: ConfigScope.User });
      expect(buildToolContextValue(tool)).toBe(
        'tool:custom_prompt:enabled:deletable:user',
      );
    });
  });

  describe('isManaged', () => {
    it('returns true for managed scope', () => {
      const tool = makeTool({ scope: ConfigScope.Managed });
      expect(isManaged(tool)).toBe(true);
    });

    it('returns false for user scope', () => {
      const tool = makeTool({ scope: ConfigScope.User });
      expect(isManaged(tool)).toBe(false);
    });

    it('returns false for project scope', () => {
      const tool = makeTool({ scope: ConfigScope.Project });
      expect(isManaged(tool)).toBe(false);
    });

    it('returns false for local scope', () => {
      const tool = makeTool({ scope: ConfigScope.Local });
      expect(isManaged(tool)).toBe(false);
    });
  });

  describe('buildDeleteDescription', () => {
    it('includes directory path for skill', () => {
      const tool = makeTool();
      const desc = buildDeleteDescription(tool);
      expect(desc).toContain('skill');
      expect(desc).toContain('test-tool');
      expect(desc).toContain('/home/user/.claude/skills/test-tool');
    });

    it('includes server name and file path for MCP', () => {
      const tool = makeMcpTool();
      const desc = buildDeleteDescription(tool);
      expect(desc).toContain('MCP server');
      expect(desc).toContain('my-server');
      expect(desc).toContain('.claude.json');
    });

    it('includes event name and file path for hook', () => {
      const tool = makeHookTool();
      const desc = buildDeleteDescription(tool);
      expect(desc).toContain('hook');
      expect(desc).toContain('PreToolUse');
      expect(desc).toContain('Bash');
      expect(desc).toContain('settings.json');
    });

    it('includes file path for command', () => {
      const tool = makeCommandTool();
      const desc = buildDeleteDescription(tool);
      expect(desc).toContain('command');
      expect(desc).toContain('review');
    });
  });

  describe('isToggleDisable', () => {
    it('returns true for enabled skill (no .disabled suffix)', () => {
      const tool = makeTool({ status: ToolStatus.Enabled });
      expect(isToggleDisable(tool)).toBe(true);
    });

    it('returns false for disabled skill (.disabled suffix)', () => {
      const tool = makeTool({
        status: ToolStatus.Disabled,
        source: {
          filePath: '/home/user/.claude/skills/test-tool.disabled/SKILL.md',
          directoryPath: '/home/user/.claude/skills/test-tool.disabled',
          isDirectory: true,
        },
      });
      expect(isToggleDisable(tool)).toBe(false);
    });

    it('returns true for enabled MCP server', () => {
      const tool = makeMcpTool({ status: ToolStatus.Enabled });
      expect(isToggleDisable(tool)).toBe(true);
    });

    it('returns false for disabled MCP server', () => {
      const tool = makeMcpTool({ status: ToolStatus.Disabled });
      expect(isToggleDisable(tool)).toBe(false);
    });

    it('returns true for enabled hook', () => {
      const tool = makeHookTool({ status: ToolStatus.Enabled });
      expect(isToggleDisable(tool)).toBe(true);
    });

    it('returns false for disabled hook', () => {
      const tool = makeHookTool({ status: ToolStatus.Disabled });
      expect(isToggleDisable(tool)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// ToolManagerService tests
// ---------------------------------------------------------------------------

describe('ToolManagerService', () => {
  let service: ToolManagerService;
  let mockProvider: AgentProvider;
  let mockConfigService: ConfigService;
  let registry: ProviderRegistry;

  beforeEach(() => {
    vi.clearAllMocks();

    mockProvider = createMockProvider();
    mockConfigService = createMockConfigService();
    registry = new ProviderRegistry();
    registry.register(mockProvider);
    registry.setActiveProvider('claude-code');

    service = new ToolManagerService(mockConfigService, registry);
  });

  // -----------------------------------------------------------------------
  // toggleTool
  // -----------------------------------------------------------------------

  describe('toggleTool', () => {
    it('returns error result for managed tool', async () => {
      const tool = makeTool({ scope: ConfigScope.Managed });
      const result = await service.toggleTool(tool);
      expect(result).toEqual({ success: false, error: 'Cannot modify managed tools' });
    });

    it('delegates to provider.toggleTool for MCP server', async () => {
      const tool = makeMcpTool();

      const result = await service.toggleTool(tool);

      expect(result).toEqual({ success: true });
      expect(mockProvider.toggleTool).toHaveBeenCalledWith(tool);
    });

    it('delegates to provider.toggleTool for hook', async () => {
      const tool = makeHookTool();

      const result = await service.toggleTool(tool);

      expect(result).toEqual({ success: true });
      expect(mockProvider.toggleTool).toHaveBeenCalledWith(tool);
    });

    it('delegates to provider.toggleTool for skill', async () => {
      const tool = makeTool();

      const result = await service.toggleTool(tool);

      expect(result).toEqual({ success: true });
      expect(mockProvider.toggleTool).toHaveBeenCalledWith(tool);
    });

    it('delegates to provider.toggleTool for command', async () => {
      const tool = makeCommandTool();

      const result = await service.toggleTool(tool);

      expect(result).toEqual({ success: true });
      expect(mockProvider.toggleTool).toHaveBeenCalledWith(tool);
    });

    it('rejects toggle when the active provider excludes the tool type', async () => {
      const restrictedProvider: AgentProvider = {
        ...createMockProvider(),
        id: 'restricted',
        displayName: 'Restricted',
        toggleableToolTypes: new Set([ToolType.Skill]),
      };
      registry.register(restrictedProvider);
      registry.setActiveProvider('restricted');
      service = new ToolManagerService(mockConfigService, registry);

      const result = await service.toggleTool(makeMcpTool());

      expect(result).toEqual({
        success: false,
        error: 'Restricted cannot toggle mcp_server tools',
      });
      expect(restrictedProvider.toggleTool).not.toHaveBeenCalled();
    });

    it('catches provider error and returns failure result', async () => {
      (mockProvider.toggleTool as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('File write failed'),
      );

      const tool = makeMcpTool();
      const result = await service.toggleTool(tool);

      expect(result).toEqual({ success: false, error: 'File write failed' });
    });
  });

  // -----------------------------------------------------------------------
  // deleteTool
  // -----------------------------------------------------------------------

  describe('deleteTool', () => {
    it('returns error result for managed tool', async () => {
      const tool = makeTool({ scope: ConfigScope.Managed });
      const result = await service.deleteTool(tool);
      expect(result).toEqual({ success: false, error: 'Cannot modify managed tools' });
    });

    it('calls provider.removeTool with the tool', async () => {
      const tool = makeTool();
      const result = await service.deleteTool(tool);

      expect(result).toEqual({ success: true });
      expect(mockProvider.removeTool).toHaveBeenCalledWith(tool);
    });

    it('catches provider error and returns failure result', async () => {
      (mockProvider.removeTool as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Permission denied'),
      );

      const tool = makeTool();
      const result = await service.deleteTool(tool);

      expect(result).toEqual({ success: false, error: 'Permission denied' });
    });
  });

  // -----------------------------------------------------------------------
  // moveTool
  // -----------------------------------------------------------------------

  describe('moveTool', () => {
    it('returns error for managed source', async () => {
      const tool = makeTool({ scope: ConfigScope.Managed });
      const result = await service.moveTool(tool, ConfigScope.User);
      expect(result).toEqual({ success: false, error: 'Cannot modify managed tools' });
    });

    it('returns error for move to managed target', async () => {
      const tool = makeTool({ scope: ConfigScope.User });
      const result = await service.moveTool(tool, ConfigScope.Managed);
      expect(result).toEqual({
        success: false,
        error: 'Cannot move to managed scope (read-only)',
      });
    });

    it('returns error for move to same scope', async () => {
      const tool = makeTool({ scope: ConfigScope.User });
      const result = await service.moveTool(tool, ConfigScope.User);
      expect(result).toEqual({
        success: false,
        error: 'Tool is already in the target scope',
      });
    });

    it('calls writeTool then removeTool in order', async () => {
      const tool = makeTool({ scope: ConfigScope.User });
      const result = await service.moveTool(tool, ConfigScope.Project);

      expect(result).toEqual({ success: true });
      expect(mockProvider.writeTool).toHaveBeenCalledWith(tool, ConfigScope.Project);
      expect(mockProvider.removeTool).toHaveBeenCalledWith(tool);

      // Verify order: writeTool was called before removeTool
      const writeCall = (mockProvider.writeTool as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0];
      const removeCall = (mockProvider.removeTool as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0];
      expect(writeCall).toBeLessThan(removeCall);
    });

    it('rejects move when the active provider excludes the tool type', async () => {
      const restrictedProvider: AgentProvider = {
        ...createMockProvider(),
        id: 'restricted',
        displayName: 'Restricted',
        movableToolTypes: new Set([ToolType.Skill]),
      };
      registry.register(restrictedProvider);
      registry.setActiveProvider('restricted');
      service = new ToolManagerService(mockConfigService, registry);

      const result = await service.moveTool(makeMcpTool(), ConfigScope.Project);

      expect(result).toEqual({
        success: false,
        error: 'Restricted cannot move mcp_server tools',
      });
      expect(restrictedProvider.writeTool).not.toHaveBeenCalled();
      expect(restrictedProvider.removeTool).not.toHaveBeenCalled();
    });

    it('permits moves when the active provider does not declare move capabilities', async () => {
      const tool = makeMcpTool({ scope: ConfigScope.User });

      const result = await service.moveTool(tool, ConfigScope.Project);

      expect(result).toEqual({ success: true });
      expect(mockProvider.writeTool).toHaveBeenCalledWith(tool, ConfigScope.Project);
    });

    it('does NOT call removeTool if writeTool fails', async () => {
      (mockProvider.writeTool as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Write failed'),
      );

      const tool = makeTool({ scope: ConfigScope.User });
      const result = await service.moveTool(tool, ConfigScope.Project);

      expect(result).toEqual({ success: false, error: 'Write failed' });
      expect(mockProvider.writeTool).toHaveBeenCalledWith(tool, ConfigScope.Project);
      expect(mockProvider.removeTool).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // checkConflict
  // -----------------------------------------------------------------------

  describe('checkConflict', () => {
    it('returns true when tool with same name exists at target scope', async () => {
      const existingTool = makeTool({
        name: 'test-tool',
        scope: ConfigScope.Project,
      });
      (mockConfigService.readToolsByScope as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        existingTool,
      ]);

      const tool = makeTool({ scope: ConfigScope.User });
      const conflict = await service.checkConflict(tool, ConfigScope.Project);

      expect(conflict).toBe(true);
      expect(mockConfigService.readToolsByScope).toHaveBeenCalledWith(
        ToolType.Skill,
        ConfigScope.Project,
      );
    });

    it('returns false when no matching tool exists at target scope', async () => {
      const differentTool = makeTool({
        name: 'other-tool',
        scope: ConfigScope.Project,
      });
      (mockConfigService.readToolsByScope as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        differentTool,
      ]);

      const tool = makeTool({ scope: ConfigScope.User });
      const conflict = await service.checkConflict(tool, ConfigScope.Project);

      expect(conflict).toBe(false);
    });

    it('returns false when target scope is empty', async () => {
      (mockConfigService.readToolsByScope as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const tool = makeTool({ scope: ConfigScope.User });
      const conflict = await service.checkConflict(tool, ConfigScope.Project);

      expect(conflict).toBe(false);
    });

    it('returns false when readToolsByScope throws', async () => {
      (mockConfigService.readToolsByScope as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Read failed'),
      );

      const tool = makeTool({ scope: ConfigScope.User });
      const conflict = await service.checkConflict(tool, ConfigScope.Project);

      expect(conflict).toBe(false);
    });
  });
});
