import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileIOService } from '../../services/fileio.service.js';

describe('FileIOService', () => {
  let tmpDir: string;
  const svc = new FileIOService();

  async function makeTmpDir(): Promise<string> {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fileio-test-'));
    return tmpDir;
  }

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // -- readJsonFile --

  it('reads an existing JSON file correctly', async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, 'config.json');
    await fs.writeFile(file, '{"name":"test","count":42}');

    const result = await svc.readJsonFile<{ name: string; count: number }>(file);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: 'test', count: 42 });
    }
  });

  it('returns null data for a missing file (not failure)', async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, 'nonexistent.json');

    const result = await svc.readJsonFile(file);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it('handles JSON with comments via lenient fallback', async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, 'config.jsonc');
    const content = `{
  // This is a comment
  "key": "value",
  "nested": {
    /* block comment */
    "inner": true,
  }
}`;
    await fs.writeFile(file, content);

    const result = await svc.readJsonFile<{ key: string; nested: { inner: boolean } }>(file);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ key: 'value', nested: { inner: true } });
    }
  });

  it('returns failure for unparseable content', async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, 'bad.json');
    await fs.writeFile(file, 'not json at all {{{');

    const result = await svc.readJsonFile(file);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Invalid JSON');
      expect(result.filePath).toBe(file);
    }
  });

  // -- writeJsonFile --

  it('writes JSON atomically with correct content', async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, 'output.json');

    await svc.writeJsonFile(file, { hello: 'world' });

    const raw = await fs.readFile(file, 'utf-8');
    expect(JSON.parse(raw)).toEqual({ hello: 'world' });
    // 2-space indent + trailing newline
    expect(raw).toBe('{\n  "hello": "world"\n}\n');
  });

  it('creates parent directories on write', async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, 'deep', 'nested', 'file.json');

    await svc.writeJsonFile(file, { nested: true });

    const raw = await fs.readFile(file, 'utf-8');
    expect(JSON.parse(raw)).toEqual({ nested: true });
  });

  // -- readTextFile --

  it('reads text files correctly', async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, 'readme.md');
    const content = '# Hello\n\nThis is a test.';
    await fs.writeFile(file, content);

    const result = await svc.readTextFile(file);

    expect(result).toBe(content);
  });

  it('returns null for missing text files', async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, 'missing.md');

    const result = await svc.readTextFile(file);

    expect(result).toBeNull();
  });

  // -- writeTextFile --

  it('writes text files atomically', async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, 'output.txt');

    await svc.writeTextFile(file, 'hello world');

    const raw = await fs.readFile(file, 'utf-8');
    expect(raw).toBe('hello world');
  });

  // -- fileExists --

  it('returns true for existing files', async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, 'exists.txt');
    await fs.writeFile(file, 'yes');

    expect(await svc.fileExists(file)).toBe(true);
  });

  it('returns false for missing files', async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, 'nope.txt');

    expect(await svc.fileExists(file)).toBe(false);
  });

  // -- listDirectories --

  it('lists subdirectories', async () => {
    const dir = await makeTmpDir();
    await fs.mkdir(path.join(dir, 'alpha'));
    await fs.mkdir(path.join(dir, 'beta'));
    await fs.writeFile(path.join(dir, 'file.txt'), 'not a dir');

    const dirs = await svc.listDirectories(dir);

    expect(dirs.sort()).toEqual(['alpha', 'beta']);
  });

  it('returns empty array for missing directory', async () => {
    const dir = await makeTmpDir();
    const missing = path.join(dir, 'nonexistent');

    const dirs = await svc.listDirectories(missing);

    expect(dirs).toEqual([]);
  });
});
