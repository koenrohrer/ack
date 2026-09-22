import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  readDirFiles,
  resolveInstallScopes,
  resolvePluginInstallScopes,
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
// resolveInstallScopes -- 'mcp_server', and the plugin scope union
//
// An Agent Plugin can ship skills, MCP servers, or both, so the scope policy
// for `ack.installPlugin` cannot be decided by probing skills alone. These
// fakes pin provider SHAPES, never provider identity: the fix must be driven by
// which probe resolves, so an implementation that branches on `provider.id`
// fails here.
// ---------------------------------------------------------------------------

/** The three probes `resolveInstallScopes` may consult, as a minimal fake. */
interface ScopeProbes {
  getSkillsDir: (scope: ConfigScope) => string;
  getCommandsDir: (scope: ConfigScope) => string;
  getMcpFilePath: (scope: ConfigScope) => string;
}

const resolveEveryScope = (prefix: string) => (scope: ConfigScope): string =>
  `/${prefix}/${scope}`;

const resolveUserOnly = (label: string, prefix: string) => (scope: ConfigScope): string => {
  if (scope !== ConfigScope.User) {
    throw new ProviderScopeError(label, scope, 'no such scope');
  }
  return `/${prefix}/${scope}`;
};

/** Every probe resolves for every scope -- Claude Code-like. */
const fullProvider: ScopeProbes = {
  getSkillsDir: resolveEveryScope('skills'),
  getCommandsDir: resolveEveryScope('commands'),
  getMcpFilePath: resolveEveryScope('mcp'),
};

/**
 * Copilot's shape with NO workspace open: `getSkillsDir` is unwired and throws
 * for every scope, while `getMcpFilePath(User)` resolves to the VS Code user
 * `mcp.json`. This is the exact configuration that made an MCP-only plugin
 * uninstallable.
 */
const copilotShapedNoWorkspace: ScopeProbes = {
  getSkillsDir: throwScope('GitHub Copilot'),
  getCommandsDir: throwScope('GitHub Copilot'),
  getMcpFilePath: resolveUserOnly('GitHub Copilot', 'mcp'),
};

/** Copilot's shape WITH a workspace: still no skills dir, but both MCP scopes resolve. */
const copilotShapedWithWorkspace: ScopeProbes = {
  getSkillsDir: throwScope('GitHub Copilot'),
  getCommandsDir: throwScope('GitHub Copilot'),
  getMcpFilePath: resolveEveryScope('mcp'),
};

/**
 * MCP reaches further than the directory probes: skills/commands are User-only,
 * `getMcpFilePath` resolves everywhere. Asserting both scopes here can only pass
 * if `getMcpFilePath` is the probe consulted -- a fake where all three probes
 * resolve everywhere would pass on the unfixed helper via `getCommandsDir`.
 */
const mcpWiderThanDirs: ScopeProbes = {
  getSkillsDir: resolveUserOnly('Wide MCP', 'skills'),
  getCommandsDir: resolveUserOnly('Wide MCP', 'commands'),
  getMcpFilePath: resolveEveryScope('mcp'),
};

/** Hermes' shape: skills resolve anywhere, but its MCP config has no project scope. */
const hermesShaped: ScopeProbes = {
  getSkillsDir: resolveEveryScope('skills'),
  getCommandsDir: resolveEveryScope('commands'),
  getMcpFilePath: resolveUserOnly('Hermes', 'config.yaml'),
};

/** Nothing resolves anywhere -- the only case where "no install location" is honest. */
const noLocationProvider: ScopeProbes = {
  getSkillsDir: throwScope('Nowhere'),
  getCommandsDir: throwScope('Nowhere'),
  getMcpFilePath: throwScope('Nowhere'),
};

describe("resolveInstallScopes -- 'mcp_server'", () => {
  it('probes getMcpFilePath and returns both scopes when both MCP scopes resolve', () => {
    expect(resolveInstallScopes(mcpWiderThanDirs, 'mcp_server', true)).toEqual([
      ConfigScope.User,
      ConfigScope.Project,
    ]);
  });

  it('returns User for a Copilot-shaped provider with no workspace, where no skills dir resolves', () => {
    expect(resolveInstallScopes(copilotShapedNoWorkspace, 'mcp_server', false)).toEqual([
      ConfigScope.User,
    ]);
  });

  it('ignores getSkillsDir and getCommandsDir: a Hermes-shaped provider with a workspace yields User only', () => {
    // Both directory probes resolve for Project here; only getMcpFilePath does
    // not. Returning Project would mean the helper consulted the wrong probe.
    expect(resolveInstallScopes(hermesShaped, 'mcp_server', true)).toEqual([ConfigScope.User]);
  });

  // The next two are a deliberate pair: SAME provider, SAME hasWorkspace, only
  // the type differs. The Project fallback exists because Copilot's installSkill
  // writes to `.github/agents/` without a resolvable dir; no provider has that
  // shape for MCP, so an unresolvable MCP path means genuinely nowhere to land.
  it("'skill' falls back to Project when nothing resolves and a workspace is open", () => {
    expect(resolveInstallScopes(noLocationProvider, 'skill', true)).toEqual([ConfigScope.Project]);
  });

  it("'mcp_server' does NOT fall back to Project when nothing resolves, even with a workspace open", () => {
    expect(resolveInstallScopes(noLocationProvider, 'mcp_server', true)).toEqual([]);
  });
});

describe('resolveInstallScopes -- skill/command behaviour is unchanged by the MCP probe', () => {
  it("'skill' with a workspace still returns Project for a Copilot-shaped provider, despite getMcpFilePath resolving", () => {
    expect(resolveInstallScopes(copilotShapedNoWorkspace, 'skill', true)).toEqual([
      ConfigScope.Project,
    ]);
  });

  it("'skill' with no workspace still returns no scopes for a Copilot-shaped provider, despite getMcpFilePath(User) resolving", () => {
    expect(resolveInstallScopes(copilotShapedNoWorkspace, 'skill', false)).toEqual([]);
  });

  it("'command' with a workspace still falls back to Project for a Copilot-shaped provider", () => {
    expect(resolveInstallScopes(copilotShapedNoWorkspace, 'command', true)).toEqual([
      ConfigScope.Project,
    ]);
  });
});

describe('resolvePluginInstallScopes', () => {
  it('offers User to a Copilot-shaped agent with no workspace, so an MCP-only plugin can install', () => {
    // The motivating regression: skills probe empty + no workspace previously
    // produced [], and the command reported "no install location available"
    // even though Copilot's user mcp.json resolves fine (addendum §A5).
    expect(resolvePluginInstallScopes(copilotShapedNoWorkspace, false)).toEqual([ConfigScope.User]);
  });

  it('unions the skill and MCP scopes without duplicates, User before Project', () => {
    // Both component types are viable in both scopes; a naive concat would
    // yield [User, Project, User, Project].
    expect(resolvePluginInstallScopes(fullProvider, true)).toEqual([
      ConfigScope.User,
      ConfigScope.Project,
    ]);
  });

  it('keeps the stable User-before-Project order when the skill fallback contributes Project', () => {
    // skill -> [Project] (fallback), mcp_server -> [User, Project].
    // Order must come from the scope ordering, not from concat order.
    expect(resolvePluginInstallScopes(copilotShapedWithWorkspace, true)).toEqual([
      ConfigScope.User,
      ConfigScope.Project,
    ]);
  });

  it('keeps the skill Project fallback in the union when MCP has nowhere to land', () => {
    expect(resolvePluginInstallScopes(noLocationProvider, true)).toEqual([ConfigScope.Project]);
  });

  it('returns no scopes when neither skills nor MCP resolve and no workspace is open', () => {
    // The only case where the command may honestly say "no install location".
    expect(resolvePluginInstallScopes(noLocationProvider, false)).toEqual([]);
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
