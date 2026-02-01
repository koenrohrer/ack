import * as fs from 'fs/promises';

/**
 * Maximum number of rolling backups kept per file.
 */
export const MAX_BACKUPS = 5;

/**
 * Service for rolling backup management.
 *
 * Before each config write, creates a backup of the current file.
 * Maintains the last 5 versions using numbered suffixes:
 *   .bak.1 (newest) through .bak.5 (oldest).
 *
 * Older backups are automatically deleted when they exceed MAX_BACKUPS.
 */
export class BackupService {
  /**
   * Create a rolling backup of the given file.
   *
   * Shifts existing backups (.bak.N -> .bak.N+1) and copies
   * the current file to .bak.1. Deletes .bak.5 (oldest) if it exists
   * before shifting.
   *
   * Silently skips if the source file does not exist (nothing to back up).
   */
  async createBackup(filePath: string): Promise<void> {
    // If source file does not exist, nothing to back up
    const exists = await fileExists(filePath);
    if (!exists) {
      return;
    }

    // Delete oldest backup if it exists
    await silentUnlink(`${filePath}.bak.${MAX_BACKUPS}`);

    // Shift existing backups: .bak.4 -> .bak.5, .bak.3 -> .bak.4, etc.
    for (let i = MAX_BACKUPS - 1; i >= 1; i--) {
      await silentRename(
        `${filePath}.bak.${i}`,
        `${filePath}.bak.${i + 1}`,
      );
    }

    // Copy current file to .bak.1
    await fs.copyFile(filePath, `${filePath}.bak.1`);
  }

  /**
   * List existing backup files for the given path, sorted newest first.
   *
   * Returns an array of absolute paths for backups that exist.
   */
  async listBackups(filePath: string): Promise<string[]> {
    const backups: string[] = [];

    for (let i = 1; i <= MAX_BACKUPS; i++) {
      const backupPath = `${filePath}.bak.${i}`;
      const exists = await fileExists(backupPath);
      if (exists) {
        backups.push(backupPath);
      }
    }

    return backups;
  }
}

/**
 * Check whether a file exists without throwing.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete a file, silently ignoring ENOENT.
 */
async function silentUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return;
    }
    throw err;
  }
}

/**
 * Rename a file, silently ignoring ENOENT (source may not exist yet).
 */
async function silentRename(oldPath: string, newPath: string): Promise<void> {
  try {
    await fs.rename(oldPath, newPath);
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return;
    }
    throw err;
  }
}

/**
 * Type guard for Node.js system errors with a `code` property.
 */
function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
