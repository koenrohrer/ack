import { describe, it, expect } from 'vitest';
import { getJsonPath, getRouteForTool } from '../../views/tool-tree/tool-tree.command-utils.js';
import { ToolType } from '../../types/enums.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(overrides: {
  type: ToolType;
  name?: string;
  metadata?: Record<string, unknown>;
  source?: { filePath: string };
}) {
  return {
    type: overrides.type,
    name: overrides.name ?? 'test-tool',
    metadata: overrides.metadata ?? {},
    source: overrides.source ?? { filePath: '' },
  };
}

// ---------------------------------------------------------------------------
// getRouteForTool
// ---------------------------------------------------------------------------

describe('getRouteForTool', () => {
  it('routes Skill to markdown', () => {
    expect(getRouteForTool({ type: ToolType.Skill })).toBe('markdown');
  });

  it('routes Command to markdown', () => {
    expect(getRouteForTool({ type: ToolType.Command })).toBe('markdown');
  });

  it('routes McpServer to json', () => {
    expect(getRouteForTool({ type: ToolType.McpServer })).toBe('json');
  });

  it('routes Hook to json', () => {
    expect(getRouteForTool({ type: ToolType.Hook })).toBe('json');
  });
});

// ---------------------------------------------------------------------------
// getJsonPath
// ---------------------------------------------------------------------------

describe('getJsonPath', () => {
  it('returns ["mcpServers", name] for MCP server with empty filePath (Claude Code default)', () => {
    const tool = makeTool({
      type: ToolType.McpServer,
      name: 'my-server',
    });
    expect(getJsonPath(tool)).toEqual(['mcpServers', 'my-server']);
  });

  it('returns ["mcpServers", name] for Claude Code MCP server with .mcp.json path', () => {
    const tool = makeTool({
      type: ToolType.McpServer,
      name: 'my-server',
      source: { filePath: '/home/user/.mcp.json' },
    });
    expect(getJsonPath(tool)).toEqual(['mcpServers', 'my-server']);
  });

  it('returns ["servers", name] for Copilot project-scope MCP server (.vscode/mcp.json)', () => {
    const tool = makeTool({
      type: ToolType.McpServer,
      name: 'copilot-server',
      source: { filePath: '/workspace/my-project/.vscode/mcp.json' },
    });
    expect(getJsonPath(tool)).toEqual(['servers', 'copilot-server']);
  });

  it('returns ["servers", name] for Copilot user-scope MCP server (Code/User/mcp.json)', () => {
    const tool = makeTool({
      type: ToolType.McpServer,
      name: 'copilot-user-server',
      source: { filePath: '/Users/someone/Library/Application Support/Code/User/mcp.json' },
    });
    expect(getJsonPath(tool)).toEqual(['servers', 'copilot-user-server']);
  });

  it('returns ["servers", name] for Copilot user-scope MCP server (Windows Code\\User path)', () => {
    const tool = makeTool({
      type: ToolType.McpServer,
      name: 'win-copilot-server',
      source: { filePath: 'C:\\Users\\user\\AppData\\Roaming\\Code\\User\\mcp.json' },
    });
    expect(getJsonPath(tool)).toEqual(['servers', 'win-copilot-server']);
  });

  it('returns ["hooks", eventName] for Hook', () => {
    const tool = makeTool({
      type: ToolType.Hook,
      name: 'lint-check',
      metadata: { eventName: 'PreToolUse' },
    });
    expect(getJsonPath(tool)).toEqual(['hooks', 'PreToolUse']);
  });

  it('returns empty array for Skill', () => {
    const tool = makeTool({ type: ToolType.Skill });
    expect(getJsonPath(tool)).toEqual([]);
  });

  it('returns empty array for Command', () => {
    const tool = makeTool({ type: ToolType.Command });
    expect(getJsonPath(tool)).toEqual([]);
  });

  it('handles MCP server with special characters in name', () => {
    const tool = makeTool({
      type: ToolType.McpServer,
      name: '@scope/my-mcp-server',
    });
    expect(getJsonPath(tool)).toEqual(['mcpServers', '@scope/my-mcp-server']);
  });

  it('handles Hook with different event names', () => {
    const cases = [
      { eventName: 'PostToolUse', expected: ['hooks', 'PostToolUse'] },
      { eventName: 'Stop', expected: ['hooks', 'Stop'] },
      { eventName: 'PreToolUse', expected: ['hooks', 'PreToolUse'] },
    ];

    for (const { eventName, expected } of cases) {
      const tool = makeTool({
        type: ToolType.Hook,
        metadata: { eventName },
      });
      expect(getJsonPath(tool)).toEqual(expected);
    }
  });
});
