import { Router, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildMcpServer } from './server.js';
import { log } from '../utils/logger.js';

const JSON_RPC_INTERNAL_ERROR = -32603;
const JSON_RPC_METHOD_NOT_ALLOWED = -32000;

/**
 * MCP over Streamable HTTP — stateless mode. Each POST builds a fresh
 * server+transport pair, handles the request, and tears down on response close.
 * No session state means clients don't need to thread `Mcp-Session-Id` headers,
 * and there's no in-memory growth across requests.
 */
export function createMcpRouter(): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    let transport: StreamableHTTPServerTransport | undefined;
    let server: ReturnType<typeof buildMcpServer> | undefined;

    const cleanup = () => {
      transport?.close().catch((err) => log.api.warn({ err }, 'MCP transport close error'));
      server?.close().catch((err) => log.api.warn({ err }, 'MCP server close error'));
    };

    try {
      server = buildMcpServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });

      res.on('close', cleanup);

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.api.error({ err }, 'MCP request failed');
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: JSON_RPC_INTERNAL_ERROR, message: 'Internal server error' },
          id: null,
        });
      }
      cleanup();
    }
  });

  // Stateless transport: GET (standalone SSE) and DELETE (session close) are not applicable.
  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: JSON_RPC_METHOD_NOT_ALLOWED, message: 'Method not allowed (stateless MCP transport)' },
      id: null,
    });
  };
  router.get('/', methodNotAllowed);
  router.delete('/', methodNotAllowed);

  return router;
}
