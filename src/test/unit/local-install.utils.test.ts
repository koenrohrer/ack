import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  readDirFiles,
  resolveInstallScopes,
  buildInstalledMessage,
} from '../../services/local-install.utils.js';
import { ConfigScope } from '../../types/enums.js';
import { ProviderScopeError } from '../../types/provider-errors.js';

// ---------------------------------------------------------------------------
// readDirFiles
// ---------------------------------------------------------------------------

describe('readDirFiles', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('reads top-level files and reports skipped subdirectories', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'local-install-'));
    await fs.writeFile(path.join(tmpDir, 'SKILL.md'), '# skill', 'utf-8');
    await fs.writeFile(path.join(tmpDir, 'helper.txt'), 'hello', 'utf-8');
    await fs.mkdir(path.join(tmpDir, 'scripts'));
    await fs.writeFile(path.join(tmpDir, 'scripts', 'run.py'), 'print(1)', 'utf-8');

    const { files, skippedDirs } = await readDirFiles(tmpDir);

    expect(files.map((f) => f.name).sort()).toEqual(['SKILL.md', 'helper.txt']);
    expect(files.find((f) => f.name === 'SKILL.md')?.content).toBe('# skill');
    expect(skippedDirs).toEqual(['scripts']);
  });

  it('returns empty arrays for an empty directory', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'local-install-'));
    const { files, skippedDirs } = await readDirFiles(tmpDir);
    expect(files).toEqual([]);
    expect(skippedDirs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveInstallScopes
// ---------------------------------------------------------------------------

const throwScope = (label: string) => (scope: ConfigScope): string => {
  throw new ProviderScopeError(label, scope, 'test');
};

describe('resolveInstallScopes', () => {
  it('returns User and Project when both resolve and a workspace is open', () => {
    const provider = {
      getSkillsDir: (s: ConfigScope) => `/skills/${s}`,
      getCommandsDir: (s: ConfigScope) => `/commands/${s}`,
    };
    expect(resolveInstallScopes(provider, 'skill', true)).toEqual([
      ConfigScope.User,
      ConfigScope.Project,
    ]);
  });

  it('returns only User when no workspace is open', () => {
    const provider = {
      getSkillsDir: (s: ConfigScope) => `/skills/${s}`,
      getCommandsDir: (s: ConfigScope) => `/commands/${s}`,
    };
    expect(resolveInstallScopes(provider, 'skill', false)).toEqual([ConfigScope.User]);
  });

  it('drops Project when only User resolves', () => {
    const provider = {
      getSkillsDir: (s: ConfigScope) => {
        if (s === ConfigScope.Project) {
          throw new ProviderScopeError('x', s, 'no workspace');
        }
        return `/skills/${s}`;
      },
      getCommandsDir: throwScope('x'),
    };
    expect(resolveInstallScopes(provider, 'skill', true)).toEqual([ConfigScope.User]);
  });

  it('falls back to Project when nothing resolves but a workspace is open (Copilot-like)', () => {
    const provider = {
      getSkillsDir: throwScope('GitHub Copilot'),
      getCommandsDir: throwScope('GitHub Copilot'),
    };
    expect(resolveInstallScopes(provider, 'skill', true)).toEqual([ConfigScope.Project]);
  });

  it('returns no scopes when nothing resolves and no workspace is open', () => {
    const provider = {
      getSkillsDir: throwScope('GitHub Copilot'),
      getCommandsDir: throwScope('GitHub Copilot'),
    };
    expect(resolveInstallScopes(provider, 'skill', false)).toEqual([]);
  });

  it('uses getCommandsDir for the command type', () => {
    const provider = {
      getSkillsDir: throwScope('x'),
      getCommandsDir: (s: ConfigScope) => `/commands/${s}`,
    };
    expect(resolveInstallScopes(provider, 'command', true)).toEqual([
      ConfigScope.User,
      ConfigScope.Project,
    ]);
  });
});

// ---------------------------------------------------------------------------
// buildInstalledMessage
// ---------------------------------------------------------------------------

describe('buildInstalledMessage', () => {
  it('uses singular for one file and omits the skipped note', () => {
    expect(buildInstalledMessage('Skill', 'my-skill', 1, [])).toBe(
      'Skill "my-skill" installed (1 file).',
    );
  });

  it('uses plural for multiple files', () => {
    expect(buildInstalledMessage('Command', 'deploy', 3, [])).toBe(
      'Command "deploy" installed (3 files).',
    );
  });

  it('appends skipped subfolders when present', () => {
    expect(buildInstalledMessage('Skill', 'my-skill', 2, ['scripts', 'assets'])).toBe(
      'Skill "my-skill" installed (2 files). Subfolders not copied: scripts, assets.',
    );
  });
});
