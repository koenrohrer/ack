/**
 * Result of a JSON parse attempt.
 */
export type JsonParseResult =
  | { success: true; data: unknown }
  | { success: false; error: string };

/**
 * Strip single-line comments (// ...) from JSON content.
 * Avoids stripping // inside strings by tracking quote state.
 */
function stripLineComments(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    let inString = false;
    let escaped = false;
    let commentStart = -1;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === '\\' && inString) {
        escaped = true;
        continue;
      }

      if (ch === '"' && !escaped) {
        inString = !inString;
        continue;
      }

      if (!inString && ch === '/' && i + 1 < line.length && line[i + 1] === '/') {
        commentStart = i;
        break;
      }
    }

    if (commentStart >= 0) {
      result.push(line.slice(0, commentStart));
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
}

/**
 * Strip block comments from JSON content.
 * Avoids stripping inside strings by tracking quote state.
 */
function stripBlockComments(content: string): string {
  let result = '';
  let inString = false;
  let inComment = false;
  let escaped = false;
  let i = 0;

  while (i < content.length) {
    if (inComment) {
      if (content[i] === '*' && i + 1 < content.length && content[i + 1] === '/') {
        inComment = false;
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    const ch = content[i];

    if (escaped) {
      result += ch;
      escaped = false;
      i++;
      continue;
    }

    if (ch === '\\' && inString) {
      result += ch;
      escaped = true;
      i++;
      continue;
    }

    if (ch === '"' && !escaped) {
      inString = !inString;
      result += ch;
      i++;
      continue;
    }

    if (!inString && ch === '/' && i + 1 < content.length && content[i + 1] === '*') {
      inComment = true;
      i += 2;
      continue;
    }

    result += ch;
    i++;
  }

  return result;
}

/**
 * Remove trailing commas before closing brackets/braces.
 */
function stripTrailingCommas(content: string): string {
  return content.replace(/,\s*([\]}])/g, '$1');
}

/**
 * Safely parse JSON content.
 *
 * First tries standard JSON.parse. On failure, strips comments (line and block)
 * and trailing commas, then retries. Returns a structured result (never throws).
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
    let cleaned = stripLineComments(content);
    cleaned = stripBlockComments(cleaned);
    cleaned = stripTrailingCommas(cleaned);
    return { success: true, data: JSON.parse(cleaned) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Invalid JSON: ${message}` };
  }
}
