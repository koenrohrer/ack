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
 * Backs up whichever SKILL.md variant exists first -- a disabled skill has its
 * file renamed to SKILL.md.disabled. createBackupAt is a no-op for the absent one.
 *
 * The backup sits BESIDE the directory (`<skills>/<name>.SKILL.md.bak.1`), never
 * inside it: the delete below removes everything inside. The `.bak.N` suffix
 * keeps it from being read as a skill or a markdown file by any agent.
 */
export async function removeSkill(
  backupService: BackupService,
  skillDirPath: string,
): Promise<void> {
  // resolve() drops a trailing separator, which would otherwise put
  // `${dir}/.SKILL.md` inside the directory being deleted.
  const dir = path.resolve(skillDirPath);
  for (const fileName of ['SKILL.md', 'SKILL.md.disabled']) {
    await backupService.createBackupAt(path.join(dir, fileName), `${dir}.${fileName}`);
  }
  await fs.rm(dir, { recursive: true, force: true });
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
 * Rename a skill path (generic fs.rename).
 *
 * Used to disable a skill by renaming SKILL.md -> SKILL.md.disabled (so the
 * agent no longer discovers it) and to re-enable by removing the suffix. Also
 * used to re-enable legacy skills whose whole directory was renamed *.disabled.
 */
export async function renameSkill(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  await fs.rename(sourcePath, targetPath);
}
