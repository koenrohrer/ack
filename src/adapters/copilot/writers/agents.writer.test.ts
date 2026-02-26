import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileIOService } from '../../../services/fileio.service.js';
import { toggleAgentUserInvokable } from './agents.writer.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;
let fileIO: FileIOService;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-agents-writer-test-'));
  fileIO = new FileIOService();
});

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
});

// ---------------------------------------------------------------------------
// toggleAgentUserInvokable
// ---------------------------------------------------------------------------

describe('toggleAgentUserInvokable', () => {
  // Case 1 — inserts user-invokable: false when field is absent
  it('inserts user-invokable: false when field is absent from frontmatter', async () => {
    const filePath = path.join(tmpDir, 'test.agent.md');
    await fs.writeFile(filePath, '---\nname: Test Agent\n---\n# Body');

    await toggleAgentUserInvokable(fileIO, filePath, true /* shouldDisable */);

    const result = await fs.readFile(filePath, 'utf-8');
    expect(result).toContain('user-invokable: false');
    // Original field must still be present
    expect(result).toContain('name: Test Agent');
  });

  // Case 2 — replaces user-invokable: false with true
  it('replaces user-invokable: false with user-invokable: true when enabling', async () => {
    const filePath = path.join(tmpDir, 'test.agent.md');
    await fs.writeFile(filePath, '---\nname: Test Agent\nuser-invokable: false\n---\n# Body');

    await toggleAgentUserInvokable(fileIO, filePath, false /* shouldEnable */);

    const result = await fs.readFile(filePath, 'utf-8');
    expect(result).toContain('user-invokable: true');
    expect(result).not.toContain('user-invokable: false');
  });

  // Case 3 — preserves all other frontmatter fields (key safety check for Pitfall 2)
  it('preserves all other frontmatter fields after toggling user-invokable', async () => {
    const filePath = path.join(tmpDir, 'test.agent.md');
    await fs.writeFile(
      filePath,
      '---\nname: MyAgent\ndescription: Desc\nuser-invokable: true\n---\n# Body',
    );

    await toggleAgentUserInvokable(fileIO, filePath, true /* shouldDisable */);

    const result = await fs.readFile(filePath, 'utf-8');
    expect(result).toContain('name: MyAgent');
    expect(result).toContain('description: Desc');
    expect(result).toContain('user-invokable: false');
    // Should not have duplicated user-invokable
    const matches = result.match(/user-invokable:/g);
    expect(matches).toHaveLength(1);
  });

  // Case 4 — preserves body content after toggle
  it('preserves body content after toggling frontmatter', async () => {
    const filePath = path.join(tmpDir, 'test.agent.md');
    const bodyContent = '## Instructions\nDo the thing.\n\nMore content here.';
    await fs.writeFile(filePath, `---\nname: Agent\n---\n${bodyContent}`);

    await toggleAgentUserInvokable(fileIO, filePath, true);

    const result = await fs.readFile(filePath, 'utf-8');
    expect(result).toContain('## Instructions');
    expect(result).toContain('Do the thing.');
    expect(result).toContain('More content here.');
  });

  // Case 5 — no frontmatter — prepends block
  it('prepends frontmatter block when file has no frontmatter delimiters', async () => {
    const filePath = path.join(tmpDir, 'plain.agent.md');
    const originalBody = '# Agent Instructions\nThis is the agent body.';
    await fs.writeFile(filePath, originalBody);

    await toggleAgentUserInvokable(fileIO, filePath, true);

    const result = await fs.readFile(filePath, 'utf-8');
    expect(result).toMatch(/^---/);
    expect(result).toContain('user-invokable: false');
    // Original body must still be present
    expect(result).toContain('# Agent Instructions');
    expect(result).toContain('This is the agent body.');
  });

  // Case 6 — file not found throws
  it('throws an error when the agent file does not exist', async () => {
    const nonExistentPath = path.join(tmpDir, 'ghost.agent.md');

    await expect(
      toggleAgentUserInvokable(fileIO, nonExistentPath, true),
    ).rejects.toThrow('Agent file not found');
  });
});
