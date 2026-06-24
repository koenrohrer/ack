import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileIOService } from '../../services/fileio.service.js';
import { SchemaService } from '../../services/schema.service.js';
import { BackupService } from '../../services/backup.service.js';
import { ConfigService } from '../../services/config.service.js';
import { ProviderRegistry } from '../../providers/provider.registry.js';
import { HermesProvider } from '../../providers/hermes/hermes.provider.js';
import { hermesSchemas } from '../../providers/hermes/schemas.js';
import { HermesPaths } from '../../providers/hermes/paths.js';
import { claudeCodeSchemas } from '../../providers/claude-code/schemas.js';
import { ToolType, ConfigScope, ToolStatus } from '../../types/enums.js';
import { ProviderScopeError } from '../../types/provider-errors.js';
import { createMockFileIO } from './helpers/mock-fileio.js';
import type { NormalizedTool } from '../../types/config.js';

/**
 * Build a Hermes provider with real write services. Hermes is user-scoped, so
 * tests redirect its home to a tmp dir via $HERMES_HOME (honored by HermesPaths)
 * rather than writing under the real ~/.hermes.
 */
function makeHermesProvider(): HermesProvider {
  const fileIO = new FileIOService();
  const schemaService = new SchemaService();
  schemaService.registerSchemas(claudeCodeSchemas);
  schemaService.registerSchemas(hermesSchemas);
  const backup = new BackupService(fileIO);
  const configService = new ConfigService(fileIO, backup, schemaService, new ProviderRegistry());
  const provider = new HermesProvider(fileIO, schemaService);
  provider.setWriteServices(configService, backup);
  return provider;
}

let tmpHome: string;
let tmpManaged: string;
let savedHome: string | undefined;
let savedManaged: string | undefined;

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-home-'));
  tmpManaged = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-managed-'));
  savedHome = process.env.HERMES_HOME;
  savedManaged = process.env.HERMES_MANAGED_DIR;
  process.env.HERMES_HOME = tmpHome;
  process.env.HERMES_MANAGED_DIR = tmpManaged;
});

afterEach(async () => {
  if (savedHome === undefined) delete process.env.HERMES_HOME;
  else process.env.HERMES_HOME = savedHome;
  if (savedManaged === undefined) delete process.env.HERMES_MANAGED_DIR;
  else process.env.HERMES_MANAGED_DIR = savedManaged;
  await fs.rm(tmpHome, { recursive: true, force: true });
  await fs.rm(tmpManaged, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Identity & capabilities
// ---------------------------------------------------------------------------

describe('HermesProvider identity', () => {
  it('declares the expected identity and supported tool types', () => {
    const provider = makeHermesProvider();
    expect(provider.id).toBe('hermes');
    expect(provider.displayName).toBe('Hermes');
    expect(provider.supportedToolTypes).toEqual(
      new Set([ToolType.McpServer, ToolType.Skill, ToolType.CustomPrompt]),
    );
    expect(provider.toggleableToolTypes).toEqual(new Set([ToolType.McpServer, ToolType.Skill]));
    // No project scope -> nothing moves between scopes.
    expect(provider.movableToolTypes).toEqual(new Set());
    expect(provider.capabilities).toEqual({
      mcpEnvVars: true,
      mcpServerToolToggle: false,
      customPromptFileInstall: false,
    });
  });

  it('reports MCP shape: mcp_servers container, YAML, enabled:false disable', () => {
    const provider = makeHermesProvider();
    expect(provider.getMcpContainerKey()).toBe('mcp_servers');
    expect(provider.getMcpConfigFormat()).toBe('yaml');
    expect(provider.getMcpDisableField()).toEqual({ field: 'enabled', disabledValue: false });
    expect(provider.getMcpSchemaKey(ConfigScope.User)).toBe('hermes-config');
  });
});

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

describe('HermesProvider detect', () => {
  it('detects when the home dir exists', async () => {
    const fileIO = createMockFileIO({
      async fileExists(p: string) {
        return p === HermesPaths.userHermesDir;
      },
    });
    const provider = new HermesProvider(fileIO, new SchemaService());
    expect(await provider.detect()).toBe(true);
  });

  it('returns false when no Hermes markers exist', async () => {
    const fileIO = createMockFileIO({ async fileExists() { return false; } });
    const provider = new HermesProvider(fileIO, new SchemaService());
    expect(await provider.detect()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe('HermesProvider path resolution', () => {
  it('honors $HERMES_HOME / $HERMES_MANAGED_DIR and throws for unsupported scopes', () => {
    const provider = makeHermesProvider();
    expect(provider.getMcpFilePath(ConfigScope.User)).toBe(path.join(tmpHome, 'config.yaml'));
    expect(provider.getMcpFilePath(ConfigScope.Managed)).toBe(path.join(tmpManaged, 'config.yaml'));
    expect(provider.getSkillsDir(ConfigScope.User)).toBe(path.join(tmpHome, 'skills'));
    expect(() => provider.getMcpFilePath(ConfigScope.Project)).toThrow(ProviderScopeError);
    expect(() => provider.getSkillsDir(ConfigScope.Project)).toThrow(ProviderScopeError);
    expect(() => provider.getCommandsDir(ConfigScope.User)).toThrow(ProviderScopeError);
    expect(() => provider.getSettingsPath(ConfigScope.User)).toThrow(ProviderScopeError);
  });

  it('watches user (config/skills/SOUL) and managed (config) paths', () => {
    const provider = makeHermesProvider();
    expect(provider.getWatchPaths(ConfigScope.User)).toEqual([
      path.join(tmpHome, 'config.yaml'),
      path.join(tmpHome, 'skills'),
      path.join(tmpHome, 'SOUL.md'),
    ]);
    expect(provider.getWatchPaths(ConfigScope.Managed)).toEqual([path.join(tmpManaged, 'config.yaml')]);
    expect(provider.getWatchPaths(ConfigScope.Project)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MCP read / write / toggle / env round-trip (User scope -> tmp config.yaml)
// ---------------------------------------------------------------------------

describe('HermesProvider MCP read/write/toggle', () => {
  it('installs, reads, toggles, and removes an MCP server in YAML', async () => {
    const provider = makeHermesProvider();
    const configYaml = path.join(tmpHome, 'config.yaml');

    await provider.installMcpServer(ConfigScope.User, 'github', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
    });

    // Written as YAML under the mcp_servers map.
    const raw = await fs.readFile(configYaml, 'utf-8');
    expect(raw).toContain('mcp_servers:');
    expect(raw).toContain('github:');

    let tools = await provider.readTools(ToolType.McpServer, ConfigScope.User);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('github');
    expect(tools[0].id).toBe(`mcp:hermes:${ConfigScope.User}:github`);
    expect(tools[0].status).toBe(ToolStatus.Enabled);
    expect(tools[0].metadata.command).toBe('npx');

    // Disable -> writes enabled: false; re-read shows Disabled.
    await provider.toggleTool(tools[0]);
    tools = await provider.readTools(ToolType.McpServer, ConfigScope.User);
    expect(tools[0].status).toBe(ToolStatus.Disabled);

    // Enable -> removes the enabled key; re-read shows Enabled.
    await provider.toggleTool(tools[0]);
    tools = await provider.readTools(ToolType.McpServer, ConfigScope.User);
    expect(tools[0].status).toBe(ToolStatus.Enabled);

    await provider.removeTool(tools[0]);
    expect(await provider.readTools(ToolType.McpServer, ConfigScope.User)).toHaveLength(0);
  });

  it('treats a truthy "enabled" string as enabled and false as disabled', async () => {
    const configYaml = path.join(tmpHome, 'config.yaml');
    await fs.writeFile(
      configYaml,
      'mcp_servers:\n  on_str:\n    command: a\n    enabled: "yes"\n  off_bool:\n    command: b\n    enabled: false\n',
    );
    const provider = makeHermesProvider();
    const tools = await provider.readTools(ToolType.McpServer, ConfigScope.User);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.status]));
    expect(byName['on_str']).toBe(ToolStatus.Enabled);
    expect(byName['off_bool']).toBe(ToolStatus.Disabled);
  });

  it('sets and removes an env var on a server', async () => {
    const provider = makeHermesProvider();
    const configYaml = path.join(tmpHome, 'config.yaml');
    await provider.installMcpServer(ConfigScope.User, 'github', { command: 'npx', args: [] });
    const [server] = await provider.readTools(ToolType.McpServer, ConfigScope.User);

    await provider.setMcpEnvVar(server, 'TOKEN', 'abc');
    let data = await provider.readTools(ToolType.McpServer, ConfigScope.User);
    expect((data[0].metadata.env as Record<string, string>).TOKEN).toBe('abc');

    await provider.removeMcpEnvVar(server, 'TOKEN');
    data = await provider.readTools(ToolType.McpServer, ConfigScope.User);
    expect(data[0].metadata.env).toEqual({});
  });

  it('reads managed-scope MCP servers from the managed config.yaml', async () => {
    await fs.writeFile(
      path.join(tmpManaged, 'config.yaml'),
      'mcp_servers:\n  pinned:\n    command: managed-bin\n',
    );
    const provider = makeHermesProvider();
    const tools = await provider.readTools(ToolType.McpServer, ConfigScope.Managed);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('pinned');
    expect(tools[0].scope).toBe(ConfigScope.Managed);
  });
});

// ---------------------------------------------------------------------------
// Managed scope is read-only
// ---------------------------------------------------------------------------

describe('HermesProvider managed scope', () => {
  it('refuses writes/removes/toggles/installs in managed scope', async () => {
    const provider = makeHermesProvider();
    const managedTool: NormalizedTool = {
      id: 'mcp:hermes:managed:pinned',
      type: ToolType.McpServer,
      name: 'pinned',
      scope: ConfigScope.Managed,
      status: ToolStatus.Enabled,
      source: { filePath: path.join(tmpManaged, 'config.yaml') },
      metadata: {},
    };
    await expect(provider.writeTool(managedTool, ConfigScope.Managed)).rejects.toThrow(/read-only/);
    await expect(provider.removeTool(managedTool)).rejects.toThrow(/read-only/);
    await expect(provider.toggleTool(managedTool)).rejects.toThrow(/read-only/);
    await expect(
      provider.installMcpServer(ConfigScope.Managed, 'x', { command: 'y' }),
    ).rejects.toThrow(/read-only/);
  });
});

// ---------------------------------------------------------------------------
// Skill + SOUL.md custom prompt
// ---------------------------------------------------------------------------

describe('HermesProvider skills and SOUL.md', () => {
  it('reads a skill then disables it by renaming SKILL.md', async () => {
    const skillDir = path.join(tmpHome, 'skills', 'writer');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: writer\ndescription: Writes prose\n---\nBody',
    );

    const provider = makeHermesProvider();
    const before = await provider.readTools(ToolType.Skill, ConfigScope.User);
    expect(before).toHaveLength(1);
    expect(before[0].status).toBe(ToolStatus.Enabled);

    await provider.toggleTool(before[0]);
    const after = await provider.readTools(ToolType.Skill, ConfigScope.User);
    expect(after[0].status).toBe(ToolStatus.Disabled);
  });

  it('reads SOUL.md as a single custom prompt and removes it', async () => {
    const soulPath = path.join(tmpHome, 'SOUL.md');
    await fs.writeFile(soulPath, 'You are a meticulous engineer.');

    const provider = makeHermesProvider();
    const prompts = await provider.readTools(ToolType.CustomPrompt, ConfigScope.User);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].name).toBe('SOUL');
    expect(prompts[0].type).toBe(ToolType.CustomPrompt);
    expect(prompts[0].metadata.body).toContain('meticulous');

    await provider.removeTool(prompts[0]);
    expect(await provider.readTools(ToolType.CustomPrompt, ConfigScope.User)).toHaveLength(0);
  });
});
