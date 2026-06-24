import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileIOService } from '../../services/fileio.service.js';
import { SchemaService } from '../../services/schema.service.js';
import { BackupService } from '../../services/backup.service.js';
import { ConfigService } from '../../services/config.service.js';
import { ProviderRegistry } from '../../providers/provider.registry.js';
import { PiProvider } from '../../providers/pi/pi.provider.js';
import { piSchemas } from '../../providers/pi/schemas.js';
import { PiPaths } from '../../providers/pi/paths.js';
import { claudeCodeSchemas } from '../../providers/claude-code/schemas.js';
import { ToolType, ConfigScope, ToolStatus } from '../../types/enums.js';
import { ProviderScopeError } from '../../types/provider-errors.js';
import { createMockFileIO } from './helpers/mock-fileio.js';
import type { NormalizedTool } from '../../types/config.js';

/**
 * Build a Pi provider wired to real write services so MCP/skill round-trips
 * touch real tmp files. Project scope is rooted at `workspaceRoot`, which lets
 * us exercise .pi/mcp.json without writing under the real home directory.
 */
function makePiProvider(workspaceRoot: string): PiProvider {
  const fileIO = new FileIOService();
  const schemaService = new SchemaService();
  schemaService.registerSchemas(claudeCodeSchemas);
  schemaService.registerSchemas(piSchemas);
  const backup = new BackupService(fileIO);
  const configService = new ConfigService(fileIO, backup, schemaService, new ProviderRegistry());
  const provider = new PiProvider(fileIO, schemaService, workspaceRoot);
  provider.setWriteServices(configService, backup);
  return provider;
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-provider-test-'));
});

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
});

// ---------------------------------------------------------------------------
// Identity & capabilities
// ---------------------------------------------------------------------------

describe('PiProvider identity', () => {
  it('declares the expected identity and supported tool types', () => {
    const provider = new PiProvider(new FileIOService(), new SchemaService());
    expect(provider.id).toBe('pi');
    expect(provider.displayName).toBe('Pi');
    expect(provider.supportedToolTypes).toEqual(
      new Set([ToolType.Skill, ToolType.McpServer, ToolType.CustomPrompt]),
    );
    // MCP has no file-level disable, custom prompts have no disable -> only skills toggle.
    expect(provider.toggleableToolTypes).toEqual(new Set([ToolType.Skill]));
    expect(provider.movableToolTypes).toEqual(new Set([ToolType.Skill, ToolType.McpServer]));
    expect(provider.capabilities).toEqual({
      mcpEnvVars: false,
      mcpServerToolToggle: false,
      customPromptFileInstall: true,
    });
  });

  it('reports MCP shape: mcpServers container, JSON, no disable field', () => {
    const provider = new PiProvider(new FileIOService(), new SchemaService());
    expect(provider.getMcpContainerKey()).toBe('mcpServers');
    expect(provider.getMcpConfigFormat()).toBe('json');
    expect(provider.getMcpDisableField()).toBeUndefined();
    expect(provider.getMcpSchemaKey(ConfigScope.User)).toBe('pi-mcp-file');
  });
});

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

describe('PiProvider detect', () => {
  it('detects when ~/.pi/agent/ exists', async () => {
    const fileIO = createMockFileIO({
      async fileExists(p: string) {
        return p === PiPaths.userPiAgentDir;
      },
    });
    const provider = new PiProvider(fileIO, new SchemaService());
    expect(await provider.detect()).toBe(true);
  });

  it('detects when only ~/.pi/agent/mcp.json exists', async () => {
    const fileIO = createMockFileIO({
      async fileExists(p: string) {
        return p === PiPaths.userMcpJson;
      },
    });
    const provider = new PiProvider(fileIO, new SchemaService());
    expect(await provider.detect()).toBe(true);
  });

  it('returns false when no Pi markers exist', async () => {
    const fileIO = createMockFileIO({ async fileExists() { return false; } });
    const provider = new PiProvider(fileIO, new SchemaService());
    expect(await provider.detect()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe('PiProvider path resolution', () => {
  it('resolves user MCP / skills paths and throws for unsupported scopes', () => {
    const provider = new PiProvider(new FileIOService(), new SchemaService(), '/ws');
    expect(provider.getMcpFilePath(ConfigScope.User)).toBe(PiPaths.userMcpJson);
    expect(provider.getMcpFilePath(ConfigScope.Project)).toBe(PiPaths.projectMcpJson('/ws'));
    expect(provider.getSkillsDir(ConfigScope.User)).toBe(PiPaths.userSkillsDir);
    expect(provider.getSkillsDir(ConfigScope.Project)).toBe(PiPaths.projectSkillsDir('/ws'));
    expect(() => provider.getMcpFilePath(ConfigScope.Managed)).toThrow(ProviderScopeError);
    expect(() => provider.getCommandsDir(ConfigScope.User)).toThrow(ProviderScopeError);
    expect(() => provider.getSettingsPath(ConfigScope.User)).toThrow(ProviderScopeError);
  });

  it('throws for project paths when no workspace is open', () => {
    const provider = new PiProvider(new FileIOService(), new SchemaService());
    expect(() => provider.getMcpFilePath(ConfigScope.Project)).toThrow(ProviderScopeError);
    expect(() => provider.getSkillsDir(ConfigScope.Project)).toThrow(ProviderScopeError);
  });

  it('watch paths cover user and project resources', () => {
    const provider = new PiProvider(new FileIOService(), new SchemaService(), '/ws');
    expect(provider.getWatchPaths(ConfigScope.User)).toEqual([
      PiPaths.userSettingsJson,
      PiPaths.userSkillsDir,
      PiPaths.userPromptsDir,
      PiPaths.userMcpJson,
    ]);
    expect(provider.getWatchPaths(ConfigScope.Project)).toEqual([
      PiPaths.projectMcpJson('/ws'),
      PiPaths.projectSkillsDir('/ws'),
      PiPaths.projectPromptsDir('/ws'),
    ]);
    expect(provider.getWatchPaths(ConfigScope.Managed)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MCP read / write / remove round-trip (Project scope -> tmp .pi/mcp.json)
// ---------------------------------------------------------------------------

describe('PiProvider MCP read/write', () => {
  it('installs, reads back, and removes an MCP server', async () => {
    const provider = makePiProvider(tmpDir);

    await provider.installMcpServer(ConfigScope.Project, 'fs', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      transport: 'stdio',
      lifecycle: 'lazy',
    });

    // The file lands at {root}/.pi/mcp.json under the mcpServers key.
    const raw = await fs.readFile(PiPaths.projectMcpJson(tmpDir), 'utf-8');
    expect(JSON.parse(raw).mcpServers.fs.command).toBe('npx');

    const tools = await provider.readTools(ToolType.McpServer, ConfigScope.Project);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('fs');
    expect(tools[0].id).toBe(`mcp:pi:${ConfigScope.Project}:fs`);
    // Pi MCP has no disable field -> always Enabled.
    expect(tools[0].status).toBe(ToolStatus.Enabled);
    expect(tools[0].metadata.command).toBe('npx');
    expect(tools[0].metadata.lifecycle).toBe('lazy');

    await provider.removeTool(tools[0]);
    const after = await provider.readTools(ToolType.McpServer, ConfigScope.Project);
    expect(after).toHaveLength(0);
  });

  it('preserves the top-level settings block on write-back', async () => {
    const mcpPath = PiPaths.projectMcpJson(tmpDir);
    await fs.mkdir(path.dirname(mcpPath), { recursive: true });
    await fs.writeFile(mcpPath, JSON.stringify({ settings: { toolPrefix: 'mcp' }, mcpServers: {} }));

    const provider = makePiProvider(tmpDir);
    await provider.installMcpServer(ConfigScope.Project, 'api', { url: 'https://example.com/mcp' });

    const data = JSON.parse(await fs.readFile(mcpPath, 'utf-8'));
    expect(data.settings).toEqual({ toolPrefix: 'mcp' });
    expect(data.mcpServers.api.url).toBe('https://example.com/mcp');
  });

  it('toggleTool refuses MCP servers (no file-level disable field)', async () => {
    const provider = makePiProvider(tmpDir);
    const fakeMcp: NormalizedTool = {
      id: 'mcp:pi:project:fs',
      type: ToolType.McpServer,
      name: 'fs',
      scope: ConfigScope.Project,
      status: ToolStatus.Enabled,
      source: { filePath: PiPaths.projectMcpJson(tmpDir) },
      metadata: {},
    };
    await expect(provider.toggleTool(fakeMcp)).rejects.toThrow(/only skills can be toggled/);
  });
});

// ---------------------------------------------------------------------------
// Skill read + toggle round-trip
// ---------------------------------------------------------------------------

describe('PiProvider skills', () => {
  it('reads a skill then disables it by renaming SKILL.md', async () => {
    const skillDir = path.join(PiPaths.projectSkillsDir(tmpDir), 'greeter');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: greeter\ndescription: Greets the user warmly\n---\nBody',
    );

    const provider = makePiProvider(tmpDir);
    const before = await provider.readTools(ToolType.Skill, ConfigScope.Project);
    expect(before).toHaveLength(1);
    expect(before[0].name).toBe('greeter');
    expect(before[0].status).toBe(ToolStatus.Enabled);

    await provider.toggleTool(before[0]);
    expect(await fileExists(path.join(skillDir, 'SKILL.md.disabled'))).toBe(true);

    const after = await provider.readTools(ToolType.Skill, ConfigScope.Project);
    expect(after[0].status).toBe(ToolStatus.Disabled);
  });
});

// ---------------------------------------------------------------------------
// Custom prompt (prompt template) read
// ---------------------------------------------------------------------------

describe('PiProvider custom prompts', () => {
  it('reads .md prompt templates from both user-style and project dirs', async () => {
    const promptsDir = PiPaths.projectPromptsDir(tmpDir);
    await fs.mkdir(promptsDir, { recursive: true });
    await fs.writeFile(
      path.join(promptsDir, 'review.md'),
      '---\ndescription: Review the diff\nargument-hint: <path>\n---\nReview $1',
    );

    const provider = makePiProvider(tmpDir);
    const prompts = await provider.readTools(ToolType.CustomPrompt, ConfigScope.Project);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].name).toBe('review');
    expect(prompts[0].type).toBe(ToolType.CustomPrompt);
    expect(prompts[0].description).toBe('Review the diff');
    expect(prompts[0].metadata.argumentHint).toBe('<path>');
  });
});

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
