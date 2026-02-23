import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileIOService } from '../../../services/fileio.service.js';
import { parseCopilotAgents } from './agents.parser.js';
import { ConfigScope, ToolStatus, ToolType } from '../../../types/enums.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;
let fileIO: FileIOService;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-agents-parser-test-'));
  fileIO = new FileIOService();
});

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
});

// ---------------------------------------------------------------------------
// parseCopilotAgents
// ---------------------------------------------------------------------------

describe('parseCopilotAgents', () => {
  // Case 1 — enabled agent (user-invokable absent)
  it('returns enabled agent tool when user-invokable is absent from frontmatter', async () => {
    const agentsDir = path.join(tmpDir, '.github', 'agents');
    await fs.mkdir(agentsDir, { recursive: true });
    await fs.writeFile(
      path.join(agentsDir, 'my-agent.agent.md'),
      '---\nname: My Agent\ndescription: Test agent\n---\n# Body content',
    );

    const tools = await parseCopilotAgents(fileIO, tmpDir);

    expect(tools).toHaveLength(1);
    const tool = tools[0];
    expect(tool.id).toBe('skill:project:my-agent');
    expect(tool.type).toBe(ToolType.Skill);
    expect(tool.scope).toBe(ConfigScope.Project);
    expect(tool.status).toBe(ToolStatus.Enabled);
    expect(tool.name).toBe('My Agent');
    expect(tool.description).toBe('Test agent');
    expect(tool.source.filePath).toMatch(/my-agent\.agent\.md$/);
    expect(tool.source.isDirectory).toBe(false);
    expect(tool.metadata.agentFilename).toBe('my-agent');
    expect(tool.metadata.userInvokable).toBe(true);
  });

  // Case 2 — disabled agent (user-invokable: false)
  it('returns disabled agent tool when user-invokable is "false"', async () => {
    const agentsDir = path.join(tmpDir, '.github', 'agents');
    await fs.mkdir(agentsDir, { recursive: true });
    await fs.writeFile(
      path.join(agentsDir, 'hidden-agent.agent.md'),
      '---\nname: Hidden Agent\nuser-invokable: false\n---\n# Hidden',
    );

    const tools = await parseCopilotAgents(fileIO, tmpDir);

    expect(tools).toHaveLength(1);
    const tool = tools[0];
    expect(tool.status).toBe(ToolStatus.Disabled);
    expect(tool.metadata.userInvokable).toBe(false);
  });

  // Case 3 — user-invokable: true explicitly
  it('returns enabled status when user-invokable is explicitly "true"', async () => {
    const agentsDir = path.join(tmpDir, '.github', 'agents');
    await fs.mkdir(agentsDir, { recursive: true });
    await fs.writeFile(
      path.join(agentsDir, 'explicit-agent.agent.md'),
      '---\nname: Explicit Agent\nuser-invokable: true\n---\n# Content',
    );

    const tools = await parseCopilotAgents(fileIO, tmpDir);

    expect(tools).toHaveLength(1);
    expect(tools[0].status).toBe(ToolStatus.Enabled);
    expect(tools[0].metadata.userInvokable).toBe(true);
  });

  // Case 4 — no frontmatter at all
  it('returns enabled tool using filename as name when no frontmatter present', async () => {
    const agentsDir = path.join(tmpDir, '.github', 'agents');
    await fs.mkdir(agentsDir, { recursive: true });
    await fs.writeFile(
      path.join(agentsDir, 'plain-agent.agent.md'),
      '## This is just plain markdown with no frontmatter delimiters.',
    );

    const tools = await parseCopilotAgents(fileIO, tmpDir);

    expect(tools).toHaveLength(1);
    const tool = tools[0];
    expect(tool.status).toBe(ToolStatus.Enabled);
    // Name falls back to baseName (filename without .agent.md)
    expect(tool.name).toBe('plain-agent');
    expect(tool.metadata.body).toContain('plain markdown');
  });

  // Case 5 — missing agents directory
  it('returns empty array without throwing when .github/agents/ does not exist', async () => {
    // No .github/agents/ directory created
    const tools = await parseCopilotAgents(fileIO, tmpDir);
    expect(tools).toEqual([]);
  });

  // Case 6 — non-.agent.md files are ignored
  it('ignores files without .agent.md compound extension', async () => {
    const agentsDir = path.join(tmpDir, '.github', 'agents');
    await fs.mkdir(agentsDir, { recursive: true });
    await fs.writeFile(
      path.join(agentsDir, 'notes.md'),
      '# This is a plain .md file — should be ignored',
    );

    const tools = await parseCopilotAgents(fileIO, tmpDir);
    expect(tools).toEqual([]);
  });

  // Case 7 — sort order: results sorted alphabetically by name
  it('returns tools sorted alphabetically by name', async () => {
    const agentsDir = path.join(tmpDir, '.github', 'agents');
    await fs.mkdir(agentsDir, { recursive: true });
    await fs.writeFile(
      path.join(agentsDir, 'zebra.agent.md'),
      '---\nname: Zebra Agent\n---\n# Zebra',
    );
    await fs.writeFile(
      path.join(agentsDir, 'alpha.agent.md'),
      '---\nname: Alpha Agent\n---\n# Alpha',
    );

    const tools = await parseCopilotAgents(fileIO, tmpDir);

    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('Alpha Agent');
    expect(tools[1].name).toBe('Zebra Agent');
  });
});
