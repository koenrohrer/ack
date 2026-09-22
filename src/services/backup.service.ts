import type { FileIOService } from './fileio.service.js';

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
  constructor(private readonly fileIO: FileIOService) {}

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
    await this.createBackupAt(filePath, filePath);
  }

  /**
   * Create a rolling backup of `sourcePath` under `backupBase`.
   *
   * Writes `${backupBase}.bak.1` through `.bak.5` with the same rotation as
   * {@link createBackup}. Use it when the source's own directory is about to be
   * deleted: a backup written beside the source would be deleted with it.
   *
   * Silently skips if the source file does not exist (nothing to back up).
   */
  async createBackupAt(sourcePath: string, backupBase: string): Promise<void> {
    // If source file does not exist, nothing to back up
    const exists = await this.fileIO.fileExists(sourcePath);
    if (!exists) {
      return;
    }

    // Delete oldest backup if it exists (deleteFile is a no-op on ENOENT)
    await this.fileIO.deleteFile(`${backupBase}.bak.${MAX_BACKUPS}`);

    // Shift existing backups: .bak.4 -> .bak.5, .bak.3 -> .bak.4, etc.
    // Source backups may not exist; skip ENOENT silently.
    for (let i = MAX_BACKUPS - 1; i >= 1; i--) {
      await silentMove(
        this.fileIO,
        `${backupBase}.bak.${i}`,
        `${backupBase}.bak.${i + 1}`,
      );
    }

    // Copy current file to .bak.1
    const content = await this.fileIO.readTextFile(sourcePath);
    if (content !== null) {
      await this.fileIO.writeTextFile(`${backupBase}.bak.1`, content);
    }
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
      const exists = await this.fileIO.fileExists(backupPath);
      if (exists) {
        backups.push(backupPath);
      }
    }

    return backups;
  }
}

/**
 * Move a file, silently ignoring ENOENT (source may not exist yet).
 */
async function silentMove(fileIO: FileIOService, oldPath: string, newPath: string): Promise<void> {
  try {
    await fileIO.moveFile(oldPath, newPath);
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
