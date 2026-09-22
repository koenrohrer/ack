import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileIOService } from '../../services/fileio.service.js';
import { SchemaService } from '../../services/schema.service.js';
import { BackupService } from '../../services/backup.service.js';
import { ConfigService } from '../../services/config.service.js';
import { ProfileService } from '../../services/profile.service.js';
import { ProviderRegistry } from '../../providers/provider.registry.js';
import { ClaudeCodeProvider } from '../../providers/claude-code/claude-code.provider.js';
import { claudeCodeSchemas } from '../../providers/claude-code/schemas.js';
import { ToolType, ConfigScope } from '../../types/enums.js';
import type { ExportedTool } from '../../services/profile.types.js';

type CtorArgs = ConstructorParameters<typeof ProfileService>;

let root: string;
let provider: ClaudeCodeProvider;
let svc: ProfileService;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'import-apply-'));
  await fs.mkdir(path.join(root, '.claude'), { recursive: true });
  const fileIO = new FileIOService();
  const schemaService = new SchemaService();
  schemaService.registerSchemas(claudeCodeSchemas);
  const registry = new ProviderRegistry();
  provider = new ClaudeCodeProvider(fileIO, schemaService, root);
  registry.register(provider);
  registry.setActiveProvider(provider.id);
  const backupService = new BackupService(fileIO);
  const configService = new ConfigService(fileIO, backupService, schemaService, registry);
  provider.setWriteServices(configService, backupService);
  svc = new ProfileService(
    {} as unknown as CtorArgs[0],
    configService,
    {} as unknown as CtorArgs[2],
    registry,
    fileIO,
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function importedServer(config: { command: string; args: string[]; env: Record<string, string>; url?: string }): ExportedTool {
  return { key: 'mcp:srv', enabled: true, type: 'mcp_server', name: 'srv', config: { kind: 'mcp_server', ...config } };
}

async function readJson(file: string): Promise<Record<string, any>> {
  return JSON.parse(await fs.readFile(file, 'utf-8'));
}

describe('ProfileService.applyImportedConfig', () => {
  it('replaces command, args and env of an MCP server and keeps its other keys', async () => {
    const mcpPath = path.join(root, '.mcp.json');
    await fs.writeFile(
      mcpPath,
      JSON.stringify({ mcpServers: { srv: { command: 'node', args: ['a.js'], cwd: '/srv', disabled: true } } }),
    );
    const [local] = await provider.readTools(ToolType.McpServer, ConfigScope.Project);

    const result = await svc.applyImportedConfig(
      importedServer({ command: 'python', args: ['b.py', '-v'], env: { K: '1' } }),
      local,
    );

    expect(result).toEqual({ applied: true });
    expect((await readJson(mcpPath)).mcpServers.srv).toEqual({
      command: 'python',
      args: ['b.py', '-v'],
      env: { K: '1' },
      cwd: '/srv',
      disabled: true,
    });
  });

  it('does not change an MCP server whose transport differs from the import', async () => {
    const mcpPath = path.join(root, '.mcp.json');
    const before = JSON.stringify({ mcpServers: { srv: { command: 'node', args: ['a.js'] } } });
    await fs.writeFile(mcpPath, before);
    const [local] = await provider.readTools(ToolType.McpServer, ConfigScope.Project);

    const result = await svc.applyImportedConfig(
      importedServer({ command: '', args: [], env: {}, url: 'https://example.test/mcp' }),
      local,
    );

    expect(result).toMatchObject({ applied: false, reason: expect.stringMatching(/transport/) });
    expect(await fs.readFile(mcpPath, 'utf-8')).toBe(before);
  });

  it('reports an MCP server removed since it was read', async () => {
    const mcpPath = path.join(root, '.mcp.json');
    await fs.writeFile(mcpPath, JSON.stringify({ mcpServers: { srv: { command: 'node' } } }));
    const [local] = await provider.readTools(ToolType.McpServer, ConfigScope.Project);
    await fs.writeFile(mcpPath, JSON.stringify({ mcpServers: {} }));

    const result = await svc.applyImportedConfig(importedServer({ command: 'python', args: [], env: {} }), local);

    expect(result).toMatchObject({ applied: false, reason: expect.stringMatching(/srv/) });
  });

  it('replaces the hooks of a hook group with the imported ones', async () => {
    const settingsPath = path.join(root, '.claude', 'settings.json');
    const edit = { matcher: 'Edit', hooks: [{ type: 'command', command: 'echo e' }] };
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo a' }] }, edit] },
      }),
    );
    const local = (await provider.readTools(ToolType.Hook, ConfigScope.Project)).find(
      (t) => t.metadata.matcher === 'Bash',
    )!;
    const importedHooks = [
      { type: 'command', command: 'echo x' },
      { type: 'command', command: 'echo y' },
    ];

    const result = await svc.applyImportedConfig(
      {
        key: 'hook:PreToolUse:Bash',
        enabled: true,
        type: 'hook',
        name: 'PreToolUse (Bash)',
        config: { kind: 'hook', eventName: 'PreToolUse', matcher: 'Bash', hooks: importedHooks },
      },
      local,
    );

    expect(result).toEqual({ applied: true });
    expect((await readJson(settingsPath)).hooks.PreToolUse).toEqual([
      edit,
      { matcher: 'Bash', hooks: importedHooks },
    ]);
  });

  it('keeps a stashed hook group stashed when it replaces its hooks', async () => {
    const settingsPath = path.join(root, '.claude', 'settings.json');
    const active = { matcher: 'Edit', hooks: [{ type: 'command', command: 'echo e' }] };
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        hooks: { PreToolUse: [active] },
        _disabledHooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo a' }] }] },
      }),
    );
    const local = (await provider.readTools(ToolType.Hook, ConfigScope.Project)).find(
      (t) => t.metadata.matcher === 'Bash',
    )!;
    expect(local.metadata.stashed).toBe(true);
    const importedHooks = [{ type: 'command', command: 'echo x' }];

    const result = await svc.applyImportedConfig(
      {
        key: 'hook:PreToolUse:Bash',
        enabled: true,
        type: 'hook',
        name: 'PreToolUse (Bash)',
        config: { kind: 'hook', eventName: 'PreToolUse', matcher: 'Bash', hooks: importedHooks },
      },
      local,
    );

    expect(result).toEqual({ applied: true });
    const saved = await readJson(settingsPath);
    expect(saved.hooks.PreToolUse).toEqual([active]);
    expect(saved._disabledHooks.PreToolUse).toEqual([{ matcher: 'Bash', hooks: importedHooks }]);
  });

  it('reports other tool kinds as not applied', async () => {
    const skillDir = path.join(root, '.claude', 'skills', 'demo');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: demo\ndescription: d\n---\nBody');
    const [local] = await provider.readTools(ToolType.Skill, ConfigScope.Project);

    const result = await svc.applyImportedConfig(
      { key: 'skill:demo', enabled: true, type: 'skill', name: 'demo', config: { kind: 'skill', files: [] } },
      local,
    );

    expect(result).toMatchObject({ applied: false });
  });
});
