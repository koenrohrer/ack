import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileIOService } from '../../services/fileio.service.js';
import { SchemaService } from '../../services/schema.service.js';
import { claudeCodeSchemas } from '../../adapters/claude-code/schemas.js';
import { parseSettingsFile, readDisabledMcpServers } from '../../adapters/claude-code/parsers/settings.parser.js';
import { parseMcpFile, parseClaudeJson } from '../../adapters/claude-code/parsers/mcp.parser.js';
import { parseSkillDirectory, parseSkillsDir } from '../../adapters/claude-code/parsers/skill.parser.js';
import { parseCommandFile, parseCommandsDir } from '../../adapters/claude-code/parsers/command.parser.js';
import { ToolType, ConfigScope, ToolStatus } from '../../types/enums.js';

let tmpDir: string;
let fileIO: FileIOService;
let schemaService: SchemaService;

async function makeTmpDir(): Promise<string> {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'parsers-test-'));
  return tmpDir;
}

beforeEach(() => {
  fileIO = new FileIOService();
  schemaService = new SchemaService();
  schemaService.registerSchemas(claudeCodeSchemas);
});

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
});

// ---------------------------------------------------------------------------
// settings.parser
// ---------------------------------------------------------------------------

describe('parseSettingsFile', () => {
  it('extracts hooks from valid settings JSON', async () => {
    const dir = await makeTmpDir();
    const filePath = path.join(dir, 'settings.json');
    const data = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo safety check' }],
          },
          {
            matcher: '',
            hooks: [{ type: 'prompt', prompt: 'Be careful' }],
          },
        ],
        PostToolUse: [
          {
            matcher: 'Write',
            hooks: [{ type: 'command', command: 'lint-check' }],
          },
        ],
      },
    };
    await fs.writeFile(filePath, JSON.stringify(data));

    const tools = await parseSettingsFile(fileIO, schemaService, filePath, ConfigScope.User);

    expect(tools).toHaveLength(3);

    // First hook: PreToolUse with Bash matcher
    expect(tools[0].id).toBe('hook:user:PreToolUse:0');
    expect(tools[0].type).toBe(ToolType.Hook);
    expect(tools[0].name).toBe('PreToolUse (Bash)');
    expect(tools[0].scope).toBe(ConfigScope.User);
    expect(tools[0].status).toBe(ToolStatus.Enabled);
    expect(tools[0].metadata.eventName).toBe('PreToolUse');
    expect(tools[0].metadata.matcher).toBe('Bash');

    // Second hook: PreToolUse with empty matcher
    expect(tools[1].id).toBe('hook:user:PreToolUse:1');
    expect(tools[1].name).toBe('PreToolUse');

    // Third hook: PostToolUse
    expect(tools[2].id).toBe('hook:user:PostToolUse:0');
    expect(tools[2].name).toBe('PostToolUse (Write)');
  });

  it('returns Error tool for invalid JSON content', async () => {
    const dir = await makeTmpDir();
    const filePath = path.join(dir, 'settings.json');
    await fs.writeFile(filePath, 'not valid json {{{');

    const tools = await parseSettingsFile(fileIO, schemaService, filePath, ConfigScope.Project);

    expect(tools).toHaveLength(1);
    expect(tools[0].status).toBe(ToolStatus.Error);
    expect(tools[0].statusDetail).toBeDefined();
  });

  it('returns empty array for missing file', async () => {
    const dir = await makeTmpDir();
    const filePath = path.join(dir, 'nonexistent.json');

    const tools = await parseSettingsFile(fileIO, schemaService, filePath, ConfigScope.User);

    expect(tools).toEqual([]);
  });

  it('returns empty array for settings with no hooks', async () => {
    const dir = await makeTmpDir();
    const filePath = path.join(dir, 'settings.json');
    await fs.writeFile(filePath, JSON.stringify({ permissions: { allow: ['Read'] } }));

    const tools = await parseSettingsFile(fileIO, schemaService, filePath, ConfigScope.User);

    expect(tools).toEqual([]);
  });
});

describe('readDisabledMcpServers', () => {
  it('reads disabled servers list', async () => {
    const dir = await makeTmpDir();
    const filePath = path.join(dir, 'settings.json');
    await fs.writeFile(filePath, JSON.stringify({
      disabledMcpServers: ['server-a', 'server-b'],
    }));

    const disabled = await readDisabledMcpServers(fileIO, schemaService, filePath);

    expect(disabled).toEqual(['server-a', 'server-b']);
  });

  it('returns empty array for missing file', async () => {
    const dir = await makeTmpDir();
    const disabled = await readDisabledMcpServers(fileIO, schemaService, path.join(dir, 'nope.json'));
    expect(disabled).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mcp.parser
// ---------------------------------------------------------------------------

describe('parseMcpFile', () => {
  it('extracts MCP servers from valid config', async () => {
    const dir = await makeTmpDir();
    const filePath = path.join(dir, '.mcp.json');
    const data = {
      mcpServers: {
        'my-server': {
          command: 'node',
          args: ['server.js'],
          env: { PORT: '3000' },
        },
        'another-server': {
          command: 'python',
          args: ['-m', 'server'],
          type: 'stdio',
        },
      },
    };
    await fs.writeFile(filePath, JSON.stringify(data));

    const tools = await parseMcpFile(fileIO, schemaService, filePath, ConfigScope.Project);

    expect(tools).toHaveLength(2);
    expect(tools[0].id).toBe('mcp:project:my-server');
    expect(tools[0].type).toBe(ToolType.McpServer);
    expect(tools[0].name).toBe('my-server');
    expect(tools[0].status).toBe(ToolStatus.Enabled);
    expect(tools[0].metadata.command).toBe('node');
    expect(tools[0].metadata.args).toEqual(['server.js']);
    expect(tools[0].metadata.env).toEqual({ PORT: '3000' });

    expect(tools[1].id).toBe('mcp:project:another-server');
    expect(tools[1].metadata.transport).toBe('stdio');
  });

  it('marks disabled servers correctly via disabledServers param', async () => {
    const dir = await makeTmpDir();
    const filePath = path.join(dir, '.mcp.json');
    await fs.writeFile(filePath, JSON.stringify({
      mcpServers: {
        active: { command: 'node', args: [] },
        disabled: { command: 'python', args: [] },
      },
    }));

    const tools = await parseMcpFile(fileIO, schemaService, filePath, ConfigScope.Project, ['disabled']);

    expect(tools).toHaveLength(2);
    const active = tools.find(t => t.name === 'active')!;
    const disabled = tools.find(t => t.name === 'disabled')!;
    expect(active.status).toBe(ToolStatus.Enabled);
    expect(disabled.status).toBe(ToolStatus.Disabled);
  });

  it('marks servers disabled via disabled field in config', async () => {
    const dir = await makeTmpDir();
    const filePath = path.join(dir, '.mcp.json');
    await fs.writeFile(filePath, JSON.stringify({
      mcpServers: {
        'self-disabled': { command: 'node', args: [], disabled: true },
      },
    }));

    const tools = await parseMcpFile(fileIO, schemaService, filePath, ConfigScope.Project);

    expect(tools).toHaveLength(1);
    expect(tools[0].status).toBe(ToolStatus.Disabled);
  });

  it('returns empty array for missing file', async () => {
    const dir = await makeTmpDir();
    const tools = await parseMcpFile(fileIO, schemaService, path.join(dir, 'nope.json'), ConfigScope.Managed);
    expect(tools).toEqual([]);
  });

  it('returns Error tool for invalid JSON', async () => {
    const dir = await makeTmpDir();
    const filePath = path.join(dir, 'bad.json');
    await fs.writeFile(filePath, '{{{broken');

    const tools = await parseMcpFile(fileIO, schemaService, filePath, ConfigScope.Project);

    expect(tools).toHaveLength(1);
    expect(tools[0].status).toBe(ToolStatus.Error);
  });
});

describe('parseClaudeJson', () => {
  it('extracts MCP servers from ~/.claude.json', async () => {
    const dir = await makeTmpDir();
    const filePath = path.join(dir, '.claude.json');
    const data = {
      mcpServers: {
        'global-server': { command: 'npx', args: ['my-server'] },
      },
      oauthToken: 'secret-should-be-preserved',
      preferences: { theme: 'dark' },
    };
    await fs.writeFile(filePath, JSON.stringify(data));

    const tools = await parseClaudeJson(fileIO, schemaService, filePath);

    expect(tools).toHaveLength(1);
    expect(tools[0].id).toBe('mcp:user:global-server');
    expect(tools[0].scope).toBe(ConfigScope.User);
    expect(tools[0].metadata.command).toBe('npx');
  });

  it('handles disabled servers in claude.json', async () => {
    const dir = await makeTmpDir();
    const filePath = path.join(dir, '.claude.json');
    await fs.writeFile(filePath, JSON.stringify({
      mcpServers: {
        enabled: { command: 'node', args: [] },
        disabled: { command: 'python', args: [] },
      },
    }));

    const tools = await parseClaudeJson(fileIO, schemaService, filePath, ['disabled']);

    const enabled = tools.find(t => t.name === 'enabled')!;
    const disabled = tools.find(t => t.name === 'disabled')!;
    expect(enabled.status).toBe(ToolStatus.Enabled);
    expect(disabled.status).toBe(ToolStatus.Disabled);
  });

  it('returns empty for missing file', async () => {
    const dir = await makeTmpDir();
    const tools = await parseClaudeJson(fileIO, schemaService, path.join(dir, 'nope.json'));
    expect(tools).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// skill.parser
// ---------------------------------------------------------------------------

describe('parseSkillDirectory', () => {
  it('parses valid SKILL.md with frontmatter', async () => {
    const dir = await makeTmpDir();
    const skillDir = path.join(dir, 'my-skill');
    await fs.mkdir(skillDir);
    const skillContent = `---
name: My Test Skill
description: A skill for testing
allowed-tools: Read,Write,Bash
model: claude-3-5-sonnet
---

Use this skill to run tests on the codebase.`;
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillContent);

    const tool = await parseSkillDirectory(fileIO, schemaService, skillDir, ConfigScope.User);

    expect(tool.id).toBe('skill:user:My Test Skill');
    expect(tool.type).toBe(ToolType.Skill);
    expect(tool.name).toBe('My Test Skill');
    expect(tool.description).toBe('A skill for testing');
    expect(tool.status).toBe(ToolStatus.Enabled);
    expect(tool.source.isDirectory).toBe(true);
    expect(tool.source.directoryPath).toBe(skillDir);
    expect(tool.metadata.allowedTools).toBe('Read,Write,Bash');
    expect(tool.metadata.model).toBe('claude-3-5-sonnet');
    expect(tool.metadata.body).toContain('Use this skill to run tests');
  });

  it('returns Warning for missing SKILL.md (incomplete skill)', async () => {
    const dir = await makeTmpDir();
    const skillDir = path.join(dir, 'empty-skill');
    await fs.mkdir(skillDir);
    // No SKILL.md inside

    const tool = await parseSkillDirectory(fileIO, schemaService, skillDir, ConfigScope.Project);

    expect(tool.status).toBe(ToolStatus.Warning);
    expect(tool.statusDetail).toBe('Missing SKILL.md');
    expect(tool.name).toBe('empty-skill');
  });

  it('returns Warning for SKILL.md without frontmatter', async () => {
    const dir = await makeTmpDir();
    const skillDir = path.join(dir, 'no-frontmatter');
    await fs.mkdir(skillDir);
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'Just some content with no frontmatter.');

    const tool = await parseSkillDirectory(fileIO, schemaService, skillDir, ConfigScope.User);

    expect(tool.status).toBe(ToolStatus.Warning);
    expect(tool.statusDetail).toBe('No frontmatter in SKILL.md');
  });

  it('handles allowed-tools as a string (not array)', async () => {
    const dir = await makeTmpDir();
    const skillDir = path.join(dir, 'string-tools');
    await fs.mkdir(skillDir);
    const skillContent = `---
name: String Tools Skill
description: Tests string allowed-tools
allowed-tools: Read,Write,Bash,Glob
---

Body text.`;
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillContent);

    const tool = await parseSkillDirectory(fileIO, schemaService, skillDir, ConfigScope.User);

    expect(tool.status).toBe(ToolStatus.Enabled);
    expect(typeof tool.metadata.allowedTools).toBe('string');
    expect(tool.metadata.allowedTools).toBe('Read,Write,Bash,Glob');
  });
});

describe('parseSkillsDir', () => {
  it('parses all skill subdirectories', async () => {
    const dir = await makeTmpDir();
    const skillsDir = path.join(dir, 'skills');
    await fs.mkdir(skillsDir);

    // Valid skill
    const skill1 = path.join(skillsDir, 'skill-1');
    await fs.mkdir(skill1);
    await fs.writeFile(path.join(skill1, 'SKILL.md'), `---
name: Skill One
description: First skill
---

Body.`);

    // Incomplete skill (no SKILL.md)
    const skill2 = path.join(skillsDir, 'skill-2');
    await fs.mkdir(skill2);

    const tools = await parseSkillsDir(fileIO, schemaService, skillsDir, ConfigScope.User);

    expect(tools).toHaveLength(2);
    const valid = tools.find(t => t.name === 'Skill One')!;
    const warning = tools.find(t => t.name === 'skill-2')!;
    expect(valid.status).toBe(ToolStatus.Enabled);
    expect(warning.status).toBe(ToolStatus.Warning);
  });

  it('returns empty array for nonexistent directory', async () => {
    const dir = await makeTmpDir();
    const tools = await parseSkillsDir(fileIO, schemaService, path.join(dir, 'missing'), ConfigScope.User);
    expect(tools).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// command.parser
// ---------------------------------------------------------------------------

describe('parseCommandFile', () => {
  it('parses command with frontmatter', async () => {
    const dir = await makeTmpDir();
    const filePath = path.join(dir, 'test-runner.md');
    const content = `---
description: Run the test suite
argument-hint: <test-file>
model: claude-3-5-sonnet
allowed-tools: Bash,Read
---

Run all tests in the specified file. If no file is given, run all tests.`;
    await fs.writeFile(filePath, content);

    const tool = await parseCommandFile(fileIO, schemaService, filePath, ConfigScope.User);

    expect(tool.id).toBe('command:user:test-runner');
    expect(tool.type).toBe(ToolType.Command);
    expect(tool.name).toBe('test-runner');
    expect(tool.description).toBe('Run the test suite');
    expect(tool.status).toBe(ToolStatus.Enabled);
    expect(tool.metadata.argumentHint).toBe('<test-file>');
    expect(tool.metadata.model).toBe('claude-3-5-sonnet');
    expect(tool.metadata.allowedTools).toBe('Bash,Read');
    expect(tool.metadata.body).toContain('Run all tests');
  });

  it('parses command without frontmatter', async () => {
    const dir = await makeTmpDir();
    const filePath = path.join(dir, 'simple-cmd.md');
    await fs.writeFile(filePath, 'Just do the thing without any frontmatter.');

    const tool = await parseCommandFile(fileIO, schemaService, filePath, ConfigScope.Project);

    expect(tool.id).toBe('command:project:simple-cmd');
    expect(tool.name).toBe('simple-cmd');
    expect(tool.status).toBe(ToolStatus.Enabled);
    expect(tool.description).toBeUndefined();
    expect(tool.metadata.body).toBe('Just do the thing without any frontmatter.');
  });

  it('derives name from filename (strips .md)', async () => {
    const dir = await makeTmpDir();
    const filePath = path.join(dir, 'deploy-production.md');
    await fs.writeFile(filePath, 'Deploy to production.');

    const tool = await parseCommandFile(fileIO, schemaService, filePath, ConfigScope.User);

    expect(tool.name).toBe('deploy-production');
  });
});

describe('parseCommandsDir', () => {
  it('finds all .md files recursively', async () => {
    const dir = await makeTmpDir();
    const cmdsDir = path.join(dir, 'commands');
    await fs.mkdir(cmdsDir);
    await fs.writeFile(path.join(cmdsDir, 'cmd-a.md'), 'Command A');

    // Nested subdirectory
    const subDir = path.join(cmdsDir, 'category');
    await fs.mkdir(subDir);
    await fs.writeFile(path.join(subDir, 'cmd-b.md'), 'Command B');

    const tools = await parseCommandsDir(fileIO, schemaService, cmdsDir, ConfigScope.User);

    expect(tools).toHaveLength(2);
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual(['cmd-a', 'cmd-b']);
  });

  it('returns empty array for nonexistent directory', async () => {
    const dir = await makeTmpDir();
    const tools = await parseCommandsDir(fileIO, schemaService, path.join(dir, 'nope'), ConfigScope.User);
    expect(tools).toEqual([]);
  });

  it('ignores non-.md files', async () => {
    const dir = await makeTmpDir();
    const cmdsDir = path.join(dir, 'commands');
    await fs.mkdir(cmdsDir);
    await fs.writeFile(path.join(cmdsDir, 'real-cmd.md'), 'A command');
    await fs.writeFile(path.join(cmdsDir, 'not-a-command.txt'), 'Not a command');
    await fs.writeFile(path.join(cmdsDir, 'readme.json'), '{}');

    const tools = await parseCommandsDir(fileIO, schemaService, cmdsDir, ConfigScope.User);

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('real-cmd');
  });
});
