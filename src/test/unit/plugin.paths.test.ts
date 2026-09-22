import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { isContained, resolvePluginRelative } from '../../plugins/plugin.paths.js';

/**
 * Agent Plugins 1.0.0 §4.1 — plugin package model.
 *
 * "When a client discovers, reads, or executes a file or directory supplied by
 *  the plugin package, the filesystem-resolved path MUST remain within the
 *  filesystem-resolved plugin root."
 *
 * "A configuration field defined by this specification as a plugin-relative
 *  path MUST begin with './', be resolved against the plugin root, and remain
 *  within the filesystem-resolved plugin root after resolution."
 *
 * Both functions are awaited so the contract holds whether the implementation
 * resolves symlinks synchronously or asynchronously; the asserted values are
 * exact either way.
 */

// Symlink creation is unprivileged on POSIX but not always on Windows.
const itSymlink = process.platform === 'win32' ? it.skip : it;

let root: string;
let outside: string;

beforeEach(async () => {
  // realpath() both roots: on macOS os.tmpdir() is itself a symlink into
  // /private/var, which would make every containment answer wrong by accident.
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-paths-root-')));
  outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-paths-out-')));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// isContained
// ---------------------------------------------------------------------------

describe('isContained', () => {
  it('accepts a regular file directly inside the plugin root', async () => {
    const file = path.join(root, 'plugin.json');
    await fs.writeFile(file, '{}', 'utf-8');
    expect(await isContained(root, file)).toBe(true);
  });

  it('accepts a deeply nested path inside the plugin root', async () => {
    const dir = path.join(root, 'skills', 'summarize');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'SKILL.md');
    await fs.writeFile(file, '# skill', 'utf-8');
    expect(await isContained(root, file)).toBe(true);
  });

  it('accepts the plugin root itself', async () => {
    expect(await isContained(root, root)).toBe(true);
  });

  it('rejects a directory outside the plugin root', async () => {
    const file = path.join(outside, 'secret.txt');
    await fs.writeFile(file, 'nope', 'utf-8');
    expect(await isContained(root, file)).toBe(false);
  });

  it('rejects a sibling whose absolute path merely shares the root string prefix', async () => {
    // `${root}-sibling` starts with `${root}` as a string but is NOT inside it.
    // A naive `candidate.startsWith(root)` check passes this by mistake.
    const sibling = `${root}-sibling`;
    await fs.mkdir(sibling, { recursive: true });
    try {
      const file = path.join(sibling, 'file.txt');
      await fs.writeFile(file, 'x', 'utf-8');
      expect(await isContained(root, file)).toBe(false);
    } finally {
      await fs.rm(sibling, { recursive: true, force: true });
    }
  });

  it('rejects a path that traverses out of the root with ..', async () => {
    const file = path.join(outside, 'escape.txt');
    await fs.writeFile(file, 'x', 'utf-8');
    const traversal = path.join(root, '..', path.basename(outside), 'escape.txt');
    expect(await isContained(root, traversal)).toBe(false);
  });

  itSymlink('rejects a symlink inside the root whose target escapes the root', async () => {
    const target = path.join(outside, 'escape.txt');
    await fs.writeFile(target, 'x', 'utf-8');
    const link = path.join(root, 'escape-link');
    await fs.symlink(target, link);
    expect(await isContained(root, link)).toBe(false);
  });

  itSymlink('rejects a symlinked directory inside the root whose target escapes the root', async () => {
    const targetDir = path.join(outside, 'bin');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, 'server'), '#!/bin/sh', 'utf-8');
    const link = path.join(root, 'bin');
    await fs.symlink(targetDir, link);
    expect(await isContained(root, path.join(link, 'server'))).toBe(false);
  });

  itSymlink('accepts a symlink inside the root whose target is also inside the root', async () => {
    const target = path.join(root, 'real.txt');
    await fs.writeFile(target, 'x', 'utf-8');
    const link = path.join(root, 'alias.txt');
    await fs.symlink(target, link);
    expect(await isContained(root, link)).toBe(true);
  });

  // Containment MUST NOT require the target to exist. §7.2.2.5 makes a server
  // that fails to start a *connection* failure and explicitly not invalid
  // configuration, so a `command: "./bin/server"` naming a not-yet-built
  // artifact is valid config. An ENOENT-throwing realpath would wrongly demote
  // that to a config error. The rule: realpath the nearest existing ancestor,
  // rejoin the remaining segments, then test containment on the result.

  it('accepts a path inside the root whose final segment does not exist yet', async () => {
    await fs.mkdir(path.join(root, 'bin'), { recursive: true });
    expect(await isContained(root, path.join(root, 'bin', 'not-built-yet'))).toBe(true);
  });

  it('accepts a path inside the root none of whose segments exist yet', async () => {
    expect(await isContained(root, path.join(root, 'a', 'b', 'c'))).toBe(true);
  });

  it('rejects a non-existent path outside the root', async () => {
    expect(await isContained(root, path.join(outside, 'never', 'created'))).toBe(false);
  });

  itSymlink('rejects a non-existent path beneath a symlink that escapes the root', async () => {
    // The nearest existing ancestor is the escaping symlink itself, so the
    // "resolve the ancestor" rule must not lose the escape.
    const targetDir = path.join(outside, 'bin');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.symlink(targetDir, path.join(root, 'bin'));
    expect(await isContained(root, path.join(root, 'bin', 'not-built-yet'))).toBe(false);
  });

  itSymlink('resolves the plugin root itself through a symlink before comparing', async () => {
    const linkedRoot = path.join(outside, 'linked-root');
    await fs.symlink(root, linkedRoot);
    const file = path.join(root, 'inside.txt');
    await fs.writeFile(file, 'x', 'utf-8');
    // The root is given via its symlinked path; the candidate via its real path.
    expect(await isContained(linkedRoot, file)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolvePluginRelative
// ---------------------------------------------------------------------------

describe('resolvePluginRelative', () => {
  it('resolves a ./ path to its absolute location inside the plugin root', async () => {
    const dir = path.join(root, 'bin');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'server'), '#!/bin/sh', 'utf-8');
    expect(await resolvePluginRelative(root, './bin/server')).toBe(path.join(root, 'bin', 'server'));
  });

  it('resolves ./ on its own to the plugin root', async () => {
    expect(await resolvePluginRelative(root, './')).toBe(root);
  });

  it('rejects a bare relative path that does not begin with ./', async () => {
    // §4.1 example: `cwd: "data"` is invalid even though `data/` exists.
    await fs.mkdir(path.join(root, 'data'), { recursive: true });
    expect(await resolvePluginRelative(root, 'data')).toBeNull();
  });

  it('rejects "." because it does not begin with "./"', async () => {
    expect(await resolvePluginRelative(root, '.')).toBeNull();
  });

  it('rejects a ../ path', async () => {
    // §4.1 example: `command: "../bin/server"` escapes the plugin root.
    expect(await resolvePluginRelative(root, '../bin/server')).toBeNull();
  });

  it('rejects an absolute path', async () => {
    expect(await resolvePluginRelative(root, path.join(root, 'bin', 'server'))).toBeNull();
  });

  it('rejects the empty string', async () => {
    expect(await resolvePluginRelative(root, '')).toBeNull();
  });

  it('resolves a ./ path whose final segment does not exist yet', async () => {
    // `bin/` exists, `bin/server` has not been built. Valid configuration.
    await fs.mkdir(path.join(root, 'bin'), { recursive: true });
    expect(await resolvePluginRelative(root, './bin/server')).toBe(path.join(root, 'bin', 'server'));
  });

  it('resolves a ./ path none of whose segments exist yet', async () => {
    expect(await resolvePluginRelative(root, './a/b/c')).toBe(path.join(root, 'a', 'b', 'c'));
  });

  it('rejects a ./ path that escapes the root even when nothing along it exists', async () => {
    expect(await resolvePluginRelative(root, './../never-created/escape')).toBeNull();
  });

  it('rejects a ./ path that traverses back out of the root', async () => {
    await fs.mkdir(path.join(outside, 'bin'), { recursive: true });
    await fs.writeFile(path.join(outside, 'bin', 'server'), '#!/bin/sh', 'utf-8');
    const escape = `./../${path.basename(outside)}/bin/server`;
    expect(await resolvePluginRelative(root, escape)).toBeNull();
  });

  itSymlink('rejects a ./ path whose final component symlinks outside the root', async () => {
    const target = path.join(outside, 'server');
    await fs.writeFile(target, '#!/bin/sh', 'utf-8');
    await fs.mkdir(path.join(root, 'bin'), { recursive: true });
    await fs.symlink(target, path.join(root, 'bin', 'server'));
    expect(await resolvePluginRelative(root, './bin/server')).toBeNull();
  });

  itSymlink('rejects a ./ path whose intermediate directory symlinks outside the root', async () => {
    const targetDir = path.join(outside, 'bin');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, 'server'), '#!/bin/sh', 'utf-8');
    await fs.symlink(targetDir, path.join(root, 'bin'));
    expect(await resolvePluginRelative(root, './bin/server')).toBeNull();
  });
});
