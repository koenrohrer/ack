import { expect } from 'vitest';

/**
 * Fixtures and byte-exact assertions for the binary skill-asset contract.
 *
 * A skill's `assets/` directory (the Agent Skills layout that Agent Plugins
 * 1.0.0 §7.1 defers to) may hold genuinely binary files. Reading each one as
 * UTF-8 and writing it back as UTF-8 replaces every byte that is not valid
 * UTF-8 with U+FFFD, silently: a 33-byte PNG comes back 35 bytes long with its
 * `89504e47` signature turned into `efbfbd504e47`, no error raised.
 *
 * The contract these fixtures grade: a file whose bytes survive a UTF-8
 * decode/encode round trip unchanged is carried as a `string`; one that does
 * not is carried as a `Uint8Array`. Classification is exactly that round trip
 * and nothing else -- NOT an extension allowlist -- so a `.txt` full of
 * Latin-1 bytes is binary and an `.svg` is text.
 *
 * Shared by `plugin.install.service.test.ts` (the reader half) and
 * `install-skill.nested.test.ts` (the writer / provider half) so the two cannot
 * drift apart on what "the same PNG" means.
 *
 * None of the expectations below is a golden value captured from a run. Every
 * assertion compares against the exact byte array the test itself wrote to
 * disk, so "correct" means "identical to the input" -- which is the entire
 * requirement.
 */

/** The widened file-content contract: text as a string, bytes as a Uint8Array. */
export type WidenedContent = string | Uint8Array;

/** A skill-tree file under the widened contract. */
export interface WidenedFile {
  name: string;
  content: WidenedContent;
}

/**
 * The first 33 bytes of a 1x1 RGBA PNG: the 8-byte signature plus the IHDR
 * length, type and body.
 *
 * `0x89` opens the signature precisely because it is not valid UTF-8 -- the
 * format chose a high-bit first byte so that a text-mode transfer would be
 * detectable. That is exactly the corruption under test, which makes this the
 * fixture with the least room for a false pass.
 */
export const PNG_BYTES: Uint8Array = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature: \x89 P N G \r \n \x1a \n
  0x00, 0x00, 0x00, 0x0d, // IHDR chunk length: 13
  0x49, 0x48, 0x44, 0x52, // "IHDR"
  0x00, 0x00, 0x00, 0x01, // width  1
  0x00, 0x00, 0x00, 0x01, // height 1
  0x08, 0x06, 0x00, 0x00, 0x00, // bit depth 8, colour type 6, deflate, adaptive, no interlace
  0x1f, 0x15, 0xc4, 0x89, // CRC
]);

/**
 * `"Café naïve, résumé.\n"` encoded as Latin-1 -- 20 bytes.
 *
 * Textually innocent and, in the tests, given a `.txt` name. But `0xE9` opens a
 * three-byte UTF-8 sequence and is followed by a space, so these bytes are not
 * valid UTF-8. Any classifier that decides by extension calls this text and
 * corrupts it; the round-trip test calls it binary.
 */
export const LATIN1_BYTES: Uint8Array = Uint8Array.from([
  0x43, 0x61, 0x66, 0xe9, 0x20, // "Caf" + é + " "
  0x6e, 0x61, 0xef, 0x76, 0x65, 0x2c, 0x20, // "na" + ï + "ve, "
  0x72, 0xe9, 0x73, 0x75, 0x6d, 0xe9, 0x2e, 0x0a, // "r" + é + "sum" + é + ".\n"
]);

/**
 * Multi-byte UTF-8 that must stay a `string`: two-byte accented Latin, a
 * three-byte BMP symbol and a four-byte astral emoji.
 *
 * This is the false-positive guard for the whole change. Without it, an
 * implementation that returns a `Uint8Array` for anything non-ASCII passes
 * every binary test in the suite while quietly changing the type of most real
 * skill documentation.
 */
export const UTF8_TEXT = '# Café ☕ naïve 🚀\n\nDéjà vu — “curly” quotes.\n';

/** An SVG is text, whatever a `assets/` heuristic might assume of the folder. */
export const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>\n';

/** UTF-8 bytes of a string, exactly as the install path writes them. */
export function utf8(text: string): Uint8Array {
  return Uint8Array.from(Buffer.from(text, 'utf-8'));
}

/**
 * The bytes either arm of the contract stands for.
 *
 * A `string` arm is encoded as UTF-8, which is what the writer does with it, so
 * a value corrupted on the way in surfaces here as the bytes that would land on
 * disk rather than as a decoded string that hides the damage.
 */
export function toBytes(content: WidenedContent): Buffer {
  return typeof content === 'string' ? Buffer.from(content, 'utf-8') : Buffer.from(content);
}

/**
 * Assert byte-exact equality, naming `label` in the failure.
 *
 * `Buffer.equals` is the assertion of record: comparing two decoded strings can
 * report a match while both sides are equally mangled, since U+FFFD equals
 * U+FFFD. The hex comparison runs first only so a failure prints the diverging
 * bytes instead of `expected false to be true`.
 */
export function expectSameBytes(actual: WidenedContent, expected: Uint8Array, label: string): void {
  const got = toBytes(actual);
  const want = Buffer.from(expected);
  expect(got.toString('hex'), `${label}: bytes differ`).toBe(want.toString('hex'));
  expect(got.equals(want), `${label}: Buffer.equals`).toBe(true);
}

/** One file's content by name, with a failure that lists what the tree held. */
export function contentOf(files: readonly WidenedFile[], name: string): WidenedContent {
  const file = files.find((entry) => entry.name === name);
  if (file === undefined) {
    throw new Error(
      `no file named ${JSON.stringify(name)}; the tree held ${JSON.stringify(files.map((entry) => entry.name))}`,
    );
  }
  return file.content;
}
