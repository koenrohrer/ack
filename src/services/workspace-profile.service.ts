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
 *
 * The optional `agentId` field scopes the association to a specific agent.
 * Legacy associations (v1.0, no agentId) are treated as Claude Code scope.
 */
export interface WorkspaceProfileAssociation {
  profileName: string;
  /** Agent this association applies to. Absent for legacy v1.0 associations. */
  agentId?: string;
}

export const WorkspaceProfileAssociationSchema = z
  .object({
    profileName: z.string(),
    agentId: z.string().optional(),
  })
  .passthrough();

/**
 * Current shape of `.vscode/agent-profile.json`: one association per agent in
 * `associations`, plus the legacy top-level fields mirroring one of them so a
 * version that reads only those still finds an association.
 */
const WorkspaceProfileFileSchema = z
  .object({
    associations: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

/** Agent a legacy association without `agentId` applies to. */
const LEGACY_AGENT_ID = 'claude-code';

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
const OVERRIDE_KEY = 'ack.workspaceProfileOverrides';

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
   * Read every agent's association for a workspace, keyed by agent id.
   *
   * The `associations` map is authoritative when it is present and valid. A
   * version without the map rewrites the whole file, so a file without it was
   * last written in the legacy single-association shape, which is read as one
   * entry (no `agentId` means 'claude-code'). An unreadable or unrecognised
   * file reads as no associations.
   *
   * `mirroredAgentId` is the agent whose association the top level holds.
   */
  private async readAssociations(
    workspaceRoot: string,
  ): Promise<{ associations: Record<string, string>; mirroredAgentId?: string }> {
    const result = await this.fileIO.readJsonFile<unknown>(path.join(workspaceRoot, ASSOCIATION_FILE));
    if (!result.success || result.data === null) {
      return { associations: {} };
    }

    const legacy = WorkspaceProfileAssociationSchema.safeParse(result.data);
    const mirroredAgentId = legacy.success ? (legacy.data.agentId ?? LEGACY_AGENT_ID) : undefined;

    const file = WorkspaceProfileFileSchema.safeParse(result.data);
    if (file.success && file.data.associations) {
      return { associations: { ...file.data.associations }, mirroredAgentId };
    }

    if (!legacy.success || mirroredAgentId === undefined) {
      return { associations: {} };
    }
    return { associations: { [mirroredAgentId]: legacy.data.profileName }, mirroredAgentId };
  }

  /**
   * Write the map, with one entry mirrored at the top level for older versions,
   * or delete the file when the map is empty.
   */
  private async writeAssociations(
    workspaceRoot: string,
    associations: Record<string, string>,
    mirrorAgentId: string | undefined,
  ): Promise<void> {
    const filePath = path.join(workspaceRoot, ASSOCIATION_FILE);
    const agentId =
      mirrorAgentId !== undefined && Object.hasOwn(associations, mirrorAgentId)
        ? mirrorAgentId
        : Object.keys(associations)[0];
    if (agentId === undefined) {
      await this.fileIO.deleteFile(filePath);
      return;
    }
    await this.fileIO.writeJsonFile(filePath, {
      profileName: associations[agentId],
      agentId,
      associations,
    });
  }

  /**
   * Get the profile association for a specific agent, or null if it has none.
   *
   * Each agent has its own association with a workspace, and only the given
   * agent's association is returned.
   */
  async getAssociationForAgent(workspaceRoot: string, agentId: string): Promise<WorkspaceProfileAssociation | null> {
    const { associations } = await this.readAssociations(workspaceRoot);
    if (!Object.hasOwn(associations, agentId)) {
      return null;
    }
    return { profileName: associations[agentId], agentId };
  }

  /**
   * Set one agent's profile association for a workspace.
   *
   * Keeps the other agents' associations, mirrors this one at the top level of
   * `.vscode/agent-profile.json`, and clears any manual override (the user is
   * explicitly setting an association, so the override should reset).
   */
  async setAssociation(workspaceRoot: string, profileName: string, agentId: string): Promise<void> {
    const { associations } = await this.readAssociations(workspaceRoot);
    associations[agentId] = profileName;
    await this.writeAssociations(workspaceRoot, associations, agentId);
    await this.clearOverride(workspaceRoot);
  }

  /**
   * Remove one agent's profile association for a workspace.
   *
   * Deletes `.vscode/agent-profile.json` when no association remains, and
   * clears any override.
   */
  async removeAssociation(workspaceRoot: string, agentId: string): Promise<void> {
    const { associations, mirroredAgentId } = await this.readAssociations(workspaceRoot);
    delete associations[agentId];
    await this.writeAssociations(workspaceRoot, associations, mirroredAgentId);
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
