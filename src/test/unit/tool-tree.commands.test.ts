import { describe, it, expect } from 'vitest';
import { getJsonPath, getRouteForTool } from '../../views/tool-tree/tool-tree.command-utils.js';
import { ToolType, ConfigScope } from '../../types/enums.js';
import { makeTool } from './helpers/make-tool.js';

// ---------------------------------------------------------------------------
// getRouteForTool
// ---------------------------------------------------------------------------

describe('getRouteForTool', () => {
  it('routes Skill to markdown', () => {
    expect(getRouteForTool(makeTool({ type: ToolType.Skill, name: 'test-tool', scope: ConfigScope.User }))).toBe('markdown');
  });

  it('routes Command to markdown', () => {
    expect(getRouteForTool(makeTool({ type: ToolType.Command, name: 'test-tool', scope: ConfigScope.User }))).toBe('markdown');
  });

  it('routes McpServer to json', () => {
    expect(getRouteForTool(makeTool({ type: ToolType.McpServer, name: 'test-tool', scope: ConfigScope.User }))).toBe('json');
  });

  it('routes Hook to json', () => {
    expect(getRouteForTool(makeTool({ type: ToolType.Hook, name: 'test-tool', scope: ConfigScope.User }))).toBe('json');
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
      scope: ConfigScope.User,
    });
    expect(getJsonPath(tool)).toEqual(['mcpServers', 'my-server']);
  });

  it('returns ["mcpServers", name] for Claude Code MCP server with .mcp.json path', () => {
    const tool = makeTool({
      type: ToolType.McpServer,
      name: 'my-server',
      scope: ConfigScope.User,
      source: { filePath: '/home/user/.mcp.json' },
    });
    expect(getJsonPath(tool)).toEqual(['mcpServers', 'my-server']);
  });

  it('returns ["servers", name] for Copilot project-scope MCP server (.vscode/mcp.json)', () => {
    const tool = makeTool({
      type: ToolType.McpServer,
      name: 'copilot-server',
      scope: ConfigScope.Project,
      source: { filePath: '/workspace/my-project/.vscode/mcp.json' },
    });
    expect(getJsonPath(tool)).toEqual(['servers', 'copilot-server']);
  });

  it('returns ["servers", name] for Copilot user-scope MCP server (Code/User/mcp.json)', () => {
    const tool = makeTool({
      type: ToolType.McpServer,
      name: 'copilot-user-server',
      scope: ConfigScope.User,
      source: { filePath: '/Users/someone/Library/Application Support/Code/User/mcp.json' },
    });
    expect(getJsonPath(tool)).toEqual(['servers', 'copilot-user-server']);
  });

  it('returns ["servers", name] for Copilot user-scope MCP server (Windows Code\\User path)', () => {
    const tool = makeTool({
      type: ToolType.McpServer,
      name: 'win-copilot-server',
      scope: ConfigScope.User,
      source: { filePath: 'C:\\Users\\user\\AppData\\Roaming\\Code\\User\\mcp.json' },
    });
    expect(getJsonPath(tool)).toEqual(['servers', 'win-copilot-server']);
  });

  it('returns ["hooks", eventName] for Hook', () => {
    const tool = makeTool({
      type: ToolType.Hook,
      name: 'lint-check',
      scope: ConfigScope.User,
      metadata: { eventName: 'PreToolUse' },
    });
    expect(getJsonPath(tool)).toEqual(['hooks', 'PreToolUse']);
  });

  it('returns empty array for Skill', () => {
    const tool = makeTool({ type: ToolType.Skill, name: 'test-tool', scope: ConfigScope.User });
    expect(getJsonPath(tool)).toEqual([]);
  });

  it('returns empty array for Command', () => {
    const tool = makeTool({ type: ToolType.Command, name: 'test-tool', scope: ConfigScope.User });
    expect(getJsonPath(tool)).toEqual([]);
  });

  it('handles MCP server with special characters in name', () => {
    const tool = makeTool({
      type: ToolType.McpServer,
      name: '@scope/my-mcp-server',
      scope: ConfigScope.User,
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
        name: 'test-tool',
        scope: ConfigScope.User,
        metadata: { eventName },
      });
      expect(getJsonPath(tool)).toEqual(expected);
    }
  });
});
