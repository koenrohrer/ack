import * as fs from 'fs/promises';
import * as path from 'path';
import writeFileAtomic from 'write-file-atomic';
import { safeJsonParse } from '../utils/json.js';
import type { ConfigReadResult } from '../types/config.js';

/**
 * Lazy-loaded smol-toml parse and stringify functions.
 *
 * smol-toml is ESM-only but this project compiles as CJS under Node16.
 * Dynamic import works at runtime (Node supports importing ESM from CJS
 * via dynamic import) and esbuild bundles it correctly at build time.
 * We define our own interface to avoid TypeScript ESM/CJS type import errors.
 */
interface TomlModule {
  parse: (input: string) => Record<string, unknown>;
  stringify: (input: Record<string, unknown>) => string;
}
let _toml: TomlModule | undefined;
async function loadToml(): Promise<TomlModule> {
  if (!_toml) {
    _toml = await import('smol-toml') as TomlModule;
  }
  return _toml;
}

/**
 * Service for safe filesystem operations.
 *
 * Reads JSON files with lenient parsing (comments, trailing commas).
 * Writes files atomically using write-file-atomic (write-to-temp-then-rename)
 * to prevent data loss on crash.
 */
export class FileIOService {
  /**
   * Read and parse a JSON file, handling JSONC (comments, trailing commas).
   *
   * Returns `{ success: true, data: null }` when the file does not exist --
   * a missing file is a valid state (config not yet created).
   * Returns `{ success: false, error, filePath }` for permission errors or
   * malformed JSON that cannot be repaired.
   */
  async readJsonFile<T>(filePath: string): Promise<ConfigReadResult<T | null>> {
    let content: string;

    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return { success: true, data: null };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, filePath };
    }

    const parseResult = safeJsonParse(content);
    if (!parseResult.success) {
      return { success: false, error: parseResult.error, filePath };
    }

    return { success: true, data: parseResult.data as T };
  }

  /**
   * Write JSON data to a file atomically.
   *
   * Creates parent directories if they do not exist.
   * Serializes with 2-space indentation and trailing newline.
   * Throws on write failure -- callers are expected to handle errors.
   */
  async writeJsonFile(filePath: string, data: unknown): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const content = JSON.stringify(data, null, 2) + '\n';
    await writeFileAtomic(filePath, content, 'utf-8');
  }

  /**
   * Read a text file as UTF-8.
   *
   * Returns null when the file does not exist.
   * Throws on permission or other filesystem errors.
   */
  async readTextFile(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Write text content to a file atomically.
   *
   * Creates parent directories if they do not exist.
   */
  async writeTextFile(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await writeFileAtomic(filePath, content, 'utf-8');
  }

  /**
   * Check whether a file exists and is accessible.
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List subdirectory names within a directory.
   *
   * Returns an empty array if the directory does not exist.
   */
  async listDirectories(dirPath: string): Promise<string[]> {
    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return [];
      }
      throw err;
    }

    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  /**
   * Read and parse a TOML file.
   *
   * Returns `{ success: true, data: null }` when the file does not exist --
   * a missing file is a valid state (config not yet created).
   * Returns `{ success: false, error, filePath }` for permission errors or
   * malformed TOML that cannot be parsed.
   */
  async readTomlFile<T>(filePath: string): Promise<ConfigReadResult<T | null>> {
    let content: string;

    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return { success: true, data: null };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, filePath };
    }

    try {
      const { parse } = await loadToml();
      const parsed = parse(content);
      return { success: true, data: parsed as T };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, filePath };
    }
  }

  /**
   * Write data to a TOML file atomically.
   *
   * Creates parent directories if they do not exist.
   * Serializes using smol-toml's stringify with trailing newline.
   * Throws on write failure -- callers are expected to handle errors.
   */
  async writeTomlFile(filePath: string, data: Record<string, unknown>): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const { stringify } = await loadToml();
    const content = stringify(data) + '\n';
    await writeFileAtomic(filePath, content, 'utf-8');
  }
}

/**
 * Type guard for Node.js system errors with a `code` property.
 */
function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
