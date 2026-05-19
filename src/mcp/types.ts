import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Self-registering tool unit. Each tool file exports an array of these,
 * and the server iterates calling `register(server)`. Keeps tool definitions
 * co-located with their handler logic instead of in a giant switch.
 */
export interface McpTool {
  register(server: McpServer): void;
}

export type ToolContent =
  | { type: 'text'; text: string };

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  [x: string]: unknown;
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

export function jsonResult(obj: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }],
    structuredContent: (obj && typeof obj === 'object' && !Array.isArray(obj))
      ? (obj as Record<string, unknown>)
      : { value: obj },
  };
}

export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}
