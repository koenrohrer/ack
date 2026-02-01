import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { BackupService, MAX_BACKUPS } from '../../services/backup.service.js';

describe('BackupService', () => {
  let tmpDir: string;
  const svc = new BackupService();

  async function makeTmpDir(): Promise<string> {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-test-'));
    return tmpDir;
  }

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('creates .bak.1 for the first backup', async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, 'config.json');
    await fs.writeFile(file, 'version-1');

    await svc.createBackup(file);

    const backup = await fs.readFile(`${file}.bak.1`, 'utf-8');
    expect(backup).toBe('version-1');
  });

  it('rotates backups correctly after multiple writes', async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, 'config.json');

    // Simulate 3 write cycles with backup before each
    for (let i = 1; i <= 3; i++) {
      await fs.writeFile(file, `version-${i}`);
      await svc.createBackup(file);
    }

    // .bak.1 = version-3 (most recent backup)
    // .bak.2 = version-2
    // .bak.3 = version-1 (oldest)
    expect(await fs.readFile(`${file}.bak.1`, 'utf-8')).toBe('version-3');
    expect(await fs.readFile(`${file}.bak.2`, 'utf-8')).toBe('version-2');
    expect(await fs.readFile(`${file}.bak.3`, 'utf-8')).toBe('version-1');

    // .bak.4 and .bak.5 should not exist
    await expect(fs.access(`${file}.bak.4`)).rejects.toThrow();
    await expect(fs.access(`${file}.bak.5`)).rejects.toThrow();
  });

  it('deletes oldest when exceeding MAX_BACKUPS', async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, 'config.json');

    // Simulate 6 write cycles (exceeds MAX_BACKUPS=5)
    for (let i = 1; i <= 6; i++) {
      await fs.writeFile(file, `version-${i}`);
      await svc.createBackup(file);
    }

    // Only .bak.1 through .bak.5 should exist
    expect(await fs.readFile(`${file}.bak.1`, 'utf-8')).toBe('version-6');
    expect(await fs.readFile(`${file}.bak.2`, 'utf-8')).toBe('version-5');
    expect(await fs.readFile(`${file}.bak.3`, 'utf-8')).toBe('version-4');
    expect(await fs.readFile(`${file}.bak.4`, 'utf-8')).toBe('version-3');
    expect(await fs.readFile(`${file}.bak.5`, 'utf-8')).toBe('version-2');

    // .bak.6 should NOT exist (version-1 was dropped)
    await expect(fs.access(`${file}.bak.6`)).rejects.toThrow();
  });

  it('does nothing when source file does not exist', async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, 'nonexistent.json');

    // Should not throw
    await svc.createBackup(file);

    // No backup files created
    await expect(fs.access(`${file}.bak.1`)).rejects.toThrow();
  });

  it('lists existing backups sorted newest first', async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, 'config.json');

    // Create 3 backups
    for (let i = 1; i <= 3; i++) {
      await fs.writeFile(file, `version-${i}`);
      await svc.createBackup(file);
    }

    const backups = await svc.listBackups(file);

    expect(backups).toHaveLength(3);
    expect(backups[0]).toBe(`${file}.bak.1`);
    expect(backups[1]).toBe(`${file}.bak.2`);
    expect(backups[2]).toBe(`${file}.bak.3`);
  });

  it('returns empty list when no backups exist', async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, 'config.json');

    const backups = await svc.listBackups(file);

    expect(backups).toEqual([]);
  });

  it('MAX_BACKUPS is 5', () => {
    expect(MAX_BACKUPS).toBe(5);
  });
});
