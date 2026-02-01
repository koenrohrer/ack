import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaService } from '../../services/schema.service.js';
import {
  SettingsFileSchema,
  McpFileSchema,
  ClaudeJsonSchema,
  SkillFrontmatterSchema,
  CommandFrontmatterSchema,
  claudeCodeSchemas,
} from '../../adapters/claude-code/schemas.js';

describe('Zod schemas', () => {
  // -- SettingsFileSchema --

  it('validates a valid settings file', () => {
    const data = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo hello' }],
          },
        ],
      },
      permissions: {
        allow: ['Read', 'Write'],
        deny: ['Bash'],
      },
      env: { NODE_ENV: 'production' },
      disabledMcpServers: ['unstable-server'],
    };

    const result = SettingsFileSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('preserves unknown fields in SettingsFileSchema (passthrough)', () => {
    const data = {
      customSetting: 'preserved',
      anotherField: 42,
    };

    const result = SettingsFileSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveProperty('customSetting', 'preserved');
      expect(result.data).toHaveProperty('anotherField', 42);
    }
  });

  // -- McpFileSchema --

  it('validates a valid MCP config', () => {
    const data = {
      mcpServers: {
        myServer: {
          command: 'node',
          args: ['server.js'],
          env: { PORT: '3000' },
        },
      },
    };

    const result = McpFileSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcpServers?.myServer?.command).toBe('node');
    }
  });

  it('rejects MCP server without required command field', () => {
    const data = {
      mcpServers: {
        bad: {
          args: ['--help'],
        },
      },
    };

    const result = McpFileSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  // -- ClaudeJsonSchema --

  it('preserves unknown fields in ClaudeJsonSchema (passthrough)', () => {
    const data = {
      mcpServers: {},
      oauthToken: 'secret-token-123',
      preferences: { theme: 'dark' },
      projects: ['/home/user/project'],
      numericSetting: 99,
    };

    const result = ClaudeJsonSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveProperty('oauthToken', 'secret-token-123');
      expect(result.data).toHaveProperty('preferences');
      expect((result.data as Record<string, unknown>).preferences).toEqual({ theme: 'dark' });
      expect(result.data).toHaveProperty('projects');
      expect(result.data).toHaveProperty('numericSetting', 99);
    }
  });

  it('defaults mcpServers to empty object in ClaudeJsonSchema', () => {
    const data = { oauthToken: 'abc' };

    const result = ClaudeJsonSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcpServers).toEqual({});
      expect(result.data).toHaveProperty('oauthToken', 'abc');
    }
  });

  // -- SkillFrontmatterSchema --

  it('validates valid skill frontmatter', () => {
    const data = {
      name: 'My Skill',
      description: 'Does something useful',
      'allowed-tools': 'Read,Write,Bash',
      'user-invocable': true,
    };

    const result = SkillFrontmatterSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('accepts allowed-tools as a string, not array', () => {
    const data = {
      name: 'Test',
      description: 'test',
      'allowed-tools': 'Read,Write',
    };

    const result = SkillFrontmatterSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data['allowed-tools']).toBe('string');
    }
  });

  it('rejects skill name exceeding max length', () => {
    const data = {
      name: 'x'.repeat(65),
      description: 'Valid description',
    };

    const result = SkillFrontmatterSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects skill description exceeding max length', () => {
    const data = {
      name: 'Valid',
      description: 'x'.repeat(1025),
    };

    const result = SkillFrontmatterSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  // -- CommandFrontmatterSchema --

  it('validates valid command frontmatter', () => {
    const data = {
      description: 'Run tests',
      'argument-hint': '<file>',
      model: 'claude-3-5-sonnet',
    };

    const result = CommandFrontmatterSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('accepts undefined (no frontmatter) for commands', () => {
    const result = CommandFrontmatterSchema.safeParse(undefined);
    expect(result.success).toBe(true);
  });
});

describe('SchemaService', () => {
  let svc: SchemaService;

  beforeEach(() => {
    svc = new SchemaService();
    svc.registerSchemas(claudeCodeSchemas);
  });

  it('validates valid data and returns success', () => {
    const data = {
      mcpServers: {
        test: { command: 'node', args: [] },
      },
    };

    const result = svc.validate('mcp-file', data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveProperty('mcpServers');
    }
  });

  it('returns failure with error for invalid data', () => {
    const data = {
      mcpServers: {
        bad: { args: ['no command'] }, // missing required 'command'
      },
    };

    const result = svc.validate('mcp-file', data);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it('throws for unregistered schema key', () => {
    expect(() => svc.validate('nonexistent', {})).toThrow(
      'Schema "nonexistent" is not registered',
    );
  });

  it('hasSchema returns true for registered schemas', () => {
    expect(svc.hasSchema('settings-file')).toBe(true);
    expect(svc.hasSchema('mcp-file')).toBe(true);
    expect(svc.hasSchema('claude-json')).toBe(true);
    expect(svc.hasSchema('skill-frontmatter')).toBe(true);
    expect(svc.hasSchema('command-frontmatter')).toBe(true);
  });

  it('hasSchema returns false for unregistered key', () => {
    expect(svc.hasSchema('unknown')).toBe(false);
  });

  it('registers all Claude Code schemas', () => {
    const expectedKeys = [
      'settings-file',
      'mcp-file',
      'claude-json',
      'mcp-server',
      'skill-frontmatter',
      'command-frontmatter',
      'hook-entry',
      'hook-matcher',
      'hooks',
    ];

    for (const key of expectedKeys) {
      expect(svc.hasSchema(key)).toBe(true);
    }
  });
});
