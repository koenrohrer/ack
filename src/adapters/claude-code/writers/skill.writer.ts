import * as fs from 'fs/promises';
import * as path from 'path';
import type { BackupService } from '../../../services/backup.service.js';

/**
 * Writer functions for skill file operations.
 *
 * Skills are directory-based (not JSON config entries), so these functions
 * use fs/promises directly rather than ConfigService.writeConfigFile().
 */

/**
 * Remove a skill by deleting its entire directory recursively.
 *
 * Creates a backup of the SKILL.md file before deletion.
 */
export async function removeSkill(
  backupService: BackupService,
  skillDirPath: string,
): Promise<void> {
  const skillMdPath = path.join(skillDirPath, 'SKILL.md');
  await backupService.createBackup(skillMdPath);
  await fs.rm(skillDirPath, { recursive: true, force: true });
}

/**
 * Copy a skill directory to a target path.
 *
 * Creates parent directories if needed. Used for scope move
 * (copying to the target scope's skills directory).
 */
export async function copySkill(
  sourceDirPath: string,
  targetDirPath: string,
): Promise<void> {
  await fs.mkdir(path.dirname(targetDirPath), { recursive: true });
  await fs.cp(sourceDirPath, targetDirPath, { recursive: true });
}

/**
 * Rename a skill directory.
 *
 * Used for disable (adding .disabled suffix) and re-enable (removing it).
 * The parser skips directories with .disabled suffix since SKILL.md won't
 * be found at the expected path pattern.
 */
export async function renameSkill(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  await fs.rename(sourcePath, targetPath);
}
