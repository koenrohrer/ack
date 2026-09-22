import { describe, it, expect, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as os from 'os';

// Return directory entries in reverse name order, so `deploy.md.disabled`
// arrives before `deploy.md` -- the order a real readdir may produce.
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  const readdir = (async (...args: Parameters<typeof actual.readdir>) => {
    const entries = (await actual.readdir(...args)) as Array<string | { name: string }>;
    const nameOf = (e: string | { name: string }) => (typeof e === 'string' ? e : e.name);
    return [...entries].sort((a, b) => nameOf(b).localeCompare(nameOf(a)));
  }) as typeof actual.readdir;
  return { ...actual, readdir, default: { ...actual, readdir } };
});

import * as fs from 'fs/promises';
import { FileIOService } from '../../services/fileio.service.js';
import { SchemaService } from '../../services/schema.service.js';
import { ConfigService } from '../../services/config.service.js';
import { claudeCodeSchemas } from '../../providers/claude-code/schemas.js';
import { parseCommandsDir } from '../../providers/claude-code/parsers/command.parser.js';
import { ConfigScope, ToolStatus } from '../../types/enums.js';

type CtorArgs = ConstructorParameters<typeof ConfigService>;

let tmpDir = '';

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
});

describe('same-name enabled and disabled command files in one scope', () => {
  it('resolves to the enabled file whatever order readdir returns', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmd-tie-'));
    await fs.writeFile(path.join(tmpDir, 'deploy.md'), 'Deploy now.');
    await fs.writeFile(path.join(tmpDir, 'deploy.md.disabled'), 'Old deploy.');
    const fileIO = new FileIOService();
    const schemaService = new SchemaService();
    schemaService.registerSchemas(claudeCodeSchemas);

    const tools = await parseCommandsDir(fileIO, schemaService, tmpDir, ConfigScope.User);
    const configService = new ConfigService(
      fileIO,
      {} as CtorArgs[1],
      schemaService,
      {} as CtorArgs[3],
    );
    const [winner] = configService.resolveScopes(tools);

    expect(winner.status).toBe(ToolStatus.Enabled);
    expect(winner.source.filePath).toBe(path.join(tmpDir, 'deploy.md'));
  });
});
