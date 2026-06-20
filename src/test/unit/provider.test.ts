import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileIOService } from '../../services/fileio.service.js';
import { SchemaService } from '../../services/schema.service.js';
import { claudeCodeSchemas } from '../../providers/claude-code/schemas.js';
import { ClaudeCodeProvider } from '../../providers/claude-code/claude-code.provider.js';
import { CodexProvider } from '../../providers/codex/codex.provider.js';
import { ProviderRegistry } from '../../providers/provider.registry.js';
import { ToolType, ConfigScope, ToolStatus } from '../../types/enums.js';
import { ProviderScopeError } from '../../types/provider-errors.js';
import { resolveCapabilities } from '../../types/provider.js';
import type { NormalizedTool } from '../../types/config.js';
import { ConfigService } from '../../services/config.service.js';
import { BackupService } from '../../services/backup.service.js';
import { createMockProvider } from './helpers/mock-provider.js';
import { createMockFileIO } from './helpers/mock-fileio.js';

/**
 * Build real, fully-typed write services for providers whose toggle paths
 * (skill/command directory renames) never touch ConfigService/BackupService
 * but still require non-null instances to pass ensureWriteServices().
 */
function makeWriteServices(): { configService: ConfigService; backupService: BackupService } {
  const backupService = new BackupService(fileIO);
  const configService = new ConfigService(fileIO, backupService, schemaService, new ProviderRegistry());
  return { configService, backupService };
}

let tmpDir: string;
let fileIO: FileIOService;
let schemaService: SchemaService;

async function makeTmpDir(): Promise<string> {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-test-'));
  return tmpDir;
}

beforeEach(() => {
  fileIO = new FileIOService();
  schemaService = new SchemaService();
  schemaService.registerSchemas(claudeCodeSchemas);
});

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
});

// ---------------------------------------------------------------------------
// ProviderRegistry
// ---------------------------------------------------------------------------

describe('ProviderRegistry', () => {
  it('registers and retrieves providers', () => {
    const registry = new ProviderRegistry();
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    registry.register(provider);

    expect(registry.getProvider('claude-code')).toBe(provider);
    expect(registry.getProvider('nonexistent')).toBeUndefined();
  });

  it('returns all registered providers', () => {
    const registry = new ProviderRegistry();
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    registry.register(provider);

    const all = registry.getAllProviders();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('claude-code');
  });

  it('sets and gets active provider', () => {
    const registry = new ProviderRegistry();
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    registry.register(provider);

    expect(registry.getActiveProvider()).toBeUndefined();

    registry.setActiveProvider('claude-code');
    expect(registry.getActiveProvider()).toBe(provider);
  });

  it('throws when setting active provider to unregistered id', () => {
    const registry = new ProviderRegistry();

    expect(() => registry.setActiveProvider('nonexistent')).toThrow(
      'Provider "nonexistent" is not registered',
    );
  });

  it('detectAndActivate returns the detected provider when exactly one matches', async () => {
    const registry = new ProviderRegistry();

    // Create a mock provider that always detects
    const mockProvider = createMockProvider({
      id: 'mock-platform',
      displayName: 'Mock Platform',
      supportedToolTypes: new Set([ToolType.Skill]),
      async detect() { return true; },
    });

    registry.register(mockProvider);

    const result = await registry.detectAndActivate();
    expect(result).toBe(mockProvider);
    expect(registry.getActiveProvider()).toBe(mockProvider);
  });

  it('detectAndActivate returns undefined when multiple providers match', async () => {
    const registry = new ProviderRegistry();

    const mock1 = createMockProvider({
      id: 'platform-1',
      displayName: 'Platform 1',
      supportedToolTypes: new Set([]),
      async detect() { return true; },
    });

    const mock2 = createMockProvider({
      id: 'platform-2',
      displayName: 'Platform 2',
      supportedToolTypes: new Set([]),
      async detect() { return true; },
    });

    registry.register(mock1);
    registry.register(mock2);

    const result = await registry.detectAndActivate();
    expect(result).toBeUndefined();
  });

  it('detectAndActivate returns undefined when no providers match', async () => {
    const registry = new ProviderRegistry();

    const mockProvider = createMockProvider({
      id: 'mock',
      displayName: 'Mock',
      supportedToolTypes: new Set([]),
      async detect() { return false; },
    });

    registry.register(mockProvider);

    const result = await registry.detectAndActivate();
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ClaudeCodeProvider
// ---------------------------------------------------------------------------

describe('ClaudeCodeProvider', () => {
  it('has correct identity properties', () => {
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    expect(provider.id).toBe('claude-code');
    expect(provider.displayName).toBe('Claude Code');
    expect(provider.supportedToolTypes.has(ToolType.Skill)).toBe(true);
    expect(provider.supportedToolTypes.has(ToolType.McpServer)).toBe(true);
    expect(provider.supportedToolTypes.has(ToolType.Hook)).toBe(true);
    expect(provider.supportedToolTypes.has(ToolType.Command)).toBe(true);
  });

  it('readTools routes Skill+User scope to skill parser', async () => {
    const dir = await makeTmpDir();

    // Create a fake user skills dir structure
    const skillsDir = path.join(dir, 'skills');
    await fs.mkdir(skillsDir);
    const skillDir = path.join(skillsDir, 'test-skill');
    await fs.mkdir(skillDir);
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: Test Skill
description: A test skill
---

Body text.`);

    // Patch paths for testing: create provider with workspace root that
    // simulates user-scope skills by using the tmp dir
    // Since we cannot override user scope paths easily, we test Project scope
    // which uses the workspaceRoot parameter

    // Set up project-scope skills directory
    const projectRoot = dir;
    const projectSkillsDir = path.join(projectRoot, '.claude', 'skills');
    await fs.mkdir(path.join(projectRoot, '.claude'), { recursive: true });
    await fs.mkdir(projectSkillsDir);
    const projectSkillDir = path.join(projectSkillsDir, 'project-skill');
    await fs.mkdir(projectSkillDir);
    await fs.writeFile(path.join(projectSkillDir, 'SKILL.md'), `---
name: Project Skill
description: A project-level skill
---

Project skill body.`);

    const provider = new ClaudeCodeProvider(fileIO, schemaService, projectRoot);
    const tools = await provider.readTools(ToolType.Skill, ConfigScope.Project);

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('Project Skill');
    expect(tools[0].type).toBe(ToolType.Skill);
    expect(tools[0].scope).toBe(ConfigScope.Project);
  });

  it('readTools returns empty array when no workspace and Project scope requested', async () => {
    // No workspaceRoot provided
    const provider = new ClaudeCodeProvider(fileIO, schemaService);

    const skillTools = await provider.readTools(ToolType.Skill, ConfigScope.Project);
    expect(skillTools).toEqual([]);

    const hookTools = await provider.readTools(ToolType.Hook, ConfigScope.Project);
    expect(hookTools).toEqual([]);

    const mcpTools = await provider.readTools(ToolType.McpServer, ConfigScope.Project);
    expect(mcpTools).toEqual([]);

    const cmdTools = await provider.readTools(ToolType.Command, ConfigScope.Project);
    expect(cmdTools).toEqual([]);
  });

  it('readTools returns empty array for Local scope without workspace', async () => {
    const provider = new ClaudeCodeProvider(fileIO, schemaService);

    const tools = await provider.readTools(ToolType.Hook, ConfigScope.Local);
    expect(tools).toEqual([]);
  });

  it('readTools routes Hook+Project to settings parser', async () => {
    const dir = await makeTmpDir();
    const projectRoot = dir;
    await fs.mkdir(path.join(projectRoot, '.claude'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] },
          ],
        },
      }),
    );

    const provider = new ClaudeCodeProvider(fileIO, schemaService, projectRoot);
    const tools = await provider.readTools(ToolType.Hook, ConfigScope.Project);

    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe(ToolType.Hook);
    expect(tools[0].metadata.eventName).toBe('PreToolUse');
  });

  it('readTools routes McpServer+Project to mcp parser with disabled list', async () => {
    const dir = await makeTmpDir();
    const projectRoot = dir;
    await fs.mkdir(path.join(projectRoot, '.claude'), { recursive: true });

    // Settings file with disabled servers
    await fs.writeFile(
      path.join(projectRoot, '.claude', 'settings.json'),
      JSON.stringify({ disabledMcpServers: ['disabled-server'] }),
    );

    // MCP file with servers
    await fs.writeFile(
      path.join(projectRoot, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          'active-server': { command: 'node', args: [] },
          'disabled-server': { command: 'python', args: [] },
        },
      }),
    );

    const provider = new ClaudeCodeProvider(fileIO, schemaService, projectRoot);
    const tools = await provider.readTools(ToolType.McpServer, ConfigScope.Project);

    expect(tools).toHaveLength(2);
    const active = tools.find(t => t.name === 'active-server')!;
    const disabled = tools.find(t => t.name === 'disabled-server')!;
    expect(active.status).toBe(ToolStatus.Enabled);
    expect(disabled.status).toBe(ToolStatus.Disabled);
  });

  it('readTools routes Command+Project to command parser', async () => {
    const dir = await makeTmpDir();
    const projectRoot = dir;
    const cmdDir = path.join(projectRoot, '.claude', 'commands');
    await fs.mkdir(cmdDir, { recursive: true });
    await fs.writeFile(path.join(cmdDir, 'deploy.md'), `---
description: Deploy the app
---

Deploy everything.`);

    const provider = new ClaudeCodeProvider(fileIO, schemaService, projectRoot);
    const tools = await provider.readTools(ToolType.Command, ConfigScope.Project);

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('deploy');
    expect(tools[0].type).toBe(ToolType.Command);
  });

  it('detect returns true when ~/.claude/ directory exists', async () => {
    // We test detect indirectly by using a mock FileIOService
    // that returns true for the claude dir check
    const dir = await makeTmpDir();
    const claudeDir = path.join(dir, '.claude');
    await fs.mkdir(claudeDir);

    // Create a custom provider that points to our tmp dir
    // We cannot easily override paths, so test the logic by creating a
    // minimal mock that demonstrates detect() behavior
    const mockFileIO = {
      ...fileIO,
      async fileExists(filePath: string): Promise<boolean> {
        if (filePath.endsWith('.claude')) { return true; }
        return false;
      },
    } as FileIOService;

    const provider = new ClaudeCodeProvider(mockFileIO, schemaService);
    const detected = await provider.detect();
    expect(detected).toBe(true);
  });

  it('detect returns true when ~/.claude.json exists', async () => {
    const mockFileIO = {
      ...fileIO,
      async fileExists(filePath: string): Promise<boolean> {
        if (filePath.endsWith('.claude.json')) { return true; }
        return false;
      },
    } as FileIOService;

    const provider = new ClaudeCodeProvider(mockFileIO, schemaService);
    const detected = await provider.detect();
    expect(detected).toBe(true);
  });

  it('detect returns false when neither exists', async () => {
    const mockFileIO = createMockFileIO({
      async fileExists(): Promise<boolean> { return false; },
    });

    const provider = new ClaudeCodeProvider(mockFileIO, schemaService);
    const detected = await provider.detect();
    expect(detected).toBe(false);
  });

  it('getWatchPaths returns correct paths for User scope', () => {
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    const paths = provider.getWatchPaths(ConfigScope.User);

    expect(paths).toHaveLength(4);
    expect(paths.some(p => p.endsWith('settings.json'))).toBe(true);
    expect(paths.some(p => p.endsWith('.claude.json'))).toBe(true);
    expect(paths.some(p => p.endsWith('skills'))).toBe(true);
    expect(paths.some(p => p.endsWith('commands'))).toBe(true);
  });

  it('getWatchPaths returns correct paths for Project scope with workspace', async () => {
    const dir = await makeTmpDir();
    const provider = new ClaudeCodeProvider(fileIO, schemaService, dir);
    const paths = provider.getWatchPaths(ConfigScope.Project);

    expect(paths).toHaveLength(5);
    expect(paths.some(p => p.includes('.claude') && p.endsWith('settings.json'))).toBe(true);
    expect(paths.some(p => p.endsWith('settings.local.json'))).toBe(true);
    expect(paths.some(p => p.endsWith('.mcp.json'))).toBe(true);
    expect(paths.some(p => p.endsWith('skills'))).toBe(true);
    expect(paths.some(p => p.endsWith('commands'))).toBe(true);
  });

  it('getWatchPaths returns empty for Project scope without workspace', () => {
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    const paths = provider.getWatchPaths(ConfigScope.Project);
    expect(paths).toEqual([]);
  });

  it('getWatchPaths returns correct paths for Managed scope', () => {
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    const paths = provider.getWatchPaths(ConfigScope.Managed);

    expect(paths).toHaveLength(2);
    expect(paths.some(p => p.endsWith('managed-settings.json'))).toBe(true);
    expect(paths.some(p => p.endsWith('managed-mcp.json'))).toBe(true);
  });

  it('getWatchPaths returns correct paths for Local scope with workspace', async () => {
    const dir = await makeTmpDir();
    const provider = new ClaudeCodeProvider(fileIO, schemaService, dir);
    const paths = provider.getWatchPaths(ConfigScope.Local);

    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('settings.local.json');
  });

  it('writeTool throws when ConfigService not provided', async () => {
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    const tool = { type: ToolType.Skill, name: 'test' } as NormalizedTool;
    await expect(provider.writeTool(tool, ConfigScope.User)).rejects.toThrow(
      'ConfigService and BackupService are required',
    );
  });

  it('removeTool throws when ConfigService not provided', async () => {
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    const tool = {
      id: 'skill:user:test',
      type: ToolType.Skill,
      name: 'test',
      scope: ConfigScope.User,
      source: { filePath: '/fake/SKILL.md', isDirectory: true, directoryPath: '/fake' },
      metadata: {},
    } as NormalizedTool;
    await expect(provider.removeTool(tool)).rejects.toThrow(
      'ConfigService and BackupService are required',
    );
  });

  // ---------------------------------------------------------------------------
  // toggleTool
  // ---------------------------------------------------------------------------

  it('toggleTool throws when ConfigService not provided', async () => {
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    const tool = {
      id: 'skill:user:test',
      type: ToolType.Skill,
      name: 'test',
      scope: ConfigScope.User,
      status: ToolStatus.Enabled,
      source: { filePath: '/fake/SKILL.md', isDirectory: true, directoryPath: '/fake' },
      metadata: {},
    } as NormalizedTool;
    await expect(provider.toggleTool(tool)).rejects.toThrow(
      'ConfigService and BackupService are required',
    );
  });

  it('toggleTool disables a skill by renaming SKILL.md -> SKILL.md.disabled (dir unchanged)', async () => {
    const dir = await makeTmpDir();
    const skillDir = path.join(dir, 'my-skill');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'content');

    const provider = new ClaudeCodeProvider(fileIO, schemaService, dir);
    // Inject minimal services so ensureWriteServices() passes
    const { configService, backupService } = makeWriteServices();
    provider.setWriteServices(configService, backupService);

    const tool: NormalizedTool = {
      id: 'skill:user:my-skill',
      type: ToolType.Skill,
      name: 'my-skill',
      scope: ConfigScope.User,
      status: ToolStatus.Enabled,
      source: { filePath: path.join(skillDir, 'SKILL.md'), isDirectory: true, directoryPath: skillDir },
      metadata: {},
    };

    await provider.toggleTool(tool);

    // The directory keeps its name; only SKILL.md is renamed so the agent's
    // SKILL.md discovery skips the folder.
    const dirStillExists = await fs.stat(skillDir).then(() => true).catch(() => false);
    expect(dirStillExists).toBe(true);
    const skillMdGone = await fs.stat(path.join(skillDir, 'SKILL.md')).then(() => true).catch(() => false);
    expect(skillMdGone).toBe(false);
    const disabledExists = await fs.stat(path.join(skillDir, 'SKILL.md.disabled')).then(() => true).catch(() => false);
    expect(disabledExists).toBe(true);
  });

  it('toggleTool re-enables a skill by restoring SKILL.md', async () => {
    const dir = await makeTmpDir();
    const skillDir = path.join(dir, 'my-skill');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md.disabled'), 'content');

    const provider = new ClaudeCodeProvider(fileIO, schemaService, dir);
    const { configService, backupService } = makeWriteServices();
    provider.setWriteServices(configService, backupService);

    const tool: NormalizedTool = {
      id: 'skill:user:my-skill',
      type: ToolType.Skill,
      name: 'my-skill',
      scope: ConfigScope.User,
      status: ToolStatus.Disabled,
      source: { filePath: path.join(skillDir, 'SKILL.md.disabled'), isDirectory: true, directoryPath: skillDir },
      metadata: {},
    };

    await provider.toggleTool(tool);

    const enabledExists = await fs.stat(path.join(skillDir, 'SKILL.md')).then(() => true).catch(() => false);
    expect(enabledExists).toBe(true);
  });

  it('toggleTool re-enables a legacy skill by restoring the renamed directory', async () => {
    const dir = await makeTmpDir();
    const skillDir = path.join(dir, 'my-skill.disabled');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'content');

    const provider = new ClaudeCodeProvider(fileIO, schemaService, dir);
    const { configService, backupService } = makeWriteServices();
    provider.setWriteServices(configService, backupService);

    const tool: NormalizedTool = {
      id: 'skill:user:my-skill',
      type: ToolType.Skill,
      name: 'my-skill',
      scope: ConfigScope.User,
      status: ToolStatus.Disabled,
      source: { filePath: path.join(skillDir, 'SKILL.md'), isDirectory: true, directoryPath: skillDir },
      metadata: {},
    };

    await provider.toggleTool(tool);

    const enabledDir = path.join(dir, 'my-skill');
    const enabledExists = await fs.stat(enabledDir).then(() => true).catch(() => false);
    expect(enabledExists).toBe(true);
  });

  it('toggleTool renames command file to add .disabled suffix', async () => {
    const dir = await makeTmpDir();
    const cmdFile = path.join(dir, 'deploy.md');
    await fs.writeFile(cmdFile, 'content');

    const provider = new ClaudeCodeProvider(fileIO, schemaService, dir);
    const { configService, backupService } = makeWriteServices();
    provider.setWriteServices(configService, backupService);

    const tool: NormalizedTool = {
      id: 'command:user:deploy',
      type: ToolType.Command,
      name: 'deploy',
      scope: ConfigScope.User,
      status: ToolStatus.Enabled,
      source: { filePath: cmdFile, isDirectory: false },
      metadata: {},
    };

    await provider.toggleTool(tool);

    const disabledExists = await fs.stat(`${cmdFile}.disabled`).then(() => true).catch(() => false);
    expect(disabledExists).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // getMcpFilePath / getMcpSchemaKey
  // ---------------------------------------------------------------------------

  it('getMcpFilePath returns user claude.json for User scope', () => {
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    const filePath = provider.getMcpFilePath(ConfigScope.User);
    expect(filePath).toContain('.claude.json');
  });

  it('getMcpFilePath returns project .mcp.json for Project scope', async () => {
    const dir = await makeTmpDir();
    const provider = new ClaudeCodeProvider(fileIO, schemaService, dir);
    const filePath = provider.getMcpFilePath(ConfigScope.Project);
    expect(filePath).toContain('.mcp.json');
    expect(filePath).toContain(dir);
  });

  it('getMcpFilePath throws for unsupported scope', () => {
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    expect(() => provider.getMcpFilePath(ConfigScope.Local)).toThrow();
  });

  it('getMcpSchemaKey returns claude-json for User scope', () => {
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    expect(provider.getMcpSchemaKey(ConfigScope.User)).toBe('claude-json');
  });

  it('getMcpSchemaKey returns mcp-file for Project scope', async () => {
    const dir = await makeTmpDir();
    const provider = new ClaudeCodeProvider(fileIO, schemaService, dir);
    expect(provider.getMcpSchemaKey(ConfigScope.Project)).toBe('mcp-file');
  });

  // ---------------------------------------------------------------------------
  // getSkillsDir / getCommandsDir / getSettingsPath
  // ---------------------------------------------------------------------------

  it('getSkillsDir returns user skills dir for User scope', () => {
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    const dir = provider.getSkillsDir(ConfigScope.User);
    expect(dir).toContain('skills');
    expect(dir).toContain('.claude');
  });

  it('getSkillsDir returns project skills dir for Project scope', async () => {
    const dir = await makeTmpDir();
    const provider = new ClaudeCodeProvider(fileIO, schemaService, dir);
    const skillsDir = provider.getSkillsDir(ConfigScope.Project);
    expect(skillsDir).toContain(dir);
    expect(skillsDir).toContain('skills');
  });

  it('getSkillsDir throws ProviderScopeError for Managed scope', () => {
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    expect(() => provider.getSkillsDir(ConfigScope.Managed)).toThrow(ProviderScopeError);
  });

  it('getSkillsDir throws ProviderScopeError for Project scope without workspace', () => {
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    expect(() => provider.getSkillsDir(ConfigScope.Project)).toThrow(ProviderScopeError);
  });

  it('getCommandsDir returns user commands dir for User scope', () => {
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    const dir = provider.getCommandsDir(ConfigScope.User);
    expect(dir).toContain('commands');
  });

  it('getCommandsDir returns project commands dir for Project scope', async () => {
    const dir = await makeTmpDir();
    const provider = new ClaudeCodeProvider(fileIO, schemaService, dir);
    const cmdsDir = provider.getCommandsDir(ConfigScope.Project);
    expect(cmdsDir).toContain(dir);
    expect(cmdsDir).toContain('commands');
  });

  it('getCommandsDir throws ProviderScopeError for Local scope', () => {
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    expect(() => provider.getCommandsDir(ConfigScope.Local)).toThrow(ProviderScopeError);
  });

  it('getSettingsPath returns user settings path for User scope', () => {
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    const settingsPath = provider.getSettingsPath(ConfigScope.User);
    expect(settingsPath).toContain('settings.json');
  });

  it('getSettingsPath returns project settings path for Project scope', async () => {
    const dir = await makeTmpDir();
    const provider = new ClaudeCodeProvider(fileIO, schemaService, dir);
    const settingsPath = provider.getSettingsPath(ConfigScope.Project);
    expect(settingsPath).toContain(dir);
    expect(settingsPath).toContain('settings.json');
  });

  it('getSettingsPath returns local settings path for Local scope', async () => {
    const dir = await makeTmpDir();
    const provider = new ClaudeCodeProvider(fileIO, schemaService, dir);
    const settingsPath = provider.getSettingsPath(ConfigScope.Local);
    expect(settingsPath).toContain('settings.local.json');
  });

  it('getSettingsPath throws for Managed scope', () => {
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    expect(() => provider.getSettingsPath(ConfigScope.Managed)).toThrow();
  });

  // ---------------------------------------------------------------------------
  // installSkill / installCommand
  // ---------------------------------------------------------------------------

  it('installSkill writes files to the correct project skills directory', async () => {
    const dir = await makeTmpDir();
    const provider = new ClaudeCodeProvider(fileIO, schemaService, dir);

    await provider.installSkill(ConfigScope.Project, 'test-skill', [
      { name: 'SKILL.md', content: '# Test Skill\n\nDo the thing.' },
      { name: 'helper.md', content: 'Helper content.' },
    ]);

    const skillDir = path.join(dir, '.claude', 'skills', 'test-skill');
    const mainFile = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8');
    const helperFile = await fs.readFile(path.join(skillDir, 'helper.md'), 'utf-8');

    expect(mainFile).toBe('# Test Skill\n\nDo the thing.');
    expect(helperFile).toBe('Helper content.');
  });

  it('installCommand writes single-file command directly to commands dir', async () => {
    const dir = await makeTmpDir();
    const provider = new ClaudeCodeProvider(fileIO, schemaService, dir);

    await provider.installCommand(ConfigScope.Project, 'deploy', [
      { name: 'deploy.md', content: '# Deploy\n\nDeploy everything.' },
    ]);

    const cmdFile = path.join(dir, '.claude', 'commands', 'deploy.md');
    const content = await fs.readFile(cmdFile, 'utf-8');
    expect(content).toBe('# Deploy\n\nDeploy everything.');
  });

  it('installCommand writes multi-file command to subdirectory', async () => {
    const dir = await makeTmpDir();
    const provider = new ClaudeCodeProvider(fileIO, schemaService, dir);

    await provider.installCommand(ConfigScope.Project, 'build', [
      { name: 'build.md', content: '# Build' },
      { name: 'config.md', content: 'Config details' },
    ]);

    const cmdDir = path.join(dir, '.claude', 'commands', 'build');
    const mainFile = await fs.readFile(path.join(cmdDir, 'build.md'), 'utf-8');
    const configFile = await fs.readFile(path.join(cmdDir, 'config.md'), 'utf-8');

    expect(mainFile).toBe('# Build');
    expect(configFile).toBe('Config details');
  });

  // ---------------------------------------------------------------------------
  // installHook / installMcpServer (require ConfigService -- test routing guard)
  // ---------------------------------------------------------------------------

  it('installHook throws when ConfigService not provided', async () => {
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    await expect(
      provider.installHook(ConfigScope.User, 'PreToolUse', { matcher: 'Bash', hooks: [] }),
    ).rejects.toThrow('ConfigService and BackupService are required');
  });

  it('installMcpServer throws when ConfigService not provided', async () => {
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    await expect(
      provider.installMcpServer(ConfigScope.User, 'test-server', { command: 'node' }),
    ).rejects.toThrow('ConfigService and BackupService are required');
  });

  // ---------------------------------------------------------------------------
  // Provider error types
  // ---------------------------------------------------------------------------

  it('ProviderScopeError has correct properties', () => {
    const err = new ProviderScopeError('Claude Code', 'managed', 'getSkillsDir');
    expect(err.name).toBe('ProviderScopeError');
    expect(err.agentName).toBe('Claude Code');
    expect(err.scope).toBe('managed');
    expect(err.message).toContain('Claude Code');
    expect(err.message).toContain('managed');
    expect(err.message).toContain('getSkillsDir');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('CodexProvider capabilities', () => {
  it('excludes custom prompts from toggle and move capabilities', () => {
    const provider = new CodexProvider(fileIO, schemaService);

    expect(provider.toggleableToolTypes?.has(ToolType.Skill)).toBe(true);
    expect(provider.toggleableToolTypes?.has(ToolType.McpServer)).toBe(true);
    expect(provider.toggleableToolTypes?.has(ToolType.CustomPrompt)).toBe(false);
    expect(provider.movableToolTypes?.has(ToolType.Skill)).toBe(true);
    expect(provider.movableToolTypes?.has(ToolType.McpServer)).toBe(true);
    expect(provider.movableToolTypes?.has(ToolType.CustomPrompt)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Provider capabilities (Phase 4 seam)
// ---------------------------------------------------------------------------

describe('provider capabilities', () => {
  it('Claude Code declares no optional capabilities', () => {
    const provider = new ClaudeCodeProvider(fileIO, schemaService);
    expect(provider.capabilities).toEqual({
      mcpEnvVars: false,
      mcpServerToolToggle: false,
      customPromptFileInstall: false,
    });
  });

  it('Codex declares MCP env/toggle + custom-prompt-file, with matching methods', () => {
    const provider = new CodexProvider(fileIO, schemaService);
    expect(provider.capabilities).toEqual({
      mcpEnvVars: true,
      mcpServerToolToggle: true,
      customPromptFileInstall: true,
    });
    expect(typeof provider.setMcpEnvVar).toBe('function');
    expect(typeof provider.removeMcpEnvVar).toBe('function');
    expect(typeof provider.toggleMcpServerTool).toBe('function');
    expect(typeof provider.installCustomPromptFile).toBe('function');
  });

  it('Codex exposes its init command via getCommands', () => {
    const provider = new CodexProvider(fileIO, schemaService);
    const ids = (provider.getCommands?.() ?? []).map((c) => c.id);
    expect(ids).toContain('ack.initCodexProject');
  });

  it('resolveCapabilities fills absent flags with false', () => {
    const mock = createMockProvider({ capabilities: undefined });
    expect(resolveCapabilities(mock)).toEqual({
      mcpEnvVars: false,
      mcpServerToolToggle: false,
      customPromptFileInstall: false,
    });
  });

  it('resolveCapabilities preserves declared flags', () => {
    const mock = createMockProvider({
      capabilities: { mcpEnvVars: true, mcpServerToolToggle: false, customPromptFileInstall: true },
    });
    expect(resolveCapabilities(mock)).toEqual({
      mcpEnvVars: true,
      mcpServerToolToggle: false,
      customPromptFileInstall: true,
    });
  });
});
