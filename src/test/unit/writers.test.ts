import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileIOService } from '../../services/fileio.service.js';
import { BackupService } from '../../services/backup.service.js';
import { SchemaService } from '../../services/schema.service.js';
import { AdapterRegistry } from '../../adapters/adapter.registry.js';
import { ConfigService } from '../../services/config.service.js';
import { claudeCodeSchemas } from '../../adapters/claude-code/schemas.js';

// MCP writer
import { toggleMcpServer, removeMcpServer, addMcpServer } from '../../adapters/claude-code/writers/mcp.writer.js';

// Settings writer
import { toggleHook, removeHook, addHook } from '../../adapters/claude-code/writers/settings.writer.js';

// Skill writer
import { removeSkill, copySkill, renameSkill } from '../../adapters/claude-code/writers/skill.writer.js';

// Command writer
import { removeCommand, copyCommand, renameCommand } from '../../adapters/claude-code/writers/command.writer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let fileIO: FileIOService;
let backup: BackupService;
let schemas: SchemaService;
let registry: AdapterRegistry;
let configService: ConfigService;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'writers-test-'));
  fileIO = new FileIOService();
  backup = new BackupService();
  schemas = new SchemaService();
  schemas.registerSchemas(claudeCodeSchemas);
  registry = new AdapterRegistry();
  configService = new ConfigService(fileIO, backup, schemas, registry);
});

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
});

// ---------------------------------------------------------------------------
// MCP Writer
// ---------------------------------------------------------------------------

describe('MCP Writer', () => {
  it('toggleMcpServer sets disabled:true on an enabled server', async () => {
    const filePath = path.join(tmpDir, '.mcp.json');
    await fileIO.writeJsonFile(filePath, {
      mcpServers: {
        'my-server': { command: 'node', args: ['server.js'] },
      },
    });

    await toggleMcpServer(configService, filePath, 'mcp-file', 'my-server', true);

    const result = await fileIO.readJsonFile<Record<string, unknown>>(filePath);
    expect(result.success).toBe(true);
    if (result.success) {
      const servers = result.data as { mcpServers: Record<string, { disabled?: boolean }> };
      expect(servers.mcpServers['my-server'].disabled).toBe(true);
    }
  });

  it('toggleMcpServer sets disabled:false on a disabled server', async () => {
    const filePath = path.join(tmpDir, '.mcp.json');
    await fileIO.writeJsonFile(filePath, {
      mcpServers: {
        'my-server': { command: 'node', args: [], disabled: true },
      },
    });

    await toggleMcpServer(configService, filePath, 'mcp-file', 'my-server', false);

    const result = await fileIO.readJsonFile<Record<string, unknown>>(filePath);
    expect(result.success).toBe(true);
    if (result.success) {
      const servers = result.data as { mcpServers: Record<string, { disabled?: boolean }> };
      expect(servers.mcpServers['my-server'].disabled).toBe(false);
    }
  });

  it('removeMcpServer deletes the server key from mcpServers', async () => {
    const filePath = path.join(tmpDir, '.mcp.json');
    await fileIO.writeJsonFile(filePath, {
      mcpServers: {
        'keep-server': { command: 'node', args: [] },
        'remove-server': { command: 'python', args: [] },
      },
    });

    await removeMcpServer(configService, filePath, 'mcp-file', 'remove-server');

    const result = await fileIO.readJsonFile<Record<string, unknown>>(filePath);
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as { mcpServers: Record<string, unknown> };
      expect(data.mcpServers['keep-server']).toBeDefined();
      expect(data.mcpServers['remove-server']).toBeUndefined();
    }
  });

  it('addMcpServer adds a new server entry', async () => {
    const filePath = path.join(tmpDir, '.mcp.json');
    await fileIO.writeJsonFile(filePath, {
      mcpServers: {
        'existing': { command: 'node', args: [] },
      },
    });

    await addMcpServer(configService, filePath, 'mcp-file', 'new-server', {
      command: 'python',
      args: ['-m', 'server'],
    });

    const result = await fileIO.readJsonFile<Record<string, unknown>>(filePath);
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as { mcpServers: Record<string, { command: string }> };
      expect(data.mcpServers['existing']).toBeDefined();
      expect(data.mcpServers['new-server']).toBeDefined();
      expect(data.mcpServers['new-server'].command).toBe('python');
    }
  });

  it('mutations preserve unknown fields', async () => {
    const filePath = path.join(tmpDir, '.mcp.json');
    await fileIO.writeJsonFile(filePath, {
      mcpServers: {
        'my-server': { command: 'node', args: [], customField: 'preserved' },
      },
      unknownTopLevel: 'should-stay',
    });

    await toggleMcpServer(configService, filePath, 'mcp-file', 'my-server', true);

    const result = await fileIO.readJsonFile<Record<string, unknown>>(filePath);
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as Record<string, unknown>;
      expect(data.unknownTopLevel).toBe('should-stay');
      const servers = data.mcpServers as Record<string, Record<string, unknown>>;
      expect(servers['my-server'].customField).toBe('preserved');
    }
  });

  it('toggleMcpServer works with claude-json schema', async () => {
    const filePath = path.join(tmpDir, 'claude.json');
    await fileIO.writeJsonFile(filePath, {
      mcpServers: {
        'server-a': { command: 'node', args: [] },
      },
      oauthTokens: { token: 'should-be-preserved' },
    });

    await toggleMcpServer(configService, filePath, 'claude-json', 'server-a', true);

    const result = await fileIO.readJsonFile<Record<string, unknown>>(filePath);
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as Record<string, unknown>;
      expect(data.oauthTokens).toEqual({ token: 'should-be-preserved' });
      const servers = data.mcpServers as Record<string, { disabled?: boolean }>;
      expect(servers['server-a'].disabled).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Settings Writer (Hooks)
// ---------------------------------------------------------------------------

describe('Settings Writer', () => {
  it('toggleHook sets disabled:true on matcher group', async () => {
    const filePath = path.join(tmpDir, 'settings.json');
    await fileIO.writeJsonFile(filePath, {
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo check' }] },
        ],
      },
    });

    await toggleHook(configService, filePath, 'PreToolUse', 0, true);

    const result = await fileIO.readJsonFile<Record<string, unknown>>(filePath);
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as { hooks: Record<string, Array<{ disabled?: boolean }>> };
      expect(data.hooks.PreToolUse[0].disabled).toBe(true);
    }
  });

  it('toggleHook sets disabled:false on a disabled matcher group', async () => {
    const filePath = path.join(tmpDir, 'settings.json');
    await fileIO.writeJsonFile(filePath, {
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo check' }], disabled: true },
        ],
      },
    });

    await toggleHook(configService, filePath, 'PreToolUse', 0, false);

    const result = await fileIO.readJsonFile<Record<string, unknown>>(filePath);
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as { hooks: Record<string, Array<{ disabled?: boolean }>> };
      expect(data.hooks.PreToolUse[0].disabled).toBe(false);
    }
  });

  it('removeHook splices matcher from array', async () => {
    const filePath = path.join(tmpDir, 'settings.json');
    await fileIO.writeJsonFile(filePath, {
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo a' }] },
          { matcher: 'Write', hooks: [{ type: 'command', command: 'echo b' }] },
        ],
      },
    });

    await removeHook(configService, filePath, 'PreToolUse', 0);

    const result = await fileIO.readJsonFile<Record<string, unknown>>(filePath);
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as { hooks: Record<string, Array<{ matcher: string }>> };
      expect(data.hooks.PreToolUse).toHaveLength(1);
      expect(data.hooks.PreToolUse[0].matcher).toBe('Write');
    }
  });

  it('removeHook removes empty event key', async () => {
    const filePath = path.join(tmpDir, 'settings.json');
    await fileIO.writeJsonFile(filePath, {
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo a' }] },
        ],
        PostToolUse: [
          { matcher: '', hooks: [{ type: 'command', command: 'echo done' }] },
        ],
      },
    });

    await removeHook(configService, filePath, 'PreToolUse', 0);

    const result = await fileIO.readJsonFile<Record<string, unknown>>(filePath);
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as { hooks: Record<string, unknown> };
      expect(data.hooks.PreToolUse).toBeUndefined();
      expect(data.hooks.PostToolUse).toBeDefined();
    }
  });

  it('addHook creates event array if missing', async () => {
    const filePath = path.join(tmpDir, 'settings.json');
    await fileIO.writeJsonFile(filePath, { hooks: {} });

    await addHook(configService, filePath, 'Notification', {
      matcher: '',
      hooks: [{ type: 'command', command: 'notify' }],
    });

    const result = await fileIO.readJsonFile<Record<string, unknown>>(filePath);
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as { hooks: Record<string, Array<{ matcher: string }>> };
      expect(data.hooks.Notification).toHaveLength(1);
      expect(data.hooks.Notification[0].matcher).toBe('');
    }
  });

  it('addHook pushes to existing event array', async () => {
    const filePath = path.join(tmpDir, 'settings.json');
    await fileIO.writeJsonFile(filePath, {
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo first' }] },
        ],
      },
    });

    await addHook(configService, filePath, 'PreToolUse', {
      matcher: 'Write',
      hooks: [{ type: 'command', command: 'echo second' }],
    });

    const result = await fileIO.readJsonFile<Record<string, unknown>>(filePath);
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as { hooks: Record<string, Array<{ matcher: string }>> };
      expect(data.hooks.PreToolUse).toHaveLength(2);
      expect(data.hooks.PreToolUse[1].matcher).toBe('Write');
    }
  });

  it('mutations preserve unknown fields in settings', async () => {
    const filePath = path.join(tmpDir, 'settings.json');
    await fileIO.writeJsonFile(filePath, {
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo a' }] },
        ],
      },
      permissions: { allow: ['Read'] },
      env: { FOO: 'bar' },
    });

    await toggleHook(configService, filePath, 'PreToolUse', 0, true);

    const result = await fileIO.readJsonFile<Record<string, unknown>>(filePath);
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as Record<string, unknown>;
      expect(data.permissions).toEqual({ allow: ['Read'] });
      expect(data.env).toEqual({ FOO: 'bar' });
    }
  });

  it('disabled field preserved through validation via passthrough', async () => {
    const filePath = path.join(tmpDir, 'settings.json');
    await fileIO.writeJsonFile(filePath, {
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo a' }], disabled: true },
        ],
      },
    });

    // Re-read and re-validate via toggleHook (which writes through ConfigService)
    await toggleHook(configService, filePath, 'PreToolUse', 0, false);

    const result = await fileIO.readJsonFile<Record<string, unknown>>(filePath);
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as { hooks: Record<string, Array<{ disabled?: boolean }>> };
      // The disabled field should be present (preserved by passthrough) and set to false
      expect(data.hooks.PreToolUse[0].disabled).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Skill Writer
// ---------------------------------------------------------------------------

describe('Skill Writer', () => {
  it('removeSkill deletes directory recursively', async () => {
    const skillDir = path.join(tmpDir, 'test-skill');
    await fs.mkdir(skillDir);
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: Test\n---\nBody');
    await fs.writeFile(path.join(skillDir, 'helper.txt'), 'extra file');

    await removeSkill(backup, skillDir);

    const exists = await fs.access(skillDir).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it('removeSkill calls backup before deletion', async () => {
    const skillDir = path.join(tmpDir, 'backup-skill');
    await fs.mkdir(skillDir);
    const skillMd = path.join(skillDir, 'SKILL.md');
    await fs.writeFile(skillMd, 'original content');

    // Use a spy to verify backup was called before deletion
    const backupSpy = vi.spyOn(backup, 'createBackup');

    await removeSkill(backup, skillDir);

    expect(backupSpy).toHaveBeenCalledWith(skillMd);
    // Directory should be gone after removal
    const dirExists = await fs.access(skillDir).then(() => true).catch(() => false);
    expect(dirExists).toBe(false);

    backupSpy.mockRestore();
  });

  it('copySkill copies directory to target', async () => {
    const sourceDir = path.join(tmpDir, 'source-skill');
    await fs.mkdir(sourceDir);
    await fs.writeFile(path.join(sourceDir, 'SKILL.md'), 'skill content');
    await fs.writeFile(path.join(sourceDir, 'extra.txt'), 'extra');

    const targetDir = path.join(tmpDir, 'target', 'copied-skill');
    await copySkill(sourceDir, targetDir);

    const skillMd = await fs.readFile(path.join(targetDir, 'SKILL.md'), 'utf-8');
    expect(skillMd).toBe('skill content');

    const extra = await fs.readFile(path.join(targetDir, 'extra.txt'), 'utf-8');
    expect(extra).toBe('extra');
  });

  it('renameSkill renames directory (disable pattern)', async () => {
    const sourceDir = path.join(tmpDir, 'my-skill');
    await fs.mkdir(sourceDir);
    await fs.writeFile(path.join(sourceDir, 'SKILL.md'), 'content');

    const targetDir = path.join(tmpDir, 'my-skill.disabled');
    await renameSkill(sourceDir, targetDir);

    const oldExists = await fs.access(sourceDir).then(() => true).catch(() => false);
    expect(oldExists).toBe(false);

    const newExists = await fs.access(targetDir).then(() => true).catch(() => false);
    expect(newExists).toBe(true);

    const content = await fs.readFile(path.join(targetDir, 'SKILL.md'), 'utf-8');
    expect(content).toBe('content');
  });
});

// ---------------------------------------------------------------------------
// Command Writer
// ---------------------------------------------------------------------------

describe('Command Writer', () => {
  it('removeCommand deletes a single file', async () => {
    const cmdFile = path.join(tmpDir, 'deploy.md');
    await fs.writeFile(cmdFile, 'deploy instructions');

    await removeCommand(backup, cmdFile, false);

    const exists = await fs.access(cmdFile).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it('removeCommand creates backup of single file before deletion', async () => {
    const cmdFile = path.join(tmpDir, 'backup-cmd.md');
    await fs.writeFile(cmdFile, 'original command');

    await removeCommand(backup, cmdFile, false);

    const backupPath = `${cmdFile}.bak.1`;
    const backupExists = await fs.access(backupPath).then(() => true).catch(() => false);
    expect(backupExists).toBe(true);

    const content = await fs.readFile(backupPath, 'utf-8');
    expect(content).toBe('original command');
  });

  it('removeCommand deletes directory recursively', async () => {
    const cmdDir = path.join(tmpDir, 'complex-cmd');
    await fs.mkdir(cmdDir);
    await fs.writeFile(path.join(cmdDir, 'main.md'), 'main');
    await fs.writeFile(path.join(cmdDir, 'helper.md'), 'helper');

    await removeCommand(backup, cmdDir, true);

    const exists = await fs.access(cmdDir).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it('copyCommand copies single file to target', async () => {
    const source = path.join(tmpDir, 'source.md');
    await fs.writeFile(source, 'command content');

    const target = path.join(tmpDir, 'target', 'copied.md');
    await copyCommand(source, target, false);

    const content = await fs.readFile(target, 'utf-8');
    expect(content).toBe('command content');
  });

  it('copyCommand copies directory to target', async () => {
    const sourceDir = path.join(tmpDir, 'source-cmd');
    await fs.mkdir(sourceDir);
    await fs.writeFile(path.join(sourceDir, 'main.md'), 'main content');
    await fs.writeFile(path.join(sourceDir, 'sub.md'), 'sub content');

    const targetDir = path.join(tmpDir, 'target-cmd');
    await copyCommand(sourceDir, targetDir, true);

    const main = await fs.readFile(path.join(targetDir, 'main.md'), 'utf-8');
    expect(main).toBe('main content');

    const sub = await fs.readFile(path.join(targetDir, 'sub.md'), 'utf-8');
    expect(sub).toBe('sub content');
  });

  it('renameCommand renames file (disable pattern)', async () => {
    const source = path.join(tmpDir, 'my-cmd.md');
    await fs.writeFile(source, 'content');

    const target = path.join(tmpDir, 'my-cmd.md.disabled');
    await renameCommand(source, target);

    const oldExists = await fs.access(source).then(() => true).catch(() => false);
    expect(oldExists).toBe(false);

    const newExists = await fs.access(target).then(() => true).catch(() => false);
    expect(newExists).toBe(true);
  });
});
