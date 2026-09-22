import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Reading a skill directory as the whole tree it is, Agent Plugins 1.0.0 §7.1.
 *
 * §7.1 defers the skill layout to the Agent Skills specification, whose
 * `scripts/`, `references/` and `assets/` directories sit beside `SKILL.md`.
 * `readDirFiles` (`src/services/local-install.utils.ts`) is deliberately flat --
 * it serves the hand-picked single-folder install and reports subdirectories as
 * skipped -- so a plugin skill read that way installs as a skill that looks
 * installed and does not work. Plugins therefore get their own reader rather
 * than a recursion flag on the flat one.
 *
 * Names are always `/`-separated. They are joined onto a target directory by
 * `writeSkillTree` (`src/providers/shared/skill-tree.ts`), so the separator is
 * part of the contract: a `\` from `path.join` on Windows would produce one
 * flat file literally named `references\checklist.md`.
 *
 * No `vscode` here -- the fan-out path this feeds has to stay loadable, and
 * testable, outside the extension host.
 */

/**
 * One file of a skill tree: its POSIX relative path, and its content.
 *
 * `content` is a `string` for text and a `Uint8Array` for anything else. A
 * skill's `assets/` may hold genuinely binary files, and decoding those as
 * UTF-8 replaces every invalid byte with U+FFFD silently -- a PNG's `89504e47`
 * signature comes back as `efbfbd504e47`, two bytes longer and unopenable.
 */
export interface SkillTreeFile {
  name: string;
  content: string | Uint8Array;
}

/**
 * Every regular file beneath `dir`, at any depth, relative to `dir`.
 *
 * Sorted by name in codepoint order rather than returned in readdir order: a
 * tmpfs reports creation order and ext4 a directory-hash order, so a forwarded
 * readdir would make the file list handed to a provider -- and any message
 * derived from it -- depend on the filesystem underneath.
 *
 * An empty subdirectory contributes nothing: the writer creates each parent
 * from the name it is given, so an entry carrying no file has nothing to carry.
 *
 * Entries that are neither a regular file nor a directory are skipped. The
 * store's copy has already dereferenced every symlink that stayed inside the
 * plugin root and refused every one that left it (§4.1), so a link surviving to
 * here is not package content this reader should follow.
 */
export async function readSkillTree(dir: string): Promise<SkillTreeFile[]> {
  const files: SkillTreeFile[] = [];
  await collectInto(dir, '', files);
  return files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Depth-first walk; `prefix` is the POSIX path of `dir` relative to the root. */
async function collectInto(dir: string, prefix: string, files: SkillTreeFile[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await collectInto(full, name, files);
    } else if (entry.isFile()) {
      files.push({ name, content: classify(await fs.readFile(full)) });
    }
  }
}

/**
 * A file's bytes as a `string` if they are UTF-8, otherwise as the bytes.
 *
 * The test is a UTF-8 decode/encode round trip and nothing else. Deciding by
 * extension would be wrong in both directions: a `.txt` full of Latin-1 is
 * binary, an `.svg` under `assets/` is text. Node's decoder never fails -- it
 * substitutes U+FFFD -- so re-encoding and comparing is what turns that silent
 * substitution into an answer.
 *
 * A zero-byte file round-trips trivially and so is the empty string, which is
 * also what every caller before the widening got for it.
 */
function classify(bytes: Buffer): string | Uint8Array {
  const text = bytes.toString('utf-8');
  return Buffer.from(text, 'utf-8').equals(bytes) ? text : new Uint8Array(bytes);
}
