import { describe, expect, it } from 'vitest';
import { makeMcpErrorTool } from '../../adapters/shared/mcp-error-tool.js';
import { extractMcpServers } from '../../adapters/shared/mcp-extract.js';
import { ToolType, ConfigScope, ToolStatus } from '../../types/enums.js';

describe('makeMcpErrorTool', () => {
  it('builds the Claude/Copilot-style error tool (no id segment)', () => {
    const tool = makeMcpErrorTool('/path/to/.mcp.json', ConfigScope.User, 'boom');
    expect(tool).toEqual({
      id: `mcp-error:${ConfigScope.User}:/path/to/.mcp.json`,
      type: ToolType.McpServer,
      name: 'MCP Config Error',
      scope: ConfigScope.User,
      status: ToolStatus.Error,
      statusDetail: 'boom',
      source: { filePath: '/path/to/.mcp.json' },
      metadata: {},
    });
  });

  it('builds the Codex-style error tool with id segment and custom name', () => {
    const tool = makeMcpErrorTool('/c/config.toml', ConfigScope.Project, 'bad toml', {
      idSegment: 'codex:',
      name: 'Codex Config Error',
    });
    expect(tool).toEqual({
      id: `mcp-error:codex:${ConfigScope.Project}:/c/config.toml`,
      type: ToolType.McpServer,
      name: 'Codex Config Error',
      scope: ConfigScope.Project,
      status: ToolStatus.Error,
      statusDetail: 'bad toml',
      source: { filePath: '/c/config.toml' },
      metadata: {},
    });
  });
});

describe('extractMcpServers', () => {
  it('builds NormalizedTools with the default id format and per-server mapping', () => {
    const tools = extractMcpServers(
      { github: { command: 'node' }, broken: { command: 'x' } },
      ConfigScope.User,
      '/.mcp.json',
      (config, name) => ({
        status: name === 'broken' ? ToolStatus.Disabled : ToolStatus.Enabled,
        metadata: { command: config.command },
      }),
    );

    expect(tools).toEqual([
      {
        id: `mcp:${ConfigScope.User}:github`,
        type: ToolType.McpServer,
        name: 'github',
        scope: ConfigScope.User,
        status: ToolStatus.Enabled,
        source: { filePath: '/.mcp.json' },
        metadata: { command: 'node' },
      },
      {
        id: `mcp:${ConfigScope.User}:broken`,
        type: ToolType.McpServer,
        name: 'broken',
        scope: ConfigScope.User,
        status: ToolStatus.Disabled,
        source: { filePath: '/.mcp.json' },
        metadata: { command: 'x' },
      },
    ]);
  });

  it('applies an id segment for adapters that need a distinct namespace', () => {
    const tools = extractMcpServers(
      { srv: {} },
      ConfigScope.Project,
      '/config.toml',
      () => ({ status: ToolStatus.Enabled, metadata: {} }),
      'codex:',
    );

    expect(tools[0].id).toBe(`mcp:codex:${ConfigScope.Project}:srv`);
  });

  it('returns an empty array for no servers', () => {
    expect(
      extractMcpServers({}, ConfigScope.User, '/x', () => ({
        status: ToolStatus.Enabled,
        metadata: {},
      })),
    ).toEqual([]);
  });
});
