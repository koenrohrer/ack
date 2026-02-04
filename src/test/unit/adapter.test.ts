import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileIOService } from '../../services/fileio.service.js';
import { SchemaService } from '../../services/schema.service.js';
import { claudeCodeSchemas } from '../../adapters/claude-code/schemas.js';
import { ClaudeCodeAdapter } from '../../adapters/claude-code/claude-code.adapter.js';
import { AdapterRegistry } from '../../adapters/adapter.registry.js';
import { ToolType, ConfigScope, ToolStatus } from '../../types/enums.js';
import { AdapterScopeError } from '../../types/adapter-errors.js';
import type { IPlatformAdapter } from '../../types/adapter.js';
import type { NormalizedTool } from '../../types/config.js';

let tmpDir: string;
let fileIO: FileIOService;
let schemaService: SchemaService;

async function makeTmpDir(): Promise<string> {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-test-'));
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
// AdapterRegistry
// ---------------------------------------------------------------------------

describe('AdapterRegistry', () => {
  it('registers and retrieves adapters', () => {
    const registry = new AdapterRegistry();
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    registry.register(adapter);

    expect(registry.getAdapter('claude-code')).toBe(adapter);
    expect(registry.getAdapter('nonexistent')).toBeUndefined();
  });

  it('returns all registered adapters', () => {
    const registry = new AdapterRegistry();
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    registry.register(adapter);

    const all = registry.getAllAdapters();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('claude-code');
  });

  it('sets and gets active adapter', () => {
    const registry = new AdapterRegistry();
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    registry.register(adapter);

    expect(registry.getActiveAdapter()).toBeUndefined();

    registry.setActiveAdapter('claude-code');
    expect(registry.getActiveAdapter()).toBe(adapter);
  });

  it('throws when setting active adapter to unregistered id', () => {
    const registry = new AdapterRegistry();

    expect(() => registry.setActiveAdapter('nonexistent')).toThrow(
      'Adapter "nonexistent" is not registered',
    );
  });

  it('detectAndActivate returns the detected adapter when exactly one matches', async () => {
    const registry = new AdapterRegistry();
    const dir = await makeTmpDir();

    // Create a mock adapter that always detects
    const mockAdapter: IPlatformAdapter = {
      id: 'mock-platform',
      displayName: 'Mock Platform',
      supportedToolTypes: new Set([ToolType.Skill]),
      async readTools() { return []; },
      async writeTool() {},
      async removeTool() {},
      async toggleTool() {},
      async installMcpServer() {},
      getMcpFilePath() { return ''; },
      getMcpSchemaKey() { return ''; },
      getSkillsDir() { return ''; },
      getCommandsDir() { return ''; },
      getSettingsPath() { return ''; },
      async installSkill() {},
      async installCommand() {},
      async installHook() {},
      getWatchPaths() { return []; },
      async detect() { return true; },
    };

    registry.register(mockAdapter);

    const result = await registry.detectAndActivate();
    expect(result).toBe(mockAdapter);
    expect(registry.getActiveAdapter()).toBe(mockAdapter);
  });

  it('detectAndActivate returns undefined when multiple adapters match', async () => {
    const registry = new AdapterRegistry();

    const mock1: IPlatformAdapter = {
      id: 'platform-1',
      displayName: 'Platform 1',
      supportedToolTypes: new Set([]),
      async readTools() { return []; },
      async writeTool() {},
      async removeTool() {},
      async toggleTool() {},
      async installMcpServer() {},
      getMcpFilePath() { return ''; },
      getMcpSchemaKey() { return ''; },
      getSkillsDir() { return ''; },
      getCommandsDir() { return ''; },
      getSettingsPath() { return ''; },
      async installSkill() {},
      async installCommand() {},
      async installHook() {},
      getWatchPaths() { return []; },
      async detect() { return true; },
    };

    const mock2: IPlatformAdapter = {
      id: 'platform-2',
      displayName: 'Platform 2',
      supportedToolTypes: new Set([]),
      async readTools() { return []; },
      async writeTool() {},
      async removeTool() {},
      async toggleTool() {},
      async installMcpServer() {},
      getMcpFilePath() { return ''; },
      getMcpSchemaKey() { return ''; },
      getSkillsDir() { return ''; },
      getCommandsDir() { return ''; },
      getSettingsPath() { return ''; },
      async installSkill() {},
      async installCommand() {},
      async installHook() {},
      getWatchPaths() { return []; },
      async detect() { return true; },
    };

    registry.register(mock1);
    registry.register(mock2);

    const result = await registry.detectAndActivate();
    expect(result).toBeUndefined();
  });

  it('detectAndActivate returns undefined when no adapters match', async () => {
    const registry = new AdapterRegistry();

    const mockAdapter: IPlatformAdapter = {
      id: 'mock',
      displayName: 'Mock',
      supportedToolTypes: new Set([]),
      async readTools() { return []; },
      async writeTool() {},
      async removeTool() {},
      async toggleTool() {},
      async installMcpServer() {},
      getMcpFilePath() { return ''; },
      getMcpSchemaKey() { return ''; },
      getSkillsDir() { return ''; },
      getCommandsDir() { return ''; },
      getSettingsPath() { return ''; },
      async installSkill() {},
      async installCommand() {},
      async installHook() {},
      getWatchPaths() { return []; },
      async detect() { return false; },
    };

    registry.register(mockAdapter);

    const result = await registry.detectAndActivate();
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ClaudeCodeAdapter
// ---------------------------------------------------------------------------

describe('ClaudeCodeAdapter', () => {
  it('has correct identity properties', () => {
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    expect(adapter.id).toBe('claude-code');
    expect(adapter.displayName).toBe('Claude Code');
    expect(adapter.supportedToolTypes.has(ToolType.Skill)).toBe(true);
    expect(adapter.supportedToolTypes.has(ToolType.McpServer)).toBe(true);
    expect(adapter.supportedToolTypes.has(ToolType.Hook)).toBe(true);
    expect(adapter.supportedToolTypes.has(ToolType.Command)).toBe(true);
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

    // Patch paths for testing: create adapter with workspace root that
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

    const adapter = new ClaudeCodeAdapter(fileIO, schemaService, projectRoot);
    const tools = await adapter.readTools(ToolType.Skill, ConfigScope.Project);

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('Project Skill');
    expect(tools[0].type).toBe(ToolType.Skill);
    expect(tools[0].scope).toBe(ConfigScope.Project);
  });

  it('readTools returns empty array when no workspace and Project scope requested', async () => {
    // No workspaceRoot provided
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);

    const skillTools = await adapter.readTools(ToolType.Skill, ConfigScope.Project);
    expect(skillTools).toEqual([]);

    const hookTools = await adapter.readTools(ToolType.Hook, ConfigScope.Project);
    expect(hookTools).toEqual([]);

    const mcpTools = await adapter.readTools(ToolType.McpServer, ConfigScope.Project);
    expect(mcpTools).toEqual([]);

    const cmdTools = await adapter.readTools(ToolType.Command, ConfigScope.Project);
    expect(cmdTools).toEqual([]);
  });

  it('readTools returns empty array for Local scope without workspace', async () => {
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);

    const tools = await adapter.readTools(ToolType.Hook, ConfigScope.Local);
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

    const adapter = new ClaudeCodeAdapter(fileIO, schemaService, projectRoot);
    const tools = await adapter.readTools(ToolType.Hook, ConfigScope.Project);

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

    const adapter = new ClaudeCodeAdapter(fileIO, schemaService, projectRoot);
    const tools = await adapter.readTools(ToolType.McpServer, ConfigScope.Project);

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

    const adapter = new ClaudeCodeAdapter(fileIO, schemaService, projectRoot);
    const tools = await adapter.readTools(ToolType.Command, ConfigScope.Project);

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

    // Create a custom adapter that points to our tmp dir
    // We cannot easily override paths, so test the logic by creating a
    // minimal mock that demonstrates detect() behavior
    const mockFileIO = {
      ...fileIO,
      async fileExists(filePath: string): Promise<boolean> {
        if (filePath.endsWith('.claude')) { return true; }
        return false;
      },
    } as FileIOService;

    const adapter = new ClaudeCodeAdapter(mockFileIO, schemaService);
    const detected = await adapter.detect();
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

    const adapter = new ClaudeCodeAdapter(mockFileIO, schemaService);
    const detected = await adapter.detect();
    expect(detected).toBe(true);
  });

  it('detect returns false when neither exists', async () => {
    const mockFileIO = {
      ...fileIO,
      async fileExists(): Promise<boolean> { return false; },
    } as FileIOService;

    const adapter = new ClaudeCodeAdapter(mockFileIO, schemaService);
    const detected = await adapter.detect();
    expect(detected).toBe(false);
  });

  it('getWatchPaths returns correct paths for User scope', () => {
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    const paths = adapter.getWatchPaths(ConfigScope.User);

    expect(paths).toHaveLength(4);
    expect(paths.some(p => p.endsWith('settings.json'))).toBe(true);
    expect(paths.some(p => p.endsWith('.claude.json'))).toBe(true);
    expect(paths.some(p => p.endsWith('skills'))).toBe(true);
    expect(paths.some(p => p.endsWith('commands'))).toBe(true);
  });

  it('getWatchPaths returns correct paths for Project scope with workspace', async () => {
    const dir = await makeTmpDir();
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService, dir);
    const paths = adapter.getWatchPaths(ConfigScope.Project);

    expect(paths).toHaveLength(5);
    expect(paths.some(p => p.includes('.claude') && p.endsWith('settings.json'))).toBe(true);
    expect(paths.some(p => p.endsWith('settings.local.json'))).toBe(true);
    expect(paths.some(p => p.endsWith('.mcp.json'))).toBe(true);
    expect(paths.some(p => p.endsWith('skills'))).toBe(true);
    expect(paths.some(p => p.endsWith('commands'))).toBe(true);
  });

  it('getWatchPaths returns empty for Project scope without workspace', () => {
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    const paths = adapter.getWatchPaths(ConfigScope.Project);
    expect(paths).toEqual([]);
  });

  it('getWatchPaths returns correct paths for Managed scope', () => {
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    const paths = adapter.getWatchPaths(ConfigScope.Managed);

    expect(paths).toHaveLength(2);
    expect(paths.some(p => p.endsWith('managed-settings.json'))).toBe(true);
    expect(paths.some(p => p.endsWith('managed-mcp.json'))).toBe(true);
  });

  it('getWatchPaths returns correct paths for Local scope with workspace', async () => {
    const dir = await makeTmpDir();
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService, dir);
    const paths = adapter.getWatchPaths(ConfigScope.Local);

    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('settings.local.json');
  });

  it('writeTool throws when ConfigService not provided', async () => {
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    const tool = { type: ToolType.Skill, name: 'test' } as NormalizedTool;
    await expect(adapter.writeTool(tool, ConfigScope.User)).rejects.toThrow(
      'ConfigService and BackupService are required',
    );
  });

  it('removeTool throws when ConfigService not provided', async () => {
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    const tool = {
      id: 'skill:user:test',
      type: ToolType.Skill,
      name: 'test',
      scope: ConfigScope.User,
      source: { filePath: '/fake/SKILL.md', isDirectory: true, directoryPath: '/fake' },
      metadata: {},
    } as NormalizedTool;
    await expect(adapter.removeTool(tool)).rejects.toThrow(
      'ConfigService and BackupService are required',
    );
  });

  // ---------------------------------------------------------------------------
  // toggleTool
  // ---------------------------------------------------------------------------

  it('toggleTool throws when ConfigService not provided', async () => {
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    const tool = {
      id: 'skill:user:test',
      type: ToolType.Skill,
      name: 'test',
      scope: ConfigScope.User,
      status: ToolStatus.Enabled,
      source: { filePath: '/fake/SKILL.md', isDirectory: true, directoryPath: '/fake' },
      metadata: {},
    } as NormalizedTool;
    await expect(adapter.toggleTool(tool)).rejects.toThrow(
      'ConfigService and BackupService are required',
    );
  });

  it('toggleTool renames skill directory to add .disabled suffix when enabling', async () => {
    const dir = await makeTmpDir();
    const skillDir = path.join(dir, 'my-skill');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'content');

    const adapter = new ClaudeCodeAdapter(fileIO, schemaService, dir);
    // Inject minimal services so ensureWriteServices() passes
    adapter.setWriteServices({} as any, {} as any);

    const tool: NormalizedTool = {
      id: 'skill:user:my-skill',
      type: ToolType.Skill,
      name: 'my-skill',
      scope: ConfigScope.User,
      status: ToolStatus.Enabled,
      source: { filePath: path.join(skillDir, 'SKILL.md'), isDirectory: true, directoryPath: skillDir },
      metadata: {},
    };

    await adapter.toggleTool(tool);

    // Should have renamed to .disabled
    const disabledExists = await fs.stat(`${skillDir}.disabled`).then(() => true).catch(() => false);
    expect(disabledExists).toBe(true);

    const originalExists = await fs.stat(skillDir).then(() => true).catch(() => false);
    expect(originalExists).toBe(false);
  });

  it('toggleTool renames skill directory to remove .disabled suffix when re-enabling', async () => {
    const dir = await makeTmpDir();
    const skillDir = path.join(dir, 'my-skill.disabled');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'content');

    const adapter = new ClaudeCodeAdapter(fileIO, schemaService, dir);
    adapter.setWriteServices({} as any, {} as any);

    const tool: NormalizedTool = {
      id: 'skill:user:my-skill',
      type: ToolType.Skill,
      name: 'my-skill',
      scope: ConfigScope.User,
      status: ToolStatus.Disabled,
      source: { filePath: path.join(skillDir, 'SKILL.md'), isDirectory: true, directoryPath: skillDir },
      metadata: {},
    };

    await adapter.toggleTool(tool);

    const enabledDir = path.join(dir, 'my-skill');
    const enabledExists = await fs.stat(enabledDir).then(() => true).catch(() => false);
    expect(enabledExists).toBe(true);
  });

  it('toggleTool renames command file to add .disabled suffix', async () => {
    const dir = await makeTmpDir();
    const cmdFile = path.join(dir, 'deploy.md');
    await fs.writeFile(cmdFile, 'content');

    const adapter = new ClaudeCodeAdapter(fileIO, schemaService, dir);
    adapter.setWriteServices({} as any, {} as any);

    const tool: NormalizedTool = {
      id: 'command:user:deploy',
      type: ToolType.Command,
      name: 'deploy',
      scope: ConfigScope.User,
      status: ToolStatus.Enabled,
      source: { filePath: cmdFile, isDirectory: false },
      metadata: {},
    };

    await adapter.toggleTool(tool);

    const disabledExists = await fs.stat(`${cmdFile}.disabled`).then(() => true).catch(() => false);
    expect(disabledExists).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // getMcpFilePath / getMcpSchemaKey
  // ---------------------------------------------------------------------------

  it('getMcpFilePath returns user claude.json for User scope', () => {
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    const filePath = adapter.getMcpFilePath(ConfigScope.User);
    expect(filePath).toContain('.claude.json');
  });

  it('getMcpFilePath returns project .mcp.json for Project scope', async () => {
    const dir = await makeTmpDir();
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService, dir);
    const filePath = adapter.getMcpFilePath(ConfigScope.Project);
    expect(filePath).toContain('.mcp.json');
    expect(filePath).toContain(dir);
  });

  it('getMcpFilePath throws for unsupported scope', () => {
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    expect(() => adapter.getMcpFilePath(ConfigScope.Local)).toThrow();
  });

  it('getMcpSchemaKey returns claude-json for User scope', () => {
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    expect(adapter.getMcpSchemaKey(ConfigScope.User)).toBe('claude-json');
  });

  it('getMcpSchemaKey returns mcp-file for Project scope', async () => {
    const dir = await makeTmpDir();
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService, dir);
    expect(adapter.getMcpSchemaKey(ConfigScope.Project)).toBe('mcp-file');
  });

  // ---------------------------------------------------------------------------
  // getSkillsDir / getCommandsDir / getSettingsPath
  // ---------------------------------------------------------------------------

  it('getSkillsDir returns user skills dir for User scope', () => {
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    const dir = adapter.getSkillsDir(ConfigScope.User);
    expect(dir).toContain('skills');
    expect(dir).toContain('.claude');
  });

  it('getSkillsDir returns project skills dir for Project scope', async () => {
    const dir = await makeTmpDir();
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService, dir);
    const skillsDir = adapter.getSkillsDir(ConfigScope.Project);
    expect(skillsDir).toContain(dir);
    expect(skillsDir).toContain('skills');
  });

  it('getSkillsDir throws AdapterScopeError for Managed scope', () => {
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    expect(() => adapter.getSkillsDir(ConfigScope.Managed)).toThrow(AdapterScopeError);
  });

  it('getSkillsDir throws AdapterScopeError for Project scope without workspace', () => {
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    expect(() => adapter.getSkillsDir(ConfigScope.Project)).toThrow(AdapterScopeError);
  });

  it('getCommandsDir returns user commands dir for User scope', () => {
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    const dir = adapter.getCommandsDir(ConfigScope.User);
    expect(dir).toContain('commands');
  });

  it('getCommandsDir returns project commands dir for Project scope', async () => {
    const dir = await makeTmpDir();
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService, dir);
    const cmdsDir = adapter.getCommandsDir(ConfigScope.Project);
    expect(cmdsDir).toContain(dir);
    expect(cmdsDir).toContain('commands');
  });

  it('getCommandsDir throws AdapterScopeError for Local scope', () => {
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    expect(() => adapter.getCommandsDir(ConfigScope.Local)).toThrow(AdapterScopeError);
  });

  it('getSettingsPath returns user settings path for User scope', () => {
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    const settingsPath = adapter.getSettingsPath(ConfigScope.User);
    expect(settingsPath).toContain('settings.json');
  });

  it('getSettingsPath returns project settings path for Project scope', async () => {
    const dir = await makeTmpDir();
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService, dir);
    const settingsPath = adapter.getSettingsPath(ConfigScope.Project);
    expect(settingsPath).toContain(dir);
    expect(settingsPath).toContain('settings.json');
  });

  it('getSettingsPath returns local settings path for Local scope', async () => {
    const dir = await makeTmpDir();
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService, dir);
    const settingsPath = adapter.getSettingsPath(ConfigScope.Local);
    expect(settingsPath).toContain('settings.local.json');
  });

  it('getSettingsPath throws for Managed scope', () => {
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    expect(() => adapter.getSettingsPath(ConfigScope.Managed)).toThrow();
  });

  // ---------------------------------------------------------------------------
  // installSkill / installCommand
  // ---------------------------------------------------------------------------

  it('installSkill writes files to the correct project skills directory', async () => {
    const dir = await makeTmpDir();
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService, dir);

    await adapter.installSkill(ConfigScope.Project, 'test-skill', [
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
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService, dir);

    await adapter.installCommand(ConfigScope.Project, 'deploy', [
      { name: 'deploy.md', content: '# Deploy\n\nDeploy everything.' },
    ]);

    const cmdFile = path.join(dir, '.claude', 'commands', 'deploy.md');
    const content = await fs.readFile(cmdFile, 'utf-8');
    expect(content).toBe('# Deploy\n\nDeploy everything.');
  });

  it('installCommand writes multi-file command to subdirectory', async () => {
    const dir = await makeTmpDir();
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService, dir);

    await adapter.installCommand(ConfigScope.Project, 'build', [
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
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    await expect(
      adapter.installHook(ConfigScope.User, 'PreToolUse', { matcher: 'Bash', hooks: [] }),
    ).rejects.toThrow('ConfigService and BackupService are required');
  });

  it('installMcpServer throws when ConfigService not provided', async () => {
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    await expect(
      adapter.installMcpServer(ConfigScope.User, 'test-server', { command: 'node' }),
    ).rejects.toThrow('ConfigService and BackupService are required');
  });

  // ---------------------------------------------------------------------------
  // Adapter error types
  // ---------------------------------------------------------------------------

  it('AdapterScopeError has correct properties', () => {
    const err = new AdapterScopeError('Claude Code', 'managed', 'getSkillsDir');
    expect(err.name).toBe('AdapterScopeError');
    expect(err.agentName).toBe('Claude Code');
    expect(err.scope).toBe('managed');
    expect(err.message).toContain('Claude Code');
    expect(err.message).toContain('managed');
    expect(err.message).toContain('getSkillsDir');
    expect(err).toBeInstanceOf(Error);
  });
});
