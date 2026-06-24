import { FileIOService } from '../../../services/fileio.service.js';

/**
 * Shared, fully-typed fake for `FileIOService` in unit tests.
 *
 * Starts from a real `FileIOService` instance (so private members and the
 * nominal class identity are satisfied), then overlays no-op/empty defaults
 * for every public method and finally applies `overrides`. The returned value
 * genuinely satisfies `FileIOService` (no `as any` / `as unknown as` casts).
 */
export function createMockFileIO(overrides: Partial<FileIOService> = {}): FileIOService {
  const base = new FileIOService();
  return Object.assign(base, {
    async readJsonFile() {
      return { success: true as const, data: null };
    },
    async writeJsonFile() {},
    async readTextFile() {
      return null;
    },
    async writeTextFile() {},
    async deleteFile() {},
    async moveFile() {},
    async fileExists() {
      return false;
    },
    async listDirectories() {
      return [];
    },
    async listFiles() {
      return [];
    },
    async readTomlFile() {
      return { success: true as const, data: null };
    },
    async writeTomlFile() {},
    async readYamlFile() {
      return { success: true as const, data: null };
    },
    async writeYamlFile() {},
  } satisfies Partial<FileIOService>, overrides);
}
