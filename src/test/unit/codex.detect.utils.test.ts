import { describe, it, expect } from 'vitest';
import { isCodexInstalled } from '../../providers/codex/codex.detect.utils.js';
import { CodexProvider } from '../../providers/codex/codex.provider.js';
import { CodexPaths } from '../../providers/codex/paths.js';
import { FileIOService } from '../../services/fileio.service.js';
import { SchemaService } from '../../services/schema.service.js';

// ---------------------------------------------------------------------------
// isCodexInstalled (pure marker logic)
// ---------------------------------------------------------------------------

describe('isCodexInstalled', () => {
  it('is false when no Codex-owned marker is present (dir-name collision)', () => {
    expect(isCodexInstalled({ configToml: false, promptsDir: false, skillsDir: false })).toBe(false);
  });

  it('is true when only config.toml is present', () => {
    expect(isCodexInstalled({ configToml: true, promptsDir: false, skillsDir: false })).toBe(true);
  });

  it('is true when only prompts/ is present (no config.toml yet)', () => {
    expect(isCodexInstalled({ configToml: false, promptsDir: true, skillsDir: false })).toBe(true);
  });

  it('is true when only skills/ is present (no config.toml yet)', () => {
    expect(isCodexInstalled({ configToml: false, promptsDir: false, skillsDir: true })).toBe(true);
  });

  it('is true when all markers are present', () => {
    expect(isCodexInstalled({ configToml: true, promptsDir: true, skillsDir: true })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CodexProvider.detect() wiring
// ---------------------------------------------------------------------------

function providerWithExisting(existing: Set<string>): CodexProvider {
  const fileIO = {
    ...new FileIOService(),
    async fileExists(filePath: string): Promise<boolean> {
      return existing.has(filePath);
    },
  } as FileIOService;
  return new CodexProvider(fileIO, new SchemaService());
}

describe('CodexProvider.detect', () => {
  it('returns false for a ~/.codex with no Codex-owned marker (collision)', async () => {
    // The collision directory exists but contains only unrelated files; none of
    // the three marker paths resolve.
    const provider = providerWithExisting(new Set());
    expect(await provider.detect()).toBe(false);
  });

  it('returns true when config.toml exists', async () => {
    const provider = providerWithExisting(new Set([CodexPaths.userConfigToml]));
    expect(await provider.detect()).toBe(true);
  });

  it('returns true when prompts/ exists but config.toml does not', async () => {
    const provider = providerWithExisting(new Set([CodexPaths.userPromptsDir]));
    expect(await provider.detect()).toBe(true);
  });

  it('returns true when skills/ exists but config.toml does not', async () => {
    const provider = providerWithExisting(new Set([CodexPaths.userSkillsDir]));
    expect(await provider.detect()).toBe(true);
  });
});
