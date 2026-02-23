/**
 * Writer for GitHub Copilot agent definition files.
 *
 * Provides targeted frontmatter mutation for `.agent.md` files.
 * The writer operates on raw file content via string manipulation — it does
 * NOT reconstruct frontmatter from the parsed object to avoid losing YAML
 * arrays (`tools`, `agents`, `mcp-servers`) and other complex fields.
 */
import type { FileIOService } from '../../../services/fileio.service.js';

/**
 * Toggle the `user-invokable` frontmatter field in a `.agent.md` file.
 *
 * - `shouldDisable=true`  → writes `user-invokable: false` (hides from dropdown)
 * - `shouldDisable=false` → writes `user-invokable: true` (shows in dropdown)
 *
 * Algorithm:
 * 1. Read file. Throw if missing.
 * 2. If frontmatter exists (`---` delimiters):
 *    a. If `user-invokable:` line exists: replace it in-place.
 *    b. If absent: insert before closing `---`.
 * 3. If no frontmatter or malformed: prepend a minimal frontmatter block.
 * 4. Write atomically via fileIO.writeTextFile().
 *
 * All other frontmatter fields and the entire body are preserved.
 */
export async function toggleAgentUserInvokable(
  fileIO: FileIOService,
  filePath: string,
  shouldDisable: boolean,
): Promise<void> {
  const content = await fileIO.readTextFile(filePath);
  if (content === null) {
    throw new Error(`Agent file not found: ${filePath}`);
  }

  const newValue = shouldDisable ? 'false' : 'true';
  const newLine = `user-invokable: ${newValue}`;

  let updated: string;

  if (content.startsWith('---')) {
    // Find the closing --- delimiter (starts at char 3 to skip the opening ---)
    const closingIndex = content.indexOf('\n---', 3);

    if (closingIndex !== -1) {
      // Slice includes the closing ---\n (closingIndex + 4 chars)
      const frontmatter = content.slice(0, closingIndex + 4);
      const rest = content.slice(closingIndex + 4);

      if (/^user-invokable:/m.test(frontmatter)) {
        // Replace existing user-invokable line — preserves all other frontmatter
        updated = frontmatter.replace(/^user-invokable:.*$/m, newLine) + rest;
      } else {
        // Insert new line before closing ---
        updated = frontmatter.replace(/\n---$/, `\n${newLine}\n---`) + rest;
      }
    } else {
      // Malformed frontmatter: no closing --- — prepend new block
      updated = `---\n${newLine}\n---\n${content}`;
    }
  } else {
    // No frontmatter at all: prepend minimal frontmatter block
    updated = `---\n${newLine}\n---\n${content}`;
  }

  await fileIO.writeTextFile(filePath, updated);
}
