import { ConfigScope, ToolType } from '../types/enums.js';

/**
 * Scopes queried for each tool type across service and tree consumers.
 */
export const APPLICABLE_SCOPES: Record<ToolType, readonly ConfigScope[]> = {
  [ToolType.Skill]: [ConfigScope.User, ConfigScope.Project],
  [ToolType.Command]: [ConfigScope.User, ConfigScope.Project],
  [ToolType.Hook]: [
    ConfigScope.User,
    ConfigScope.Project,
    ConfigScope.Local,
    ConfigScope.Managed,
  ],
  [ToolType.McpServer]: [
    ConfigScope.User,
    ConfigScope.Project,
    ConfigScope.Managed,
  ],
  [ToolType.CustomPrompt]: [ConfigScope.User, ConfigScope.Project],
};
