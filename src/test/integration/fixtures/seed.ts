import * as fs from 'fs';
import * as path from 'path';

/**
 * On-disk fixtures for the integration suite. The detection-marker helpers write
 * the minimum that makes a provider's detect() return true; the *Full helpers
 * port docs/qa/seed-sandbox.sh so profile / MCP / inline-action tests get a
 * realistic inventory. Everything is written under the per-test sandbox home or
 * the shared workspace -- never the real $HOME.
 */

const EVERYTHING_CMD = 'npx';
const EVERYTHING_ARGS = ['-y', '@modelcontextprotocol/server-everything'];

export async function writeFileEnsured(filePath: string, content: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, content);
}

export async function writeJsonEnsured(filePath: string, obj: unknown): Promise<void> {
  await writeFileEnsured(filePath, JSON.stringify(obj, null, 2) + '\n');
}

export async function mkdirEnsured(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Detection markers (minimal -> detected)
// ---------------------------------------------------------------------------

/** ~/.claude dir + empty skills/commands dirs -> Claude Code detected. */
export async function seedClaudeMarker(home: string): Promise<void> {
  await mkdirEnsured(path.join(home, '.claude', 'skills'));
  await mkdirEnsured(path.join(home, '.claude', 'commands'));
}

/** A Codex marker: config.toml | prompts/ | skills/ (any one -> detected). */
export async function seedCodexMarker(home: string, kind: 'config' | 'prompts' | 'skills'): Promise<void> {
  if (kind === 'config') {
    await writeFileEnsured(path.join(home, '.codex', 'config.toml'), 'model = "gpt-5-codex"\n');
  } else if (kind === 'prompts') {
    await mkdirEnsured(path.join(home, '.codex', 'prompts'));
  } else {
    await mkdirEnsured(path.join(home, '.codex', 'skills'));
  }
}

/** A Pi marker: agent dir | settings.json | mcp.json (any one -> detected). */
export async function seedPiMarker(home: string, kind: 'dir' | 'settings' | 'mcp' = 'settings'): Promise<void> {
  if (kind === 'dir') {
    await mkdirEnsured(path.join(home, '.pi', 'agent'));
  } else if (kind === 'settings') {
    await writeJsonEnsured(path.join(home, '.pi', 'agent', 'settings.json'), { theme: 'default' });
  } else {
    await writeJsonEnsured(path.join(home, '.pi', 'agent', 'mcp.json'), { mcpServers: {} });
  }
}

/** A Hermes marker: ~/.hermes dir | config.yaml (any one -> detected). */
export async function seedHermesMarker(hermesHome: string, kind: 'dir' | 'config' = 'config'): Promise<void> {
  if (kind === 'dir') {
    await mkdirEnsured(hermesHome);
  } else {
    await writeFileEnsured(path.join(hermesHome, 'config.yaml'), 'model: hermes-4\n');
  }
}

// ---------------------------------------------------------------------------
// Richer seeds (ported from docs/qa/seed-sandbox.sh)
// ---------------------------------------------------------------------------

/** Claude Code user scope: a skill, a command, an MCP server, a hook. */
export async function seedClaudeFull(home: string): Promise<void> {
  await writeFileEnsured(
    path.join(home, '.claude', 'skills', 'hello-claude', 'SKILL.md'),
    '---\nname: hello-claude\ndescription: Seeded Claude Code skill.\n---\nbody\n',
  );
  await writeFileEnsured(
    path.join(home, '.claude', 'commands', 'greet.md'),
    '---\ndescription: Seeded greeting command.\nargument-hint: <name>\n---\nSay hello to $1.\n',
  );
  await writeJsonEnsured(path.join(home, '.claude.json'), {
    mcpServers: { everything: { command: EVERYTHING_CMD, args: EVERYTHING_ARGS } },
  });
  await writeJsonEnsured(path.join(home, '.claude', 'settings.json'), {
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo seeded-pretooluse-hook' }] },
      ],
    },
  });
}

/** Codex user scope: config.toml with MCP servers (one disabled), a skill, a prompt. */
export async function seedCodexFull(home: string): Promise<void> {
  await writeFileEnsured(
    path.join(home, '.codex', 'config.toml'),
    [
      'model = "gpt-5-codex"',
      '',
      '[mcp_servers.everything]',
      'command = "npx"',
      'args = ["-y", "@modelcontextprotocol/server-everything"]',
      '',
      '[mcp_servers.disabled_demo]',
      'command = "npx"',
      'args = ["-y", "@modelcontextprotocol/server-time"]',
      'enabled = false',
      '',
    ].join('\n'),
  );
  await writeFileEnsured(
    path.join(home, '.codex', 'skills', 'hello-codex', 'SKILL.md'),
    '---\nname: hello-codex\ndescription: Seeded Codex skill.\n---\nbody\n',
  );
  await writeFileEnsured(
    path.join(home, '.codex', 'prompts', 'review.md'),
    '---\ndescription: Seeded Codex custom prompt.\nargument-hint: <path>\n---\nReview the changes in $1.\n',
  );
}

/** Pi user scope: settings, a skill, a prompt, and an mcp.json with two servers. */
export async function seedPiFull(home: string): Promise<void> {
  await writeJsonEnsured(path.join(home, '.pi', 'agent', 'settings.json'), { theme: 'default' });
  await writeFileEnsured(
    path.join(home, '.pi', 'agent', 'skills', 'hello-pi', 'SKILL.md'),
    '---\nname: hello-pi\ndescription: Seeded Pi skill.\n---\nbody\n',
  );
  await writeFileEnsured(
    path.join(home, '.pi', 'agent', 'prompts', 'review.md'),
    '---\ndescription: Seeded Pi prompt template.\nargument-hint: <path>\n---\nReview $1.\n',
  );
  await writeJsonEnsured(path.join(home, '.pi', 'agent', 'mcp.json'), {
    settings: { toolPrefix: 'mcp' },
    mcpServers: {
      everything: { command: EVERYTHING_CMD, args: EVERYTHING_ARGS, transport: 'stdio', lifecycle: 'lazy' },
      'remote-demo': { url: 'https://mcp.example.com/mcp', transport: 'streamable-http', lifecycle: 'eager' },
    },
  });
}

/** Hermes user scope: config.yaml with MCP servers (one disabled), a skill, SOUL.md. */
export async function seedHermesFull(hermesHome: string): Promise<void> {
  await writeFileEnsured(
    path.join(hermesHome, 'config.yaml'),
    [
      'model: hermes-4',
      'mcp_servers:',
      '  everything:',
      '    command: npx',
      '    args:',
      '      - "-y"',
      '      - "@modelcontextprotocol/server-everything"',
      '    env:',
      '      EXAMPLE_TOKEN: seed-value',
      '  legacy-disabled:',
      '    url: https://mcp.legacy.example/mcp',
      '    enabled: false',
      '',
    ].join('\n'),
  );
  await writeFileEnsured(
    path.join(hermesHome, 'skills', 'hello-hermes', 'SKILL.md'),
    '---\nname: hello-hermes\ndescription: Seeded Hermes skill.\n---\nbody\n',
  );
  await writeFileEnsured(path.join(hermesHome, 'SOUL.md'), 'You are a concise assistant. (Seeded SOUL.md.)\n');
}

// ---------------------------------------------------------------------------
// Sample install sources (folders/files the install flow picks from)
// ---------------------------------------------------------------------------

/** A valid skill folder with a SKILL.md; returns the folder path. */
export async function makeSampleSkillDir(base: string, name = 'sample-skill'): Promise<string> {
  const dir = path.join(base, name);
  await writeFileEnsured(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: demo\n---\nbody\n`,
  );
  return dir;
}

/** A single-file command markdown; returns the file path. */
export async function makeSampleCommandFile(base: string, name = 'mycmd.md'): Promise<string> {
  const file = path.join(base, name);
  await writeFileEnsured(file, '---\ndescription: hi\n---\nhello\n');
  return file;
}

/** A multi-file command folder (a.md + b.md); returns the folder path. */
export async function makeSampleCommandFolder(base: string, name = 'mycmd-folder'): Promise<string> {
  const dir = path.join(base, name);
  await writeFileEnsured(path.join(dir, 'a.md'), 'a\n');
  await writeFileEnsured(path.join(dir, 'b.md'), 'b\n');
  return dir;
}

/** An empty folder (no files) used to assert the empty-install rejection. */
export async function makeEmptyDir(base: string, name = 'empty-skill'): Promise<string> {
  const dir = path.join(base, name);
  await mkdirEnsured(dir);
  return dir;
}
