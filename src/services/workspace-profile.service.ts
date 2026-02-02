import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import type * as vscode from 'vscode';
import type { FileIOService } from './fileio.service.js';

// ---------------------------------------------------------------------------
// Schema and types
// ---------------------------------------------------------------------------

/**
 * Shape of `.vscode/agent-profile.json` -- maps a workspace to a profile by name.
 *
 * Uses profile name (not ID) for cross-machine portability since IDs are
 * machine-specific UUIDs.
 */
export interface WorkspaceProfileAssociation {
  profileName: string;
}

export const WorkspaceProfileAssociationSchema = z
  .object({
    profileName: z.string(),
  })
  .passthrough();

/**
 * Override entry stored in globalState.
 *
 * Tracks when a user manually switched profiles in a workspace that has
 * an association, so auto-activation does not fight the user's choice.
 */
interface OverrideEntry {
  manualProfileName: string | null;
  timestamp: string;
}

/** globalState key for workspace profile overrides. */
const OVERRIDE_KEY = 'agent-config-keeper.workspaceProfileOverrides';

/** File name for workspace profile association. */
const ASSOCIATION_FILE = path.join('.vscode', 'agent-profile.json');

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Manages workspace-profile associations and manual override tracking.
 *
 * Associations are stored in `.vscode/agent-profile.json` within the workspace.
 * Manual overrides are tracked in globalState keyed by workspace folder path.
 */
export class WorkspaceProfileService {
  constructor(
    private readonly fileIO: FileIOService,
    private readonly globalState: vscode.Memento,
  ) {}

  /**
   * Read the profile association for a workspace.
   *
   * Returns null if no association file exists or if it fails validation.
   */
  async getAssociation(workspaceRoot: string): Promise<WorkspaceProfileAssociation | null> {
    const filePath = path.join(workspaceRoot, ASSOCIATION_FILE);
    const result = await this.fileIO.readJsonFile<unknown>(filePath);

    if (!result.success || result.data === null) {
      return null;
    }

    const parsed = WorkspaceProfileAssociationSchema.safeParse(result.data);
    if (!parsed.success) {
      return null;
    }

    return parsed.data as WorkspaceProfileAssociation;
  }

  /**
   * Set the profile association for a workspace.
   *
   * Writes `{ profileName }` to `.vscode/agent-profile.json` and clears
   * any manual override (the user is explicitly setting an association,
   * so the override should reset).
   */
  async setAssociation(workspaceRoot: string, profileName: string): Promise<void> {
    const filePath = path.join(workspaceRoot, ASSOCIATION_FILE);
    await this.fileIO.writeJsonFile(filePath, { profileName });
    await this.clearOverride(workspaceRoot);
  }

  /**
   * Remove the profile association for a workspace.
   *
   * Deletes `.vscode/agent-profile.json` and clears any override.
   */
  async removeAssociation(workspaceRoot: string): Promise<void> {
    const filePath = path.join(workspaceRoot, ASSOCIATION_FILE);
    try {
      await fs.unlink(filePath);
    } catch (err: unknown) {
      // Ignore ENOENT -- file already doesn't exist
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
    await this.clearOverride(workspaceRoot);
  }

  /**
   * Check whether the user has manually overridden the workspace's profile association.
   *
   * Optionally validates that the overridden profile still exists. If the
   * override references a deleted profile (stale), it is cleared and false
   * is returned.
   */
  isOverridden(workspaceRoot: string, existingProfileNames?: string[]): boolean {
    const overrides = this.globalState.get<Record<string, OverrideEntry>>(OVERRIDE_KEY, {});
    const entry = overrides[workspaceRoot];

    if (!entry) {
      return false;
    }

    // Validate staleness when profile names are available
    if (existingProfileNames && entry.manualProfileName !== null) {
      if (!existingProfileNames.includes(entry.manualProfileName)) {
        // Override references a deleted profile -- clear it asynchronously
        void this.clearOverride(workspaceRoot);
        return false;
      }
    }

    return true;
  }

  /**
   * Record a manual override for a workspace.
   *
   * Called when the user explicitly switches profiles in a workspace that
   * has an association.
   */
  async setOverride(workspaceRoot: string, manualProfileName: string | null): Promise<void> {
    const overrides = this.globalState.get<Record<string, OverrideEntry>>(OVERRIDE_KEY, {});
    overrides[workspaceRoot] = {
      manualProfileName,
      timestamp: new Date().toISOString(),
    };
    await this.globalState.update(OVERRIDE_KEY, overrides);
  }

  /**
   * Clear the manual override for a workspace.
   */
  async clearOverride(workspaceRoot: string): Promise<void> {
    const overrides = this.globalState.get<Record<string, OverrideEntry>>(OVERRIDE_KEY, {});
    delete overrides[workspaceRoot];
    await this.globalState.update(OVERRIDE_KEY, overrides);
  }
}
