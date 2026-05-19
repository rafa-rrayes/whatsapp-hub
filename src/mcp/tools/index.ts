import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpTool } from '../types.js';
import { orientationTools } from './orientation.js';
import { searchTools } from './search.js';
import { aggregationTools } from './aggregation.js';
import { actionTools } from './actions.js';

const ALL_TOOLS: McpTool[] = [
  ...orientationTools,
  ...searchTools,
  ...aggregationTools,
  ...actionTools,
];

export function registerAllTools(server: McpServer): void {
  for (const tool of ALL_TOOLS) {
    tool.register(server);
  }
}
