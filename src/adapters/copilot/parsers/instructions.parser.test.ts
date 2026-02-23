import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileIOService } from '../../../services/fileio.service.js';
import { parseCopilotInstructions } from './instructions.parser.js';
import { ConfigScope, ToolStatus, ToolType } from '../../../types/enums.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;
let fileIO: FileIOService;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-instructions-test-'));
  fileIO = new FileIOService();
});

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
});

// ---------------------------------------------------------------------------
// parseCopilotInstructions
// ---------------------------------------------------------------------------

describe('parseCopilotInstructions', () => {
  // Case 1: Global instructions file with no frontmatter
  it('returns global instruction tool from .github/copilot-instructions.md with no frontmatter', async () => {
    const githubDir = path.join(tmpDir, '.github');
    await fs.mkdir(githubDir, { recursive: true });
    await fs.writeFile(
      path.join(githubDir, 'copilot-instructions.md'),
      '# Conventions\nBe concise.',
    );

    const tools = await parseCopilotInstructions(fileIO, tmpDir);

    expect(tools).toHaveLength(1);
    const tool = tools[0];
    expect(tool.id).toBe('instruction:project:copilot-instructions');
    expect(tool.type).toBe(ToolType.CustomPrompt);
    expect(tool.scope).toBe(ConfigScope.Project);
    expect(tool.status).toBe(ToolStatus.Enabled);
    expect(tool.name).toBe('copilot-instructions');
    expect(tool.metadata.instructionKind).toBe('global');
    expect(tool.metadata.body).toBe('# Conventions\nBe concise.');
    expect(tool.metadata.applyTo).toBeUndefined();
  });

  // Case 2: Global instructions file + per-file instruction with applyTo
  it('returns global + per-file tools sorted alphabetically when both exist', async () => {
    const githubDir = path.join(tmpDir, '.github');
    const instructionsDir = path.join(githubDir, 'instructions');
    await fs.mkdir(instructionsDir, { recursive: true });

    await fs.writeFile(
      path.join(githubDir, 'copilot-instructions.md'),
      '# Global\nAlways be helpful.',
    );
    await fs.writeFile(
      path.join(instructionsDir, 'typescript.instructions.md'),
      '---\napplyTo: "**/*.ts"\n---\nUse strict TypeScript.',
    );

    const tools = await parseCopilotInstructions(fileIO, tmpDir);

    expect(tools).toHaveLength(2);

    // Alphabetical: copilot-instructions < typescript
    expect(tools[0].name).toBe('copilot-instructions');
    expect(tools[0].metadata.instructionKind).toBe('global');

    const tsTool = tools[1];
    expect(tsTool.name).toBe('typescript');
    expect(tsTool.id).toBe('instruction:project:typescript');
    expect(tsTool.type).toBe(ToolType.CustomPrompt);
    expect(tsTool.scope).toBe(ConfigScope.Project);
    expect(tsTool.status).toBe(ToolStatus.Enabled);
    expect(tsTool.metadata.instructionKind).toBe('file-pattern');
    expect(tsTool.metadata.applyTo).toBe('**/*.ts');
    // default description when no description field: "Applies to: {applyTo}"
    expect(tsTool.description).toBe('Applies to: **/*.ts');
    expect(tsTool.metadata.body).toBe('Use strict TypeScript.');
  });

  // Case 3: Per-file instruction with both applyTo and description — description wins
  it('uses description from frontmatter over applyTo fallback when both present', async () => {
    const instructionsDir = path.join(tmpDir, '.github', 'instructions');
    await fs.mkdir(instructionsDir, { recursive: true });
    await fs.writeFile(
      path.join(instructionsDir, 'style.instructions.md'),
      '---\napplyTo: "**"\ndescription: Style guide\n---\nContent',
    );

    const tools = await parseCopilotInstructions(fileIO, tmpDir);

    expect(tools).toHaveLength(1);
    const tool = tools[0];
    expect(tool.name).toBe('style');
    expect(tool.metadata.instructionKind).toBe('file-pattern');
    expect(tool.metadata.applyTo).toBe('**');
    expect(tool.description).toBe('Style guide');
    expect(tool.metadata.body).toBe('Content');
  });

  // Case 4: .github directory does not exist (fresh workspace)
  it('returns [] without throwing when .github directory does not exist', async () => {
    // No .github directory created

    const tools = await parseCopilotInstructions(fileIO, tmpDir);

    expect(tools).toEqual([]);
  });

  // Case 5: copilot-instructions.md does not exist but .github/instructions/ has files
  it('returns only per-file instruction tools when global file is absent', async () => {
    const instructionsDir = path.join(tmpDir, '.github', 'instructions');
    await fs.mkdir(instructionsDir, { recursive: true });
    await fs.writeFile(
      path.join(instructionsDir, 'react.instructions.md'),
      '---\napplyTo: "**/*.tsx"\n---\nUse React best practices.',
    );

    // No copilot-instructions.md

    const tools = await parseCopilotInstructions(fileIO, tmpDir);

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('react');
    expect(tools[0].metadata.instructionKind).toBe('file-pattern');
  });

  // Extra: compound extension filter — plain .md files in instructions/ are NOT included
  it('ignores files without .instructions.md compound extension in instructions dir', async () => {
    const instructionsDir = path.join(tmpDir, '.github', 'instructions');
    await fs.mkdir(instructionsDir, { recursive: true });

    // Compound extension — should be included
    await fs.writeFile(
      path.join(instructionsDir, 'valid.instructions.md'),
      'Valid instruction.',
    );
    // Plain .md — should be excluded
    await fs.writeFile(
      path.join(instructionsDir, 'readme.md'),
      'This should be ignored.',
    );

    const tools = await parseCopilotInstructions(fileIO, tmpDir);

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('valid');
  });

  // Extra: file without frontmatter in instructions dir — extractFrontmatter returns null
  it('handles .instructions.md file with no frontmatter (null extractFrontmatter path)', async () => {
    const instructionsDir = path.join(tmpDir, '.github', 'instructions');
    await fs.mkdir(instructionsDir, { recursive: true });
    await fs.writeFile(
      path.join(instructionsDir, 'plain.instructions.md'),
      'Just some plain content without any frontmatter.',
    );

    const tools = await parseCopilotInstructions(fileIO, tmpDir);

    expect(tools).toHaveLength(1);
    const tool = tools[0];
    expect(tool.name).toBe('plain');
    expect(tool.metadata.body).toBe('Just some plain content without any frontmatter.');
    expect(tool.metadata.applyTo).toBeUndefined();
    expect(tool.description).toBeUndefined();
  });

  // Extra: multiple per-file instructions are sorted alphabetically
  it('sorts multiple per-file instructions alphabetically by name', async () => {
    const instructionsDir = path.join(tmpDir, '.github', 'instructions');
    await fs.mkdir(instructionsDir, { recursive: true });

    await fs.writeFile(path.join(instructionsDir, 'zebra.instructions.md'), 'Zebra content.');
    await fs.writeFile(path.join(instructionsDir, 'alpha.instructions.md'), 'Alpha content.');
    await fs.writeFile(path.join(instructionsDir, 'middle.instructions.md'), 'Middle content.');

    const tools = await parseCopilotInstructions(fileIO, tmpDir);

    expect(tools).toHaveLength(3);
    expect(tools[0].name).toBe('alpha');
    expect(tools[1].name).toBe('middle');
    expect(tools[2].name).toBe('zebra');
  });
});
