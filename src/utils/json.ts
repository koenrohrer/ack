import * as jsonc from 'jsonc-parser';

/**
 * Result of a JSON parse attempt.
 */
export type JsonParseResult =
  | { success: true; data: unknown }
  | { success: false; error: string };

/**
 * Remove trailing commas before closing brackets/braces.
 *
 * String-aware: a `,` inside a string literal is data, so `"echo a, }"` is
 * copied through unchanged. Runs after comments are gone, so a comment
 * between the comma and the bracket cannot hide the trailing comma.
 */
function stripTrailingCommas(content: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];

    if (inString) {
      result += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      result += ch;
      continue;
    }

    if (ch === ',') {
      let next = i + 1;
      while (next < content.length && /\s/.test(content[next])) {
        next++;
      }
      if (content[next] === '}' || content[next] === ']') {
        continue;
      }
    }

    result += ch;
  }

  return result;
}

/**
 * Safely parse JSON content.
 *
 * First tries standard JSON.parse. On failure, removes comments and trailing
 * commas, then retries. Returns a structured result (never throws).
 *
 * Both cleanup steps treat string literals as data. Comments are removed by
 * jsonc-parser's tokenizer, which reads `/* see https://x *\/` as one block
 * comment and `"a//b"` as one string. The retry still goes through JSON.parse,
 * so the lenient path keeps JSON.parse's semantics for everything else --
 * duplicate keys, a `__proto__` key, number precision.
 *
 * This handles the common case of Claude Code config files containing
 * comments and trailing commas (JSONC format).
 */
export function safeJsonParse(content: string): JsonParseResult {
  // Fast path: try standard parse first
  try {
    return { success: true, data: JSON.parse(content) };
  } catch {
    // Lenient path: strip comments and trailing commas
  }

  try {
    const cleaned = stripTrailingCommas(jsonc.stripComments(content));
    return { success: true, data: JSON.parse(cleaned) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Invalid JSON: ${message}` };
  }
}
