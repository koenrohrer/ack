import * as fs from 'fs/promises';
import * as path from 'path';
import type { BackupService } from '../../../services/backup.service.js';

/**
 * Writer functions for command file operations.
 *
 * Commands can be single .md files or directories containing .md files.
 * These functions use fs/promises directly (not ConfigService.writeConfigFile())
 * since commands are file-based, not JSON config entries.
 */

/**
 * Remove a command file or directory.
 *
 * If the command is a directory, backs up the main .md file then
 * deletes the entire directory recursively. If it's a single file,
 * backs up then unlinks.
 */
export async function removeCommand(
  backupService: BackupService,
  commandPath: string,
  isDirectory: boolean,
): Promise<void> {
  if (isDirectory) {
    // For directories, find .md files to back up the primary one
    const entries = await fs.readdir(commandPath).catch(() => []);
    const mdFile = (entries as string[]).find((e) => e.endsWith('.md'));
    if (mdFile) {
      await backupService.createBackup(path.join(commandPath, mdFile));
    }
    await fs.rm(commandPath, { recursive: true, force: true });
  } else {
    await backupService.createBackup(commandPath);
    await fs.unlink(commandPath);
  }
}

/**
 * Copy a command file or directory to a target path.
 *
 * Creates parent directories if needed. Uses fs.cp for directories
 * and fs.copyFile for single files. Used for scope move.
 */
export async function copyCommand(
  sourcePath: string,
  targetPath: string,
  isDirectory: boolean,
): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  if (isDirectory) {
    await fs.cp(sourcePath, targetPath, { recursive: true });
  } else {
    await fs.copyFile(sourcePath, targetPath);
  }
}

/**
 * Rename a command file or directory.
 *
 * Used for disable (adding .disabled suffix) and re-enable (removing it).
 */
export async function renameCommand(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  await fs.rename(sourcePath, targetPath);
}
