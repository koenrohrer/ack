import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileIOService } from '../../../services/fileio.service.js';
import { parseCopilotPrompts } from './prompts.parser.js';
import { ConfigScope, ToolStatus, ToolType } from '../../../types/enums.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;
let fileIO: FileIOService;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-prompts-test-'));
  fileIO = new FileIOService();
});

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
});

// ---------------------------------------------------------------------------
// parseCopilotPrompts
// ---------------------------------------------------------------------------

describe('parseCopilotPrompts', () => {
  // Case 6: .prompt.md file with frontmatter (description + mode)
  it('returns prompt tool from .github/prompts/*.prompt.md with frontmatter', async () => {
    const promptsDir = path.join(tmpDir, '.github', 'prompts');
    await fs.mkdir(promptsDir, { recursive: true });
    await fs.writeFile(
      path.join(promptsDir, 'refactor.prompt.md'),
      '---\ndescription: Refactor code\nmode: agent\n---\nBody',
    );

    const tools = await parseCopilotPrompts(fileIO, tmpDir);

    expect(tools).toHaveLength(1);
    const tool = tools[0];
    expect(tool.id).toBe('prompt:project:refactor');
    expect(tool.type).toBe(ToolType.CustomPrompt);
    expect(tool.scope).toBe(ConfigScope.Project);
    expect(tool.status).toBe(ToolStatus.Enabled);
    expect(tool.name).toBe('refactor');
    expect(tool.description).toBe('Refactor code');
    expect(tool.metadata.instructionKind).toBe('prompt');
    expect(tool.metadata.mode).toBe('agent');
    expect(tool.metadata.body).toBe('Body');
  });

  // Case 7: .prompt.md with no frontmatter (raw markdown only)
  it('returns tool with undefined description and mode when no frontmatter present', async () => {
    const promptsDir = path.join(tmpDir, '.github', 'prompts');
    await fs.mkdir(promptsDir, { recursive: true });
    await fs.writeFile(
      path.join(promptsDir, 'noheader.prompt.md'),
      'Raw markdown content only, no frontmatter here.',
    );

    const tools = await parseCopilotPrompts(fileIO, tmpDir);

    expect(tools).toHaveLength(1);
    const tool = tools[0];
    expect(tool.name).toBe('noheader');
    expect(tool.description).toBeUndefined();
    expect(tool.metadata.mode).toBeUndefined();
    expect(tool.metadata.body).toBe('Raw markdown content only, no frontmatter here.');
  });

  // Case 8: .github/prompts/ directory does not exist
  it('returns [] without throwing when .github/prompts/ does not exist', async () => {
    // No prompts directory created

    const tools = await parseCopilotPrompts(fileIO, tmpDir);

    expect(tools).toEqual([]);
  });

  // Case 9: plain .md file (not .prompt.md) is NOT included
  it('ignores files without .prompt.md compound extension in prompts dir', async () => {
    const promptsDir = path.join(tmpDir, '.github', 'prompts');
    await fs.mkdir(promptsDir, { recursive: true });

    // Compound extension — should be included
    await fs.writeFile(
      path.join(promptsDir, 'valid.prompt.md'),
      '---\ndescription: A valid prompt\n---\nValid content.',
    );
    // Plain .md — should be excluded
    await fs.writeFile(
      path.join(promptsDir, 'something.md'),
      'This file should not appear in results.',
    );

    const tools = await parseCopilotPrompts(fileIO, tmpDir);

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('valid');
  });

  // Extra: 'agent' field falls back when 'mode' is absent
  it('uses agent field as mode when mode field is absent', async () => {
    const promptsDir = path.join(tmpDir, '.github', 'prompts');
    await fs.mkdir(promptsDir, { recursive: true });
    await fs.writeFile(
      path.join(promptsDir, 'ask.prompt.md'),
      '---\ndescription: Ask a question\nagent: ask\n---\nAsk content.',
    );

    const tools = await parseCopilotPrompts(fileIO, tmpDir);

    expect(tools).toHaveLength(1);
    expect(tools[0].metadata.mode).toBe('ask');
  });

  // Extra: mode takes precedence over agent when both present
  it('prefers mode field over agent field when both are present in frontmatter', async () => {
    const promptsDir = path.join(tmpDir, '.github', 'prompts');
    await fs.mkdir(promptsDir, { recursive: true });
    await fs.writeFile(
      path.join(promptsDir, 'both.prompt.md'),
      '---\ndescription: Both fields\nmode: edit\nagent: ask\n---\nContent.',
    );

    const tools = await parseCopilotPrompts(fileIO, tmpDir);

    expect(tools).toHaveLength(1);
    expect(tools[0].metadata.mode).toBe('edit');
  });

  // Extra: multiple prompts are sorted alphabetically
  it('sorts multiple prompt tools alphabetically by name', async () => {
    const promptsDir = path.join(tmpDir, '.github', 'prompts');
    await fs.mkdir(promptsDir, { recursive: true });

    await fs.writeFile(path.join(promptsDir, 'zebra.prompt.md'), 'Zebra prompt.');
    await fs.writeFile(path.join(promptsDir, 'alpha.prompt.md'), 'Alpha prompt.');
    await fs.writeFile(path.join(promptsDir, 'middle.prompt.md'), 'Middle prompt.');

    const tools = await parseCopilotPrompts(fileIO, tmpDir);

    expect(tools).toHaveLength(3);
    expect(tools[0].name).toBe('alpha');
    expect(tools[1].name).toBe('middle');
    expect(tools[2].name).toBe('zebra');
  });
});
