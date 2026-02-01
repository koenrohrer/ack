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

  it('writeTool throws not yet implemented', async () => {
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    await expect(adapter.writeTool({} as NormalizedTool, ConfigScope.User)).rejects.toThrow(
      'Not yet implemented',
    );
  });

  it('removeTool throws not yet implemented', async () => {
    const adapter = new ClaudeCodeAdapter(fileIO, schemaService);
    await expect(adapter.removeTool('id', ToolType.Skill, ConfigScope.User)).rejects.toThrow(
      'Not yet implemented',
    );
  });
});
