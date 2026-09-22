import * as path from 'path';
import { ProviderConfigError } from '../../types/provider-errors.js';

/**
 * Write a skill's file set into its skill directory, nested names included.
 *
 * A conformant skill is a directory tree -- `SKILL.md` alongside `scripts/`,
 * `references/` and `assets/` (Agent Skills spec, referenced by Agent Plugins
 * §7.1) -- so `file.name` may be a nested relative path of arbitrary depth.
 * Each file's parent directory is created before the write; a flat name has no
 * parent to create, so flat installs land exactly where they always did.
 *
 * Shared by every provider whose skills are directory-shaped (claude-code,
 * codex, pi, hermes). Copilot is deliberately not a caller: it cannot host a
 * directory-shaped skill and flattens into `.github/agents/` instead.
 *
 * A `content` may be raw bytes -- a skill's `assets/` can hold binary files.
 * `fs.writeFile` ignores the encoding argument for a TypedArray and writes the
 * bytes verbatim, so the byte arm needs no branch here; adding a `String(...)`
 * or `Buffer.from(...).toString()` step would reintroduce the corruption this
 * contract exists to prevent.
 */
export async function writeSkillTree(
  agentName: string,
  targetDir: string,
  files: Array<{ name: string; content: string | Uint8Array }>,
): Promise<void> {
  const { mkdir, writeFile } = await import('fs/promises');
  const root = path.resolve(targetDir);

  // Resolve every destination before writing any of them, and reject the whole
  // install if one escapes the skill directory -- so a rejected name never
  // leaves a half-written skill on disk. Skill files can come from a
  // downloaded, untrusted plugin tree, so `../escape.md` is a real input.
  //
  // Failing closed by throwing, rather than silently skipping the offending
  // file, is deliberate: a dropped file makes a broken skill look successfully
  // installed. A throw lets the caller report that one skill as skipped with a
  // diagnostic -- loud at the seam, isolated at the orchestrator (§11.3).
  //
  // The strict-inside test also covers the degenerate names -- `""`, `"."`,
  // `"./"` -- which resolve to the skill directory itself.
  const targets = files.map((file) => {
    const filePath = path.resolve(path.join(root, file.name));
    if (!isStrictlyInside(root, filePath)) {
      throw new ProviderConfigError(
        agentName,
        `skill file "${file.name}" resolves outside the skill directory`,
      );
    }
    return { filePath, content: file.content };
  });

  await mkdir(root, { recursive: true });
  for (const { filePath, content } of targets) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf-8');
  }
}

/**
 * Whether `candidate` lies strictly beneath `root` -- inside it, and not it.
 *
 * Compares path segments rather than string prefixes, so `${root}-sibling`
 * does not count as contained.
 */
function isStrictlyInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
