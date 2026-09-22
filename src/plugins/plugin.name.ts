/**
 * Plugin name constraints, Agent Plugins 1.0.0 §5.5.
 */

/**
 * Character set plus the alphanumeric start/end rule. Anchored, and `.` in the
 * character class is a literal period -- a name may contain no other
 * punctuation, whitespace, or non-ASCII character.
 */
const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

const MIN_LENGTH = 1;
const MAX_LENGTH = 64;

/**
 * Whether `name` satisfies every §5.5 constraint: length 1-64, the charset
 * `a-z0-9-.`, alphanumeric first and last characters, and no `--` or `..`.
 *
 * Valid: `my-plugin`, `acme.tools`, `lint3r`, `a`.
 * Invalid: `My-Plugin`, `-start`, `has--double`, `too.many..dots`, ``.
 */
export function isValidPluginName(name: string): boolean {
  if (typeof name !== 'string') {
    return false;
  }
  if (name.length < MIN_LENGTH || name.length > MAX_LENGTH) {
    return false;
  }
  if (name.includes('--') || name.includes('..')) {
    return false;
  }
  return NAME_PATTERN.test(name);
}
