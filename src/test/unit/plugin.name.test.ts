import { describe, it, expect } from 'vitest';
import { isValidPluginName } from '../../plugins/plugin.name.js';

/**
 * Agent Plugins 1.0.0 §5.5 — plugin name constraints.
 *
 *   Length        1-64 characters inclusive
 *   Character set a-z, 0-9, '-', '.' only
 *   Start / end   first and last character MUST be alphanumeric
 *   Repetition    no '--' and no '..'
 */

const VALID_NAMES: Array<[string, string]> = [
  ['my-plugin', 'hyphenated lowercase (spec example)'],
  ['acme.tools', 'periods are allowed (spec example)'],
  ['lint3r', 'digits inside the name (spec example)'],
  ['a', 'single alphanumeric character is the minimum length'],
  ['0', 'a single digit is alphanumeric'],
  ['a1.b2-c3', 'hyphens and periods mixed, alphanumeric at both ends'],
  ['a-.b', 'a hyphen next to a period is neither "--" nor ".."'],
  ['a'.repeat(64), 'exactly 64 characters is the inclusive maximum'],
];

const INVALID_NAMES: Array<[string, string]> = [
  ['My-Plugin', 'uppercase is outside the character set'],
  ['-start', 'leading hyphen is not alphanumeric'],
  ['end-', 'trailing hyphen is not alphanumeric'],
  ['.start', 'leading period is not alphanumeric'],
  ['end.', 'trailing period is not alphanumeric'],
  ['has--double', 'consecutive hyphens'],
  ['too.many..dots', 'consecutive periods'],
  ['', 'empty string is below the minimum length'],
  ['a'.repeat(65), '65 characters exceeds the maximum'],
  ['under_score', 'underscore is outside the character set'],
  ['has space', 'space is outside the character set'],
  ['sl/ash', 'path separator is outside the character set'],
  ['naïve', 'non-ASCII is outside the character set'],
  ['a+b', 'plus is outside the character set'],
  ['--', 'consecutive hyphens with no alphanumeric characters at all'],
  ['a..b', 'consecutive periods in the middle'],
];

describe('isValidPluginName', () => {
  for (const [name, why] of VALID_NAMES) {
    it(`accepts ${JSON.stringify(name.length > 20 ? `${name.slice(0, 8)}…(${name.length})` : name)} — ${why}`, () => {
      expect(isValidPluginName(name)).toBe(true);
    });
  }

  for (const [name, why] of INVALID_NAMES) {
    it(`rejects ${JSON.stringify(name.length > 20 ? `${name.slice(0, 8)}…(${name.length})` : name)} — ${why}`, () => {
      expect(isValidPluginName(name)).toBe(false);
    });
  }

  it('is anchored — a valid name embedded in an invalid one is still rejected', () => {
    // Catches an unanchored regex that matches anywhere in the string.
    expect(isValidPluginName('BAD my-plugin BAD')).toBe(false);
    expect(isValidPluginName('my-plugin\n')).toBe(false);
    expect(isValidPluginName('\nmy-plugin')).toBe(false);
  });
});
