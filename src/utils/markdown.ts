/**
 * Result of frontmatter extraction from a markdown file.
 */
export interface FrontmatterResult {
  frontmatter: Record<string, string>;
  body: string;
}

/**
 * Extract YAML frontmatter from markdown content.
 *
 * Splits on `---` delimiters, parses flat key:value pairs.
 * Handles string values with or without quotes.
 * Returns null if no valid frontmatter block is found.
 *
 * Used for parsing SKILL.md and command.md files in Claude Code
 * skill directories and slash command directories.
 */
export function extractFrontmatter(content: string): FrontmatterResult | null {
  // Frontmatter must start at the very beginning of the file
  if (!content.startsWith('---')) {
    return null;
  }

  // Find closing delimiter (second ---)
  const closingIndex = content.indexOf('\n---', 3);
  if (closingIndex === -1) {
    return null;
  }

  const frontmatterBlock = content.slice(4, closingIndex).trim();
  const body = content.slice(closingIndex + 4).trim();

  if (frontmatterBlock.length === 0) {
    return null;
  }

  const frontmatter: Record<string, string> = {};
  const lines = frontmatterBlock.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, colonIndex).trim();
    let value = trimmed.slice(colonIndex + 1).trim();

    // Strip surrounding quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key.length > 0) {
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}
