export enum ToolType {
  Skill = 'skill',
  McpServer = 'mcp_server',
  Hook = 'hook',
  Command = 'command',
}

export enum ConfigScope {
  User = 'user',
  Project = 'project',
  Local = 'local',
  Managed = 'managed',
}

export enum ToolStatus {
  Enabled = 'enabled',
  Disabled = 'disabled',
  Warning = 'warning',
  Error = 'error',
}
