import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { ToolType, ConfigScope, ToolStatus } from '../../types/enums.js';
import type { NormalizedTool } from '../../types/config.js';
import type { RegistrySource } from '../../services/registry.types.js';
import type { ConfigService } from '../../services/config.service.js';
import type { RegistryService } from '../../services/registry.service.js';
import type { FileIOService } from '../../services/fileio.service.js';
import type { IPlatformAdapter } from '../../types/adapter.js';
import { AdapterRegistry } from '../../adapters/adapter.registry.js';
import { InstallService } from '../../services/install.service.js';
import type {
  ToolManifest,
  InstallRequest,
} from '../../services/install.types.js';

// Mock child_process.execFile for runtime checks
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SOURCE: RegistrySource = {
  id: 'community',
  name: 'Community Registry',
  owner: 'ack',
  repo: 'tool-registry',
  branch: 'main',
  indexPath: 'registry.json',
};

function makeMcpManifest(overrides: Partial<ToolManifest> = {}): ToolManifest {
  return {
    type: 'mcp_server',
    name: 'github-mcp-server',
    version: '1.0.0',
    description: 'GitHub MCP server',
    runtime: 'node',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: {
          required: true,
          sensitive: true,
          description: 'GitHub Personal Access Token',
        },
      },
    },
    ...overrides,
  };
}

function makeSkillManifest(overrides: Partial<ToolManifest> = {}): ToolManifest {
  return {
    type: 'skill',
    name: 'memory-skill',
    version: '1.0.0',
    description: 'Memory skill',
    files: ['SKILL.md'],
    config: {},
    ...overrides,
  };
}

function makeCommandManifest(overrides: Partial<ToolManifest> = {}): ToolManifest {
  return {
    type: 'command',
    name: 'review',
    version: '1.0.0',
    description: 'Code review command',
    files: ['review.md'],
    config: {},
    ...overrides,
  };
}

function makeHookManifest(overrides: Partial<ToolManifest> = {}): ToolManifest {
  return {
    type: 'hook',
    name: 'lint-on-save',
    version: '1.0.0',
    description: 'Run linter on save',
    config: {
      event: 'PreToolUse',
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'eslint .' }],
    },
    ...overrides,
  };
}

function makeCustomPromptManifest(overrides: Partial<ToolManifest> = {}): ToolManifest {
  return {
    type: 'custom_prompt',
    name: 'summarize',
    version: '1.0.0',
    description: 'Summarize selected text',
    files: ['summarize.md'],
    config: {},
    ...overrides,
  };
}

function createMockRegistryService(): RegistryService {
  return {
    fetchToolManifest: vi.fn().mockResolvedValue(makeMcpManifest()),
    fetchToolFile: vi.fn().mockResolvedValue('# Skill Content'),
    fetchReadme: vi.fn().mockResolvedValue('# README'),
    fetchIndex: vi.fn().mockResolvedValue({ version: 1, tools: [] }),
    fetchAllIndexes: vi.fn().mockResolvedValue(new Map()),
    getSources: vi.fn().mockReturnValue([]),
    clearCache: vi.fn(),
  } as unknown as RegistryService;
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

function createMockFileIOService(): FileIOService {
  return {
    readJsonFile: vi.fn().mockResolvedValue({ success: true, data: {} }),
    writeJsonFile: vi.fn().mockResolvedValue(undefined),
    readTextFile: vi.fn().mockResolvedValue(null),
    writeTextFile: vi.fn().mockResolvedValue(undefined),
    fileExists: vi.fn().mockResolvedValue(false),
    listDirectories: vi.fn().mockResolvedValue([]),
  } as unknown as FileIOService;
}

type MockAdapterOverrides = Partial<IPlatformAdapter> & {
  installInstruction?: (
    scope: ConfigScope,
    filename: string,
    content: string,
  ) => Promise<void>;
};

function createMockAdapter(overrides: MockAdapterOverrides = {}): IPlatformAdapter {
  return {
    id: 'claude-code',
    displayName: 'Claude Code',
    supportedToolTypes: new Set([ToolType.Skill, ToolType.McpServer, ToolType.Hook, ToolType.Command]),
    readTools: vi.fn().mockResolvedValue([]),
    writeTool: vi.fn().mockResolvedValue(undefined),
    removeTool: vi.fn().mockResolvedValue(undefined),
    toggleTool: vi.fn().mockResolvedValue(undefined),
    installMcpServer: vi.fn().mockResolvedValue(undefined),
    installSkill: vi.fn().mockResolvedValue(undefined),
    installCommand: vi.fn().mockResolvedValue(undefined),
    installHook: vi.fn().mockResolvedValue(undefined),
    getSkillsDir: vi.fn().mockReturnValue('/home/user/.claude/skills'),
    getCommandsDir: vi.fn().mockReturnValue('/home/user/.claude/commands'),
    getSettingsPath: vi.fn().mockReturnValue('/home/user/.claude/settings.json'),
    getMcpFilePath: vi.fn().mockReturnValue('/home/user/.claude.json'),
    getMcpSchemaKey: vi.fn().mockReturnValue('claude-json'),
    getWatchPaths: vi.fn().mockReturnValue([]),
    detect: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as IPlatformAdapter;
}

function makeInstallRequest(
  manifest: ToolManifest,
  overrides: Partial<InstallRequest> = {},
): InstallRequest {
  return {
    manifest,
    scope: ConfigScope.User,
    source: TEST_SOURCE,
    contentPath: `tools/${manifest.name}`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InstallService', () => {
  let service: InstallService;
  let mockRegistryService: RegistryService;
  let mockConfigService: ConfigService;
  let mockFileIOService: FileIOService;
  let registry: AdapterRegistry;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRegistryService = createMockRegistryService();
    mockConfigService = createMockConfigService();
    mockFileIOService = createMockFileIOService();

    const mockAdapter = createMockAdapter();
    registry = new AdapterRegistry();
    registry.register(mockAdapter);
    registry.setActiveAdapter('claude-code');

    service = new InstallService(
      mockRegistryService,
      mockConfigService,
      registry,
      mockFileIOService,
      '/workspace',
    );
  });

  function activateAdapter(adapter: IPlatformAdapter): void {
    registry = new AdapterRegistry();
    registry.register(adapter);
    registry.setActiveAdapter(adapter.id);

    service = new InstallService(
      mockRegistryService,
      mockConfigService,
      registry,
      mockFileIOService,
      '/workspace',
    );
  }

  // -------------------------------------------------------------------------
  // install() routing
  // -------------------------------------------------------------------------

  describe('install() routing', () => {
    it('routes mcp_server to installMcpServer', async () => {
      const manifest = makeMcpManifest();
      const request = makeInstallRequest(manifest, {
        configValues: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_test123' },
      });

      const result = await service.install(request);

      expect(result.success).toBe(true);
      expect(result.toolName).toBe('github-mcp-server');

      const adapter = registry.getActiveAdapter()!;
      expect(adapter.installMcpServer).toHaveBeenCalledOnce();
    });

    it('routes skill to installSkill', async () => {
      const manifest = makeSkillManifest();
      const request = makeInstallRequest(manifest);

      const result = await service.install(request);

      expect(result.success).toBe(true);
      expect(result.toolName).toBe('memory-skill');
      expect(mockRegistryService.fetchToolFile).toHaveBeenCalled();

      const adapter = registry.getActiveAdapter()!;
      expect(adapter.installSkill).toHaveBeenCalledOnce();
    });

    it('routes command to installCommand', async () => {
      const manifest = makeCommandManifest();
      const request = makeInstallRequest(manifest);

      const result = await service.install(request);

      expect(result.success).toBe(true);
      expect(result.toolName).toBe('review');
      expect(mockRegistryService.fetchToolFile).toHaveBeenCalled();
    });

    it('routes hook to installHook', async () => {
      const manifest = makeHookManifest();
      const request = makeInstallRequest(manifest);

      const result = await service.install(request);

      expect(result.success).toBe(true);
      expect(result.toolName).toBe('lint-on-save');

      const adapter = registry.getActiveAdapter()!;
      expect(adapter.installHook).toHaveBeenCalledOnce();
    });

    it('returns error for unknown tool type', async () => {
      const manifest = makeMcpManifest({ type: 'unknown' as ToolManifest['type'] });
      const request = makeInstallRequest(manifest);

      const result = await service.install(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported tool type');
    });

    it('catches and wraps exceptions as failure result', async () => {
      (mockRegistryService.fetchToolFile as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Network timeout'));

      const manifest = makeSkillManifest();
      const request = makeInstallRequest(manifest);

      const result = await service.install(request);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network timeout');
      expect(result.toolName).toBe('memory-skill');
    });
  });

  // -------------------------------------------------------------------------
  // installMcpServer
  // -------------------------------------------------------------------------

  describe('installMcpServer', () => {
    it('builds correct server config from manifest + configValues', async () => {
      const manifest = makeMcpManifest();
      const request = makeInstallRequest(manifest, {
        scope: ConfigScope.User,
        configValues: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_mytoken' },
      });

      await service.install(request);

      const adapter = registry.getActiveAdapter()!;
      expect(adapter.installMcpServer).toHaveBeenCalledWith(
        ConfigScope.User,
        'github-mcp-server',
        {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_mytoken' },
        },
      );
    });

    it('uses project scope for project installs', async () => {
      const manifest = makeMcpManifest();
      const request = makeInstallRequest(manifest, {
        scope: ConfigScope.Project,
        configValues: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_proj' },
      });

      await service.install(request);

      const adapter = registry.getActiveAdapter()!;
      expect(adapter.installMcpServer).toHaveBeenCalledWith(
        ConfigScope.Project,
        'github-mcp-server',
        expect.any(Object),
      );
    });

    it('preserves existing env values on update', async () => {
      const manifest = makeMcpManifest({
        config: {
          command: 'npx',
          args: ['-y', 'server'],
          env: {
            API_KEY: { required: true, sensitive: true },
            EXTRA_VAR: { required: false, sensitive: false, defaultValue: 'default' },
          },
        },
      });

      const request = makeInstallRequest(manifest, {
        configValues: { API_KEY: 'new-key' },
        existingEnvValues: { EXTRA_VAR: 'user-custom' },
      });

      await service.install(request);

      const adapter = registry.getActiveAdapter()!;
      const calledWith = (adapter.installMcpServer as ReturnType<typeof vi.fn>).mock.calls[0][2];
      expect(calledWith.env.API_KEY).toBe('new-key');
      expect(calledWith.env.EXTRA_VAR).toBe('user-custom');
    });

    it('falls back to manifest defaults when no values provided', async () => {
      const manifest = makeMcpManifest({
        config: {
          command: 'cmd',
          env: {
            MY_VAR: { required: false, sensitive: false, defaultValue: 'fallback' },
          },
        },
      });

      const request = makeInstallRequest(manifest);

      await service.install(request);

      const adapter = registry.getActiveAdapter()!;
      const calledWith = (adapter.installMcpServer as ReturnType<typeof vi.fn>).mock.calls[0][2];
      expect(calledWith.env.MY_VAR).toBe('fallback');
    });
  });

  // -------------------------------------------------------------------------
  // installSkill
  // -------------------------------------------------------------------------

  describe('installSkill', () => {
    it('fetches files and delegates to adapter.installSkill', async () => {
      const manifest = makeSkillManifest();
      const request = makeInstallRequest(manifest, {
        contentPath: 'tools/memory-skill',
      });

      await service.install(request);

      expect(mockRegistryService.fetchToolFile).toHaveBeenCalledWith(
        TEST_SOURCE,
        'tools/memory-skill/SKILL.md',
      );

      const adapter = registry.getActiveAdapter()!;
      expect(adapter.installSkill).toHaveBeenCalledWith(
        ConfigScope.User,
        'memory-skill',
        [{ name: 'SKILL.md', content: '# Skill Content' }],
      );
    });

    it('defaults to SKILL.md when files not specified', async () => {
      const manifest = makeSkillManifest({ files: undefined });
      const request = makeInstallRequest(manifest, {
        contentPath: 'tools/memory-skill',
      });

      await service.install(request);

      expect(mockRegistryService.fetchToolFile).toHaveBeenCalledWith(
        TEST_SOURCE,
        'tools/memory-skill/SKILL.md',
      );
    });

    it('fetches multiple files when manifest lists them', async () => {
      const manifest = makeSkillManifest({
        files: ['SKILL.md', 'template.md'],
      });
      const request = makeInstallRequest(manifest, {
        contentPath: 'tools/memory-skill',
      });

      await service.install(request);

      expect(mockRegistryService.fetchToolFile).toHaveBeenCalledTimes(2);

      const adapter = registry.getActiveAdapter()!;
      expect(adapter.installSkill).toHaveBeenCalledWith(
        ConfigScope.User,
        'memory-skill',
        [
          { name: 'SKILL.md', content: '# Skill Content' },
          { name: 'template.md', content: '# Skill Content' },
        ],
      );
    });
  });

  // -------------------------------------------------------------------------
  // installCommand
  // -------------------------------------------------------------------------

  describe('installCommand', () => {
    it('delegates single-file command to adapter.installCommand', async () => {
      const manifest = makeCommandManifest();
      const request = makeInstallRequest(manifest, {
        contentPath: 'tools/review',
      });

      await service.install(request);

      expect(mockRegistryService.fetchToolFile).toHaveBeenCalledWith(
        TEST_SOURCE,
        'tools/review/review.md',
      );

      const adapter = registry.getActiveAdapter()!;
      expect(adapter.installCommand).toHaveBeenCalledWith(
        ConfigScope.User,
        'review',
        [{ name: 'review.md', content: '# Skill Content' }],
      );
    });

    it('delegates multi-file command to adapter.installCommand', async () => {
      const manifest = makeCommandManifest({
        files: ['review.md', 'helpers.md'],
      });
      const request = makeInstallRequest(manifest, {
        contentPath: 'tools/review',
      });

      await service.install(request);

      expect(mockRegistryService.fetchToolFile).toHaveBeenCalledTimes(2);

      const adapter = registry.getActiveAdapter()!;
      expect(adapter.installCommand).toHaveBeenCalledWith(
        ConfigScope.User,
        'review',
        [
          { name: 'review.md', content: '# Skill Content' },
          { name: 'helpers.md', content: '# Skill Content' },
        ],
      );
    });
  });

  // -------------------------------------------------------------------------
  // installHook
  // -------------------------------------------------------------------------

  describe('installHook', () => {
    it('builds matcher group and calls adapter.installHook', async () => {
      const manifest = makeHookManifest();
      const request = makeInstallRequest(manifest);

      await service.install(request);

      const adapter = registry.getActiveAdapter()!;
      expect(adapter.installHook).toHaveBeenCalledWith(
        ConfigScope.User,
        'PreToolUse',
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'eslint .' }],
        },
      );
    });

    it('throws if manifest missing config.event', async () => {
      const manifest = makeHookManifest({
        config: { matcher: 'Bash', hooks: [] },
      });
      const request = makeInstallRequest(manifest);

      const result = await service.install(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('config.event');
    });
  });

  // -------------------------------------------------------------------------
  // installCustomPrompt
  // -------------------------------------------------------------------------

  describe('installCustomPrompt', () => {
    it('installs already-fetched Copilot-named prompt content using the Codex tool name', async () => {
      const codexAdapter = createMockAdapter({
        id: 'codex',
        displayName: 'Codex',
        supportedToolTypes: new Set([ToolType.CustomPrompt]),
      });
      activateAdapter(codexAdapter);

      const result = await service.installCustomPromptContent(
        makeCustomPromptManifest({ name: 'review', files: ['review.prompt.md'] }),
        '# From repo\n',
        ConfigScope.Project,
      );

      expect(result).toEqual({
        success: true,
        toolName: 'review',
        scope: ConfigScope.User,
      });
      expect(mockFileIOService.writeTextFile).toHaveBeenCalledWith(
        path.join(os.homedir(), '.codex', 'prompts', 'review.md'),
        '# From repo\n',
      );
      expect(mockRegistryService.fetchToolFile).not.toHaveBeenCalled();
    });

    it('refuses to overwrite an existing Codex prompt without confirmation', async () => {
      const codexAdapter = createMockAdapter({
        id: 'codex',
        displayName: 'Codex',
        supportedToolTypes: new Set([ToolType.CustomPrompt]),
      });
      activateAdapter(codexAdapter);
      (mockConfigService.readToolsByScope as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        {
          id: 'prompt:codex:user:summarize',
          name: 'summarize',
          type: ToolType.CustomPrompt,
          scope: ConfigScope.User,
          status: ToolStatus.Enabled,
          source: { filePath: '/home/user/.codex/prompts/summarize.md' },
          metadata: {},
        },
      ]);

      const result = await service.installCustomPromptContent(
        makeCustomPromptManifest(),
        '# Replacement\n',
        ConfigScope.Project,
      );

      expect(result).toEqual({
        success: false,
        error: '"summarize" already exists at user scope',
        toolName: 'summarize',
        scope: ConfigScope.User,
      });
      expect(mockFileIOService.writeTextFile).not.toHaveBeenCalled();
    });

    it('overwrites an existing Codex prompt after confirmation', async () => {
      const codexAdapter = createMockAdapter({
        id: 'codex',
        displayName: 'Codex',
        supportedToolTypes: new Set([ToolType.CustomPrompt]),
      });
      activateAdapter(codexAdapter);

      const result = await service.installCustomPromptContent(
        makeCustomPromptManifest(),
        '# Replacement\n',
        ConfigScope.Project,
        true,
      );

      expect(result).toEqual({
        success: true,
        toolName: 'summarize',
        scope: ConfigScope.User,
      });
      expect(mockFileIOService.writeTextFile).toHaveBeenCalledWith(
        path.join(os.homedir(), '.codex', 'prompts', 'summarize.md'),
        '# Replacement\n',
      );
    });

    it('installs already-fetched Copilot prompt content at project scope', async () => {
      const installInstruction = vi.fn().mockResolvedValue(undefined);
      const copilotAdapter = createMockAdapter({
        id: 'copilot',
        displayName: 'GitHub Copilot',
        supportedToolTypes: new Set([ToolType.CustomPrompt]),
        installInstruction,
      });
      activateAdapter(copilotAdapter);

      const result = await service.installCustomPromptContent(
        makeCustomPromptManifest({ files: ['review.prompt.md'], name: 'review' }),
        '# From repo\n',
        ConfigScope.Project,
      );

      expect(result).toEqual({
        success: true,
        toolName: 'review',
        scope: ConfigScope.Project,
      });
      expect(installInstruction).toHaveBeenCalledWith(
        ConfigScope.Project,
        'review.prompt.md',
        '# From repo\n',
      );
      expect(mockRegistryService.fetchToolFile).not.toHaveBeenCalled();
    });

    it('rejects Copilot prompt content whose manifest name differs from its installed identity', async () => {
      const installInstruction = vi.fn().mockResolvedValue(undefined);
      const copilotAdapter = createMockAdapter({
        id: 'copilot',
        displayName: 'GitHub Copilot',
        supportedToolTypes: new Set([ToolType.CustomPrompt]),
        installInstruction,
      });
      activateAdapter(copilotAdapter);
      (mockConfigService.readToolsByScope as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        {
          id: 'instruction:project:copilot-instructions',
          name: 'copilot-instructions',
          type: ToolType.CustomPrompt,
          scope: ConfigScope.Project,
          status: ToolStatus.Enabled,
          source: { filePath: '/workspace/.github/copilot-instructions.md' },
          metadata: {},
        },
      ]);

      const result = await service.installCustomPromptContent(
        makeCustomPromptManifest({
          name: 'new-helper',
          files: ['copilot-instructions.md'],
        }),
        '# Replacement\n',
        ConfigScope.Project,
      );

      expect(result).toEqual({
        success: false,
        error: 'custom_prompt name "new-helper" does not match installed name "copilot-instructions" for GitHub Copilot',
        toolName: 'new-helper',
        scope: ConfigScope.Project,
      });
      expect(installInstruction).not.toHaveBeenCalled();
    });

    it('exposes Copilot prompt identity validation before installation', () => {
      const copilotAdapter = createMockAdapter({
        id: 'copilot',
        displayName: 'GitHub Copilot',
        supportedToolTypes: new Set([ToolType.CustomPrompt]),
        installInstruction: vi.fn().mockResolvedValue(undefined),
      });
      activateAdapter(copilotAdapter);

      const error = service.getCustomPromptValidationError(
        makeCustomPromptManifest({
          name: 'new-helper',
          files: ['copilot-instructions.md'],
        }),
        ConfigScope.Project,
      );

      expect(error).toBe(
        'custom_prompt name "new-helper" does not match installed name "copilot-instructions" for GitHub Copilot',
      );
    });

    it('rejects Codex prompt names with an extension that differs from its installed identity', async () => {
      const codexAdapter = createMockAdapter({
        id: 'codex',
        displayName: 'Codex',
        supportedToolTypes: new Set([ToolType.CustomPrompt]),
      });
      activateAdapter(codexAdapter);
      (mockConfigService.readToolsByScope as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        {
          id: 'prompt:codex:user:review',
          name: 'review',
          type: ToolType.CustomPrompt,
          scope: ConfigScope.User,
          status: ToolStatus.Enabled,
          source: { filePath: '/home/user/.codex/prompts/review.md' },
          metadata: {},
        },
      ]);

      const result = await service.installCustomPromptContent(
        makeCustomPromptManifest({
          name: 'review.md',
          files: ['review.md'],
        }),
        '# Replacement\n',
        ConfigScope.Project,
      );

      expect(result).toEqual({
        success: false,
        error: 'custom_prompt name "review.md" does not match installed name "review" for Codex',
        toolName: 'review.md',
        scope: ConfigScope.User,
      });
      expect(mockFileIOService.writeTextFile).not.toHaveBeenCalled();
    });

    it('installs Codex custom prompts into the user prompts directory', async () => {
      const codexAdapter = createMockAdapter({
        id: 'codex',
        displayName: 'Codex',
        supportedToolTypes: new Set([ToolType.CustomPrompt]),
      });
      activateAdapter(codexAdapter);
      (mockRegistryService.fetchToolFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('# Summarize\n');

      const manifest = makeCustomPromptManifest();
      const request = makeInstallRequest(manifest, {
        contentPath: 'prompts/summarize',
      });

      const result = await service.install(request);

      expect(result).toEqual({
        success: true,
        toolName: 'summarize',
        scope: ConfigScope.User,
      });
      expect(mockRegistryService.fetchToolFile).toHaveBeenCalledWith(
        TEST_SOURCE,
        'prompts/summarize/summarize.md',
      );
      expect(mockFileIOService.writeTextFile).toHaveBeenCalledWith(
        path.join(os.homedir(), '.codex', 'prompts', 'summarize.md'),
        '# Summarize\n',
      );
    });

    it('preserves Copilot custom prompt installs through installInstruction', async () => {
      const installInstruction = vi.fn().mockResolvedValue(undefined);
      const copilotAdapter = createMockAdapter({
        id: 'copilot',
        displayName: 'GitHub Copilot',
        supportedToolTypes: new Set([ToolType.CustomPrompt]),
        installInstruction,
      });
      activateAdapter(copilotAdapter);
      (mockRegistryService.fetchToolFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('# Review\n');

      const manifest = makeCustomPromptManifest({
        name: 'review',
        files: ['review.prompt.md'],
      });
      const request = makeInstallRequest(manifest, {
        contentPath: 'prompts/review',
      });

      const result = await service.install(request);

      expect(result).toEqual({
        success: true,
        toolName: 'review',
        scope: ConfigScope.Project,
      });
      expect(mockRegistryService.fetchToolFile).toHaveBeenCalledWith(
        TEST_SOURCE,
        'prompts/review/review.prompt.md',
      );
      expect(installInstruction).toHaveBeenCalledWith(
        ConfigScope.Project,
        'review.prompt.md',
        '# Review\n',
      );
      expect(mockFileIOService.writeTextFile).not.toHaveBeenCalled();
    });

    it('returns a clear failure for adapters without custom prompt install support', async () => {
      const manifest = makeCustomPromptManifest();
      const request = makeInstallRequest(manifest);

      const result = await service.install(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('custom_prompt install is not supported');
      expect(result.toolName).toBe('summarize');
      expect(mockRegistryService.fetchToolFile).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // checkRuntime
  // -------------------------------------------------------------------------

  describe('checkRuntime', () => {
    it('returns available true with version on success', async () => {
      const { execFile } = await import('child_process');
      (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          cb(null, { stdout: 'v20.11.0\n', stderr: '' });
        },
      );

      const result = await service.checkRuntime('node');

      expect(result.available).toBe(true);
      expect(result.version).toBe('v20.11.0');
    });

    it('returns available false with error on failure', async () => {
      const { execFile } = await import('child_process');
      (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          cb(new Error('ENOENT'));
        },
      );

      const result = await service.checkRuntime('uvx');

      expect(result.available).toBe(false);
      expect(result.error).toContain('uvx');
      expect(result.error).toContain('not found');
    });

    it('maps python to python3 command', async () => {
      const { execFile } = await import('child_process');
      (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          cb(null, { stdout: 'Python 3.12.0\n', stderr: '' });
          // Verify the command was mapped
          expect(cmd).toBe('python3');
        },
      );

      const result = await service.checkRuntime('python');

      expect(result.available).toBe(true);
    });

    it('uses runtime string directly for unknown runtimes', async () => {
      const { execFile } = await import('child_process');
      (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          cb(null, { stdout: '1.0.0\n', stderr: '' });
          expect(cmd).toBe('custom-runtime');
        },
      );

      const result = await service.checkRuntime('custom-runtime');

      expect(result.available).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // checkConflict
  // -------------------------------------------------------------------------

  describe('checkConflict', () => {
    it('returns true when tool exists at scope', async () => {
      const existingTool: NormalizedTool = {
        id: 'skill:memory-skill',
        type: ToolType.Skill,
        name: 'memory-skill',
        scope: ConfigScope.User,
        status: ToolStatus.Enabled,
        source: { filePath: '/home/.claude/skills/memory-skill/SKILL.md' },
        metadata: {},
      };
      (mockConfigService.readToolsByScope as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([existingTool]);

      const result = await service.checkConflict('memory-skill', 'skill', ConfigScope.User);

      expect(result).toBe(true);
    });

    it('returns false when tool does not exist at scope', async () => {
      (mockConfigService.readToolsByScope as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([]);

      const result = await service.checkConflict('memory-skill', 'skill', ConfigScope.User);

      expect(result).toBe(false);
    });

    it('returns false when readToolsByScope throws', async () => {
      (mockConfigService.readToolsByScope as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Read failed'));

      const result = await service.checkConflict('memory-skill', 'skill', ConfigScope.User);

      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getExistingEnvValues
  // -------------------------------------------------------------------------

  describe('getExistingEnvValues', () => {
    it('returns env values from existing MCP server', async () => {
      const existingTool: NormalizedTool = {
        id: 'mcp_server:test-server',
        type: ToolType.McpServer,
        name: 'test-server',
        scope: ConfigScope.User,
        status: ToolStatus.Enabled,
        source: { filePath: '/home/.claude.json' },
        metadata: { command: 'node', env: { API_KEY: 'existing-key' } },
      };
      (mockConfigService.readToolsByScope as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([existingTool]);

      const result = await service.getExistingEnvValues('test-server', ConfigScope.User);

      expect(result).toEqual({ API_KEY: 'existing-key' });
    });

    it('returns empty object when server not found', async () => {
      (mockConfigService.readToolsByScope as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([]);

      const result = await service.getExistingEnvValues('test-server', ConfigScope.User);

      expect(result).toEqual({});
    });

    it('returns empty object on error', async () => {
      (mockConfigService.readToolsByScope as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Read failed'));

      const result = await service.getExistingEnvValues('test-server', ConfigScope.User);

      expect(result).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // getToolManifest
  // -------------------------------------------------------------------------

  describe('getToolManifest', () => {
    it('delegates to registryService.fetchToolManifest', async () => {
      const expectedManifest = makeMcpManifest();
      (mockRegistryService.fetchToolManifest as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(expectedManifest);

      const result = await service.getToolManifest(TEST_SOURCE, 'tools/github-mcp-server');

      expect(result).toEqual(expectedManifest);
      expect(mockRegistryService.fetchToolManifest).toHaveBeenCalledWith(
        TEST_SOURCE,
        'tools/github-mcp-server',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('wraps network failure as InstallResult', async () => {
      (mockRegistryService.fetchToolFile as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Network error fetching file'));

      const manifest = makeSkillManifest();
      const request = makeInstallRequest(manifest);

      const result = await service.install(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
      expect(result.toolName).toBe('memory-skill');
      expect(result.scope).toBe(ConfigScope.User);
    });

    it('wraps adapter failure as InstallResult', async () => {
      const adapter = registry.getActiveAdapter()!;
      (adapter.installMcpServer as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Schema validation failed'),
      );

      const manifest = makeMcpManifest();
      const request = makeInstallRequest(manifest, {
        configValues: { GITHUB_PERSONAL_ACCESS_TOKEN: 'test' },
      });

      const result = await service.install(request);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Schema validation failed');
    });

    it('wraps adapter scope error as InstallResult for project scope', async () => {
      // Simulate adapter rejecting when workspace root is missing
      const adapter = registry.getActiveAdapter()!;
      (adapter.installSkill as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Claude Code: getSkillsDir (no workspace open) is not supported for scope "project"'),
      );

      const manifest = makeSkillManifest();
      const request = makeInstallRequest(manifest, { scope: ConfigScope.Project });

      const result = await service.install(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not supported');
    });
  });
});
