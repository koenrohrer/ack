import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileIOService } from '../../services/fileio.service.js';
import { WorkspaceProfileService } from '../../services/workspace-profile.service.js';

type Memento = ConstructorParameters<typeof WorkspaceProfileService>[1];

/** In-memory vscode.Memento stand-in. */
function fakeMemento(): Memento {
  const store = new Map<string, unknown>();
  return {
    get: (key: string, def?: unknown) => (store.has(key) ? store.get(key) : def),
    update: (key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    },
    keys: () => [...store.keys()],
  } as unknown as Memento;
}

let root: string;
let file: string;
let svc: WorkspaceProfileService;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-profile-'));
  file = path.join(root, '.vscode', 'agent-profile.json');
  svc = new WorkspaceProfileService(new FileIOService(), fakeMemento());
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writeRaw(data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data));
}

async function readRaw(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(file, 'utf-8'));
}

describe('WorkspaceProfileService associations', () => {
  it('keeps one association per agent', async () => {
    await svc.setAssociation(root, 'Alpha', 'claude-code');
    await svc.setAssociation(root, 'Beta', 'codex');

    expect(await svc.getAssociationForAgent(root, 'claude-code')).toEqual({
      profileName: 'Alpha',
      agentId: 'claude-code',
    });
    expect(await svc.getAssociationForAgent(root, 'codex')).toEqual({ profileName: 'Beta', agentId: 'codex' });
  });

  it('mirrors the last association at the top level, the shape older versions read', async () => {
    await svc.setAssociation(root, 'Alpha', 'claude-code');
    await svc.setAssociation(root, 'Beta', 'codex');

    expect(await readRaw()).toEqual({
      profileName: 'Beta',
      agentId: 'codex',
      associations: { 'claude-code': 'Alpha', codex: 'Beta' },
    });
  });

  it('reads a legacy file without agentId as a Claude Code association', async () => {
    await writeRaw({ profileName: 'Old' });

    expect(await svc.getAssociationForAgent(root, 'claude-code')).toEqual({
      profileName: 'Old',
      agentId: 'claude-code',
    });
    expect(await svc.getAssociationForAgent(root, 'codex')).toBeNull();
  });

  it('keeps a legacy association when another agent is associated', async () => {
    await writeRaw({ profileName: 'Old', agentId: 'claude-code' });

    await svc.setAssociation(root, 'New', 'codex');

    expect(await svc.getAssociationForAgent(root, 'claude-code')).toEqual({
      profileName: 'Old',
      agentId: 'claude-code',
    });
  });

  it("removes only the given agent's association and re-mirrors one that remains", async () => {
    await svc.setAssociation(root, 'Alpha', 'claude-code');
    await svc.setAssociation(root, 'Beta', 'codex');

    await svc.removeAssociation(root, 'codex');

    expect(await svc.getAssociationForAgent(root, 'codex')).toBeNull();
    expect(await readRaw()).toEqual({
      profileName: 'Alpha',
      agentId: 'claude-code',
      associations: { 'claude-code': 'Alpha' },
    });
  });

  it('deletes the file when the last association is removed', async () => {
    await svc.setAssociation(root, 'Alpha', 'claude-code');

    await svc.removeAssociation(root, 'claude-code');

    await expect(fs.access(file)).rejects.toThrow();
  });

  it('returns null for a file that holds neither shape', async () => {
    await writeRaw({ unrelated: true });

    expect(await svc.getAssociationForAgent(root, 'claude-code')).toBeNull();
  });
});
