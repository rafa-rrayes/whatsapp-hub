import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAgentGuide, buildAgentPrompt, buildClientConfig, checkMcpConnection, parseMcpResponse, type McpSetup } from '../src/lib/mcp-connect'

const setup: McpSetup = {
  mcpUrl: 'https://hub.example.test/mcp', transport: 'streamable-http', urlSource: 'configured', warnings: [],
  auth: { apiKey: { enabled: true, header: 'x-api-key' }, oauth: { enabled: true, issuerUrl: 'https://hub.example.test', discoveryUrl: 'https://hub.example.test/.well-known/oauth-protected-resource/mcp', reason: null } },
  tools: [{ name: 'resolve_contact', description: 'Resolve names.', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }],
}
const key = 'test-only-key-"with\\characters'
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('agent onboarding credentials', () => {
  it('uses actual endpoint and round-trippable key in prompt and config', () => {
    const prompt = buildAgentPrompt(setup, 'api-key', key)
    expect(prompt).toContain(setup.mcpUrl)
    expect(prompt).toContain(JSON.stringify(key))
    expect(prompt).toContain('x-api-key')
    expect(prompt).not.toContain('localhost')
    expect(JSON.parse(buildClientConfig(setup, 'api-key', key)).mcpServers['whatsapp-hub'].headers['x-api-key']).toBe(key)
  })
  it('never includes the key in OAuth prompts/config or exported reference', () => {
    const prompt = buildAgentPrompt(setup, 'oauth', key)
    expect(prompt).toContain(setup.auth.oauth.discoveryUrl)
    for (const output of [prompt, buildClientConfig(setup, 'oauth', key), buildAgentGuide(setup)]) {
      expect(output).not.toContain(key)
      expect(output).not.toContain(JSON.stringify(key))
    }
    expect(JSON.parse(buildClientConfig(setup, 'oauth', key)).mcpServers['whatsapp-hub'].headers).toBeUndefined()
  })
  it('does not silently generate an unusable connection', () => {
    expect(() => buildAgentPrompt(setup, 'api-key', '')).toThrow('Sign in')
    expect(() => buildAgentPrompt({ ...setup, auth: { ...setup.auth, oauth: { ...setup.auth.oauth, enabled: false } } }, 'oauth', key)).toThrow('not available')
  })
})

describe('MCP transport parsing', () => {
  it('reads JSON and skips SSE notifications before matching the RPC id', () => {
    expect(parseMcpResponse('{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}', 2)).toEqual({ tools: [] })
    expect(parseMcpResponse('event: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\ndata: {"jsonrpc":"2.0","id":2,\r\ndata: "result":{"tools":[]}}\r\n\r\n', 2)).toEqual({ tools: [] })
  })
  it('rejects invalid responses and redacts server-supplied RPC errors', () => {
    expect(() => parseMcpResponse('<html>login</html>', 1)).toThrow('valid MCP response')
    expect(() => parseMcpResponse('{"jsonrpc":"2.0","id":99,"result":{}}', 1)).toThrow('valid MCP response')
    expect(() => parseMcpResponse(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: key } }), 1)).toThrow('JSON-RPC -32603')
    try { parseMcpResponse(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: key } }), 1) } catch (e) { expect(String(e)).not.toContain(key) }
  })
})

describe('read-only MCP connection check', () => {
  it('initializes then discovers tools using the negotiated version without calling a tool', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25', serverInfo: { name: 'whatsapp-hub' } } })))
      .mockResolvedValueOnce(new Response('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"resolve_contact"}]}}\n\n'))
    vi.stubGlobal('fetch', fetcher)
    expect(await checkMcpConnection(key)).toEqual({ toolCount: 1, protocolVersion: '2025-11-25', serverName: 'whatsapp-hub' })
    expect(fetcher.mock.calls.map(([, request]) => JSON.parse(request.body).method)).toEqual(['initialize', 'tools/list'])
    expect(fetcher.mock.calls[1][1].headers['MCP-Protocol-Version']).toBe('2025-11-25')
    for (const [url, request] of fetcher.mock.calls) {
      expect(url).toBe('/mcp')
      expect(request.headers['x-api-key']).toBe(key)
      expect(request.headers.Accept).toBe('application/json, text/event-stream')
      expect(request.body).not.toContain(key)
    }
  })
  it.each([[401, 'Authentication failed'], [403, 'Authentication failed'], [404, 'endpoint not found'], [405, 'endpoint not found'], [429, 'rate limiting'], [502, 'HTTP 502']])('explains HTTP %s without exposing server response', async (status, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(key, { status })))
    await expect(checkMcpConnection(key)).rejects.toThrow(message)
  })
  it('rejects incomplete initialization without continuing', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"jsonrpc":"2.0","id":1,"result":{}}'))
    vi.stubGlobal('fetch', fetcher)
    await expect(checkMcpConnection(key)).rejects.toThrow('incomplete')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('handles network failure with an actionable message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(checkMcpConnection(key)).rejects.toThrow('Could not reach MCP')
  })
})
