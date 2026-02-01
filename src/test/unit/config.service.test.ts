import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ConfigService } from '../../services/config.service.js';
import { FileIOService } from '../../services/fileio.service.js';
import { BackupService } from '../../services/backup.service.js';
import { SchemaService } from '../../services/schema.service.js';
import { AdapterRegistry } from '../../adapters/adapter.registry.js';
import { claudeCodeSchemas } from '../../adapters/claude-code/schemas.js';
import { ToolType, ConfigScope, ToolStatus } from '../../types/enums.js';
import type { IPlatformAdapter } from '../../types/adapter.js';
import type { NormalizedTool } from '../../types/config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeTool(overrides: Partial<NormalizedTool> & { name: string; scope: ConfigScope }): NormalizedTool {
  return {
    id: `${overrides.type ?? ToolType.McpServer}:${overrides.name}:${overrides.scope}`,
    type: overrides.type ?? ToolType.McpServer,
    name: overrides.name,
    description: overrides.description,
    scope: overrides.scope,
    status: overrides.status ?? ToolStatus.Enabled,
    statusDetail: overrides.statusDetail,
    source: overrides.source ?? { filePath: `/fake/${overrides.scope}/${overrides.name}` },
    metadata: overrides.metadata ?? {},
    scopeEntries: overrides.scopeEntries,
  };
}

function createMockAdapter(toolsByScope: Record<string, NormalizedTool[]> = {}): IPlatformAdapter {
  return {
    id: 'mock',
    displayName: 'Mock Platform',
    supportedToolTypes: new Set([ToolType.Skill, ToolType.McpServer, ToolType.Hook, ToolType.Command]),
    async readTools(type: ToolType, scope: ConfigScope): Promise<NormalizedTool[]> {
      const key = `${type}:${scope}`;
      return toolsByScope[key] ?? [];
    },
    async writeTool() {},
    async removeTool() {},
    getWatchPaths() { return []; },
    async detect() { return true; },
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-svc-test-'));
});

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
});

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

describe('ConfigService - scope resolution', () => {
  let fileIO: FileIOService;
  let backup: BackupService;
  let schemas: SchemaService;

  beforeEach(() => {
    fileIO = new FileIOService();
    backup = new BackupService();
    schemas = new SchemaService();
    schemas.registerSchemas(claudeCodeSchemas);
  });

  it('tool in User only is returned as-is with single scopeEntry', async () => {
    const userTool = makeTool({ name: 'my-server', scope: ConfigScope.User });
    const adapter = createMockAdapter({
      [`${ToolType.McpServer}:${ConfigScope.User}`]: [userTool],
    });
    const registry = new AdapterRegistry();
    registry.register(adapter);
    registry.setActiveAdapter('mock');

    const svc = new ConfigService(fileIO, backup, schemas, registry);
    const tools = await svc.readAllTools(ToolType.McpServer);

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('my-server');
    expect(tools[0].scope).toBe(ConfigScope.User);
    expect(tools[0].scopeEntries).toHaveLength(1);
    expect(tools[0].scopeEntries![0].scope).toBe(ConfigScope.User);
  });

  it('tool in User AND Project -> Project version wins, scopeEntries has both', async () => {
    const userTool = makeTool({ name: 'shared-server', scope: ConfigScope.User, status: ToolStatus.Enabled });
    const projectTool = makeTool({ name: 'shared-server', scope: ConfigScope.Project, status: ToolStatus.Enabled });

    const adapter = createMockAdapter({
      [`${ToolType.McpServer}:${ConfigScope.User}`]: [userTool],
      [`${ToolType.McpServer}:${ConfigScope.Project}`]: [projectTool],
    });
    const registry = new AdapterRegistry();
    registry.register(adapter);
    registry.setActiveAdapter('mock');

    const svc = new ConfigService(fileIO, backup, schemas, registry);
    const tools = await svc.readAllTools(ToolType.McpServer);

    expect(tools).toHaveLength(1);
    expect(tools[0].scope).toBe(ConfigScope.Project);
    expect(tools[0].scopeEntries).toHaveLength(2);
    const scopes = tools[0].scopeEntries!.map(e => e.scope);
    expect(scopes).toContain(ConfigScope.User);
    expect(scopes).toContain(ConfigScope.Project);
  });

  it('tool in User AND Managed -> Managed version wins', async () => {
    const userTool = makeTool({ name: 'enterprise-server', scope: ConfigScope.User });
    const managedTool = makeTool({ name: 'enterprise-server', scope: ConfigScope.Managed });

    const adapter = createMockAdapter({
      [`${ToolType.McpServer}:${ConfigScope.User}`]: [userTool],
      [`${ToolType.McpServer}:${ConfigScope.Managed}`]: [managedTool],
    });
    const registry = new AdapterRegistry();
    registry.register(adapter);
    registry.setActiveAdapter('mock');

    const svc = new ConfigService(fileIO, backup, schemas, registry);
    const tools = await svc.readAllTools(ToolType.McpServer);

    expect(tools).toHaveLength(1);
    expect(tools[0].scope).toBe(ConfigScope.Managed);
  });

  it('tool enabled at User, disabled at Project -> Project (disabled) wins', async () => {
    const userTool = makeTool({ name: 'toggle-server', scope: ConfigScope.User, status: ToolStatus.Enabled });
    const projectTool = makeTool({ name: 'toggle-server', scope: ConfigScope.Project, status: ToolStatus.Disabled });

    const adapter = createMockAdapter({
      [`${ToolType.McpServer}:${ConfigScope.User}`]: [userTool],
      [`${ToolType.McpServer}:${ConfigScope.Project}`]: [projectTool],
    });
    const registry = new AdapterRegistry();
    registry.register(adapter);
    registry.setActiveAdapter('mock');

    const svc = new ConfigService(fileIO, backup, schemas, registry);
    const tools = await svc.readAllTools(ToolType.McpServer);

    expect(tools).toHaveLength(1);
    expect(tools[0].status).toBe(ToolStatus.Disabled);
    expect(tools[0].scope).toBe(ConfigScope.Project);
    // scopeEntries shows both states so UI can badge it
    expect(tools[0].scopeEntries).toHaveLength(2);
    const userEntry = tools[0].scopeEntries!.find(e => e.scope === ConfigScope.User);
    const projectEntry = tools[0].scopeEntries!.find(e => e.scope === ConfigScope.Project);
    expect(userEntry!.status).toBe(ToolStatus.Enabled);
    expect(projectEntry!.status).toBe(ToolStatus.Disabled);
  });

  it('tool in all 4 scopes -> Managed version wins, scopeEntries has all 4', async () => {
    const userTool = makeTool({
      name: 'hook-tool', scope: ConfigScope.User, type: ToolType.Hook,
      metadata: { eventName: 'PreToolUse', matcher: 'Bash' },
    });
    const projectTool = makeTool({
      name: 'hook-tool', scope: ConfigScope.Project, type: ToolType.Hook,
      metadata: { eventName: 'PreToolUse', matcher: 'Bash' },
    });
    const localTool = makeTool({
      name: 'hook-tool', scope: ConfigScope.Local, type: ToolType.Hook,
      metadata: { eventName: 'PreToolUse', matcher: 'Bash' },
    });
    const managedTool = makeTool({
      name: 'hook-tool', scope: ConfigScope.Managed, type: ToolType.Hook,
      metadata: { eventName: 'PreToolUse', matcher: 'Bash' },
    });

    const adapter = createMockAdapter({
      [`${ToolType.Hook}:${ConfigScope.User}`]: [userTool],
      [`${ToolType.Hook}:${ConfigScope.Project}`]: [projectTool],
      [`${ToolType.Hook}:${ConfigScope.Local}`]: [localTool],
      [`${ToolType.Hook}:${ConfigScope.Managed}`]: [managedTool],
    });
    const registry = new AdapterRegistry();
    registry.register(adapter);
    registry.setActiveAdapter('mock');

    const svc = new ConfigService(fileIO, backup, schemas, registry);
    const tools = await svc.readAllTools(ToolType.Hook);

    expect(tools).toHaveLength(1);
    expect(tools[0].scope).toBe(ConfigScope.Managed);
    expect(tools[0].scopeEntries).toHaveLength(4);
    const scopes = tools[0].scopeEntries!.map(e => e.scope);
    expect(scopes).toContain(ConfigScope.Managed);
    expect(scopes).toContain(ConfigScope.Project);
    expect(scopes).toContain(ConfigScope.Local);
    expect(scopes).toContain(ConfigScope.User);
  });

  it('tools with different names in same scope are both returned (no dedup)', async () => {
    const toolA = makeTool({ name: 'server-a', scope: ConfigScope.User });
    const toolB = makeTool({ name: 'server-b', scope: ConfigScope.User });

    const adapter = createMockAdapter({
      [`${ToolType.McpServer}:${ConfigScope.User}`]: [toolA, toolB],
    });
    const registry = new AdapterRegistry();
    registry.register(adapter);
    registry.setActiveAdapter('mock');

    const svc = new ConfigService(fileIO, backup, schemas, registry);
    const tools = await svc.readAllTools(ToolType.McpServer);

    expect(tools).toHaveLength(2);
    const names = tools.map(t => t.name);
    expect(names).toContain('server-a');
    expect(names).toContain('server-b');
  });

  it('returns empty array when no active adapter', async () => {
    const registry = new AdapterRegistry();
    const svc = new ConfigService(fileIO, backup, schemas, registry);
    const tools = await svc.readAllTools(ToolType.McpServer);
    expect(tools).toEqual([]);
  });

  it('readToolsByScope delegates to adapter without resolution', async () => {
    const userTool = makeTool({ name: 'only-user', scope: ConfigScope.User });
    const projectTool = makeTool({ name: 'only-user', scope: ConfigScope.Project });

    const adapter = createMockAdapter({
      [`${ToolType.McpServer}:${ConfigScope.User}`]: [userTool],
      [`${ToolType.McpServer}:${ConfigScope.Project}`]: [projectTool],
    });
    const registry = new AdapterRegistry();
    registry.register(adapter);
    registry.setActiveAdapter('mock');

    const svc = new ConfigService(fileIO, backup, schemas, registry);
    const tools = await svc.readToolsByScope(ToolType.McpServer, ConfigScope.User);

    // Should return only user-scope tools without merging project
    expect(tools).toHaveLength(1);
    expect(tools[0].scope).toBe(ConfigScope.User);
    expect(tools[0].scopeEntries).toBeUndefined();
  });

  it('catches read errors and returns error-status tools', async () => {
    const errorAdapter: IPlatformAdapter = {
      id: 'error-mock',
      displayName: 'Error Mock',
      supportedToolTypes: new Set([ToolType.McpServer]),
      async readTools(_type: ToolType, scope: ConfigScope): Promise<NormalizedTool[]> {
        if (scope === ConfigScope.User) {
          throw new Error('Permission denied');
        }
        return [];
      },
      async writeTool() {},
      async removeTool() {},
      getWatchPaths() { return []; },
      async detect() { return true; },
    };

    const registry = new AdapterRegistry();
    registry.register(errorAdapter);
    registry.setActiveAdapter('error-mock');

    const svc = new ConfigService(fileIO, backup, schemas, registry);
    const tools = await svc.readAllTools(ToolType.McpServer);

    // Should have an error tool for the User scope
    const errorTool = tools.find(t => t.status === ToolStatus.Error);
    expect(errorTool).toBeDefined();
    expect(errorTool!.statusDetail).toContain('Permission denied');
  });
});

// ---------------------------------------------------------------------------
// Write pipeline
// ---------------------------------------------------------------------------

describe('ConfigService - write pipeline', () => {
  let fileIO: FileIOService;
  let backup: BackupService;
  let schemas: SchemaService;
  let registry: AdapterRegistry;
  let svc: ConfigService;

  beforeEach(() => {
    fileIO = new FileIOService();
    backup = new BackupService();
    schemas = new SchemaService();
    schemas.registerSchemas(claudeCodeSchemas);
    registry = new AdapterRegistry();
    svc = new ConfigService(fileIO, backup, schemas, registry);
  });

  it('re-reads file before applying mutation', async () => {
    const filePath = path.join(tmpDir, 'settings.json');
    const initial = { hooks: {}, env: { INITIAL: 'true' } };
    await fileIO.writeJsonFile(filePath, initial);

    // The mutation should receive the latest content from disk
    let receivedCurrent: unknown;
    await svc.writeConfigFile<Record<string, unknown>>(filePath, 'settings-file', (current) => {
      receivedCurrent = current;
      return { ...current, env: { UPDATED: 'true' } };
    });

    // Verify mutation received the actual file content (re-read happened)
    expect(receivedCurrent).toHaveProperty('env');
    expect((receivedCurrent as Record<string, unknown>).env).toEqual({ INITIAL: 'true' });
  });

  it('creates backup before writing', async () => {
    const filePath = path.join(tmpDir, 'settings.json');
    const original = { hooks: {} };
    await fileIO.writeJsonFile(filePath, original);

    await svc.writeConfigFile<Record<string, unknown>>(filePath, 'settings-file', (current) => {
      return { ...current, env: { NEW: 'value' } };
    });

    // Verify backup was created
    const backups = await backup.listBackups(filePath);
    expect(backups.length).toBeGreaterThan(0);

    // Verify the backup contains the original content
    const backupResult = await fileIO.readJsonFile<Record<string, unknown>>(backups[0]);
    expect(backupResult.success).toBe(true);
    if (backupResult.success) {
      expect(backupResult.data).toEqual(original);
    }
  });

  it('blocks write when schema validation fails', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    const original = { mcpServers: { valid: { command: 'node', args: [] } } };
    await fileIO.writeJsonFile(filePath, original);

    // Mutate to produce invalid data (mcp server missing required 'command')
    await expect(
      svc.writeConfigFile<Record<string, unknown>>(filePath, 'mcp-file', () => {
        return { mcpServers: { bad: { args: ['no-command'] } } };
      }),
    ).rejects.toThrow('Schema validation failed');

    // Verify file was NOT changed
    const afterResult = await fileIO.readJsonFile<Record<string, unknown>>(filePath);
    expect(afterResult.success).toBe(true);
    if (afterResult.success) {
      expect(afterResult.data).toEqual(original);
    }
  });

  it('creates parent directory if needed', async () => {
    const filePath = path.join(tmpDir, 'nested', 'deep', 'settings.json');

    await svc.writeConfigFile<Record<string, unknown>>(filePath, 'settings-file', () => {
      return { hooks: {} };
    });

    // File should exist with valid content
    const result = await fileIO.readJsonFile<Record<string, unknown>>(filePath);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveProperty('hooks');
    }
  });

  it('produces valid JSON with 2-space indentation', async () => {
    const filePath = path.join(tmpDir, 'formatted.json');

    await svc.writeConfigFile<Record<string, unknown>>(filePath, 'settings-file', () => {
      return { hooks: {}, env: { KEY: 'value' } };
    });

    // Read raw content and verify formatting
    const raw = await fs.readFile(filePath, 'utf-8');
    expect(raw).toContain('  "hooks"');
    expect(raw).toContain('  "env"');
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('starts with empty object when file does not exist', async () => {
    const filePath = path.join(tmpDir, 'nonexistent.json');

    let receivedCurrent: unknown;
    await svc.writeConfigFile<Record<string, unknown>>(filePath, 'settings-file', (current) => {
      receivedCurrent = current;
      return { hooks: {} };
    });

    // Mutation should receive empty object for nonexistent file
    expect(receivedCurrent).toEqual({});
  });

  it('writeTextConfigFile backs up and writes text', async () => {
    const filePath = path.join(tmpDir, 'SKILL.md');
    const original = '---\nname: Old Skill\n---\nOld content';
    await fileIO.writeTextFile(filePath, original);

    const updated = '---\nname: New Skill\n---\nNew content';
    await svc.writeTextConfigFile(filePath, updated);

    // Verify backup was created
    const backups = await backup.listBackups(filePath);
    expect(backups.length).toBeGreaterThan(0);

    // Verify file has new content
    const content = await fileIO.readTextFile(filePath);
    expect(content).toBe(updated);
  });
});
