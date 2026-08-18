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

/**
 * Prose for the model, structure for the program.
 *
 * `jsonResult` puts the same JSON in both halves of the response, which serves
 * a programmatic client well and a language model badly: raw JIDs, unix
 * timestamps and two thousand characters of braces where a chat log would have
 * been clearer and cheaper. This splits them. `text` is what the model reads —
 * see `src/mcp/prose.ts` for the dialect, whose first rule is that a JID never
 * appears in it. `structured` is unchanged from what the tool always returned,
 * so clients reading `structuredContent` keep every field, JIDs included.
 */
export function proseResult(
  text: string,
  structured: Record<string, unknown>,
): ToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent: structured,
  };
}

export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}
