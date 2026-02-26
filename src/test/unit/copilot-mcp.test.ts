import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileIOService } from '../../services/fileio.service.js';
import { SchemaService } from '../../services/schema.service.js';
import { BackupService } from '../../services/backup.service.js';
import { AdapterRegistry } from '../../adapters/adapter.registry.js';
import { ConfigService } from '../../services/config.service.js';
import { copilotSchemas } from '../../adapters/copilot/schemas.js';
import { parseCopilotMcpFile } from '../../adapters/copilot/parsers/mcp.parser.js';
import { addCopilotMcpServer, removeCopilotMcpServer } from '../../adapters/copilot/writers/mcp.writer.js';
import { ConfigScope, ToolStatus, ToolType } from '../../types/enums.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;
let fileIO: FileIOService;
let schemaService: SchemaService;
let backup: BackupService;
let registry: AdapterRegistry;
let configService: ConfigService;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-mcp-test-'));
  fileIO = new FileIOService();
  schemaService = new SchemaService();
  schemaService.registerSchemas(copilotSchemas);
  backup = new BackupService();
  registry = new AdapterRegistry();
  configService = new ConfigService(fileIO, backup, schemaService, registry);
});

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
});

// ---------------------------------------------------------------------------
// parseCopilotMcpFile — parser tests
// ---------------------------------------------------------------------------

describe('parseCopilotMcpFile', () => {
  it('returns NormalizedTool[] from a valid mcp.json with servers key', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    await fs.writeFile(filePath, JSON.stringify({
      servers: {
        myServer: {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
          env: { PORT: '3000' },
        },
      },
    }));

    const tools = await parseCopilotMcpFile(fileIO, schemaService, filePath, ConfigScope.User);

    expect(tools).toHaveLength(1);
    expect(tools[0].id).toBe('mcp:user:myServer');
    expect(tools[0].type).toBe(ToolType.McpServer);
    expect(tools[0].name).toBe('myServer');
    expect(tools[0].scope).toBe(ConfigScope.User);
    expect(tools[0].status).toBe(ToolStatus.Enabled);
    expect(tools[0].metadata.command).toBe('node');
    expect(tools[0].metadata.args).toEqual(['server.js']);
    expect(tools[0].metadata.env).toEqual({ PORT: '3000' });
    expect(tools[0].metadata.transport).toBe('stdio');
  });

  it('returns [] for a missing file (not an error — file absent is valid)', async () => {
    const filePath = path.join(tmpDir, 'nonexistent.json');

    const tools = await parseCopilotMcpFile(fileIO, schemaService, filePath, ConfigScope.User);

    expect(tools).toEqual([]);
  });

  it('returns a ToolStatus.Error tool for malformed JSON', async () => {
    const filePath = path.join(tmpDir, 'bad.json');
    await fs.writeFile(filePath, 'INVALID JSON {{{');

    const tools = await parseCopilotMcpFile(fileIO, schemaService, filePath, ConfigScope.User);

    expect(tools).toHaveLength(1);
    expect(tools[0].status).toBe(ToolStatus.Error);
    expect(tools[0].statusDetail).toBeDefined();
  });

  // Pitfall 1 regression test: wrong key silently returns empty (not an error)
  it('returns zero tools if the file has mcpServers key instead of servers (wrong key — not an error)', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    await fs.writeFile(filePath, JSON.stringify({
      mcpServers: {
        myServer: {
          command: 'node',
          args: [],
        },
      },
    }));

    const tools = await parseCopilotMcpFile(fileIO, schemaService, filePath, ConfigScope.User);

    // mcpServers key is unknown to CopilotMcpFileSchema; servers defaults to {}
    // Result: empty array (not an error — Zod passthrough ignores unknown keys)
    expect(tools).toEqual([]);
  });

  it('returns all servers from file with multiple entries, all ToolStatus.Enabled', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    await fs.writeFile(filePath, JSON.stringify({
      servers: {
        serverA: { type: 'stdio', command: 'node', args: ['a.js'] },
        serverB: { type: 'http', url: 'http://localhost:4000' },
        serverC: { command: 'python', args: ['-m', 'myserver'] },
      },
    }));

    const tools = await parseCopilotMcpFile(fileIO, schemaService, filePath, ConfigScope.Project);

    expect(tools).toHaveLength(3);
    for (const tool of tools) {
      expect(tool.status).toBe(ToolStatus.Enabled);
      expect(tool.scope).toBe(ConfigScope.Project);
    }
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual(['serverA', 'serverB', 'serverC']);
  });

  it('returns tool with correct id format mcp:{scope}:{name}', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    await fs.writeFile(filePath, JSON.stringify({
      servers: {
        'my-mcp-tool': { command: 'npx', args: ['my-mcp'] },
      },
    }));

    const tools = await parseCopilotMcpFile(fileIO, schemaService, filePath, ConfigScope.Project);

    expect(tools[0].id).toBe('mcp:project:my-mcp-tool');
  });

  it('returns empty array for a valid file with empty servers record', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    await fs.writeFile(filePath, JSON.stringify({ servers: {} }));

    const tools = await parseCopilotMcpFile(fileIO, schemaService, filePath, ConfigScope.User);

    expect(tools).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// addCopilotMcpServer — writer tests
// ---------------------------------------------------------------------------

describe('addCopilotMcpServer', () => {
  it('writes a new server entry under servers key when file does not exist', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');

    await addCopilotMcpServer(configService, filePath, 'myServer', {
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
    });

    const result = await fileIO.readJsonFile<Record<string, unknown>>(filePath);
    expect(result.success).toBe(true);
    if (result.success && result.data) {
      const data = result.data as { servers: Record<string, { command: string }> };
      expect(data.servers).toBeDefined();
      expect(data.servers['myServer']).toBeDefined();
      expect(data.servers['myServer'].command).toBe('node');
    }
  });

  it('adds server to file with existing servers, both remain intact', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    await fs.writeFile(filePath, JSON.stringify({
      servers: {
        existingServer: { command: 'python', args: ['-m', 'existing'] },
      },
    }));

    await addCopilotMcpServer(configService, filePath, 'newServer', {
      type: 'stdio',
      command: 'node',
      args: ['new.js'],
    });

    const result = await fileIO.readJsonFile<Record<string, unknown>>(filePath);
    expect(result.success).toBe(true);
    if (result.success && result.data) {
      const data = result.data as { servers: Record<string, unknown> };
      expect(data.servers['existingServer']).toBeDefined();
      expect(data.servers['newServer']).toBeDefined();
    }
  });

  // Pitfall 2 regression test: inputs array must be preserved on write-back
  it('preserves the inputs array unchanged after adding a server', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    const inputs = [
      { type: 'promptString', id: 'github-token', description: 'GitHub Personal Access Token', password: true },
    ];
    await fs.writeFile(filePath, JSON.stringify({
      servers: {
        existingServer: { command: 'node', args: [] },
      },
      inputs,
    }));

    await addCopilotMcpServer(configService, filePath, 'anotherServer', {
      type: 'stdio',
      command: 'python',
      args: [],
    });

    const result = await fileIO.readJsonFile<Record<string, unknown>>(filePath);
    expect(result.success).toBe(true);
    if (result.success && result.data) {
      const data = result.data as {
        servers: Record<string, unknown>;
        inputs: Array<{ id: string }>;
      };
      // Both servers present
      expect(data.servers['existingServer']).toBeDefined();
      expect(data.servers['anotherServer']).toBeDefined();
      // inputs array preserved exactly
      expect(data.inputs).toBeDefined();
      expect(data.inputs).toHaveLength(1);
      expect(data.inputs[0].id).toBe('github-token');
    }
  });

  it('overwrites existing entry when adding server with same name', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    await fs.writeFile(filePath, JSON.stringify({
      servers: {
        myServer: { command: 'node', args: ['old.js'] },
      },
    }));

    await addCopilotMcpServer(configService, filePath, 'myServer', {
      type: 'stdio',
      command: 'node',
      args: ['new.js'],
    });

    const result = await fileIO.readJsonFile<Record<string, unknown>>(filePath);
    expect(result.success).toBe(true);
    if (result.success && result.data) {
      const data = result.data as { servers: Record<string, { args: string[] }> };
      expect(data.servers['myServer'].args).toEqual(['new.js']);
    }
  });
});

// ---------------------------------------------------------------------------
// removeCopilotMcpServer — writer tests
// ---------------------------------------------------------------------------

describe('removeCopilotMcpServer', () => {
  it('deletes the named entry from servers and preserves remaining entries and inputs', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    const inputs = [
      { type: 'promptString', id: 'api-key', description: 'API Key', password: true },
    ];
    await fs.writeFile(filePath, JSON.stringify({
      servers: {
        keepServer: { command: 'node', args: ['keep.js'] },
        removeServer: { command: 'python', args: ['remove.py'] },
      },
      inputs,
    }));

    await removeCopilotMcpServer(configService, filePath, 'removeServer');

    const result = await fileIO.readJsonFile<Record<string, unknown>>(filePath);
    expect(result.success).toBe(true);
    if (result.success && result.data) {
      const data = result.data as {
        servers: Record<string, unknown>;
        inputs: Array<{ id: string }>;
      };
      // Removed server is gone
      expect(data.servers['removeServer']).toBeUndefined();
      // Remaining server intact
      expect(data.servers['keepServer']).toBeDefined();
      // inputs preserved
      expect(data.inputs).toBeDefined();
      expect(data.inputs).toHaveLength(1);
      expect(data.inputs[0].id).toBe('api-key');
    }
  });

  it('does not error when removing a non-existent server name (file unchanged)', async () => {
    const filePath = path.join(tmpDir, 'mcp.json');
    await fs.writeFile(filePath, JSON.stringify({
      servers: {
        existingServer: { command: 'node', args: [] },
      },
    }));

    // Should not throw
    await expect(
      removeCopilotMcpServer(configService, filePath, 'nonExistentServer'),
    ).resolves.toBeUndefined();

    const result = await fileIO.readJsonFile<Record<string, unknown>>(filePath);
    expect(result.success).toBe(true);
    if (result.success && result.data) {
      const data = result.data as { servers: Record<string, unknown> };
      expect(data.servers['existingServer']).toBeDefined();
    }
  });
});
