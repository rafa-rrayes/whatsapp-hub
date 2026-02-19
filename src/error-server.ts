import http from 'node:http';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderErrorPage(errors: string[]): string {
  const errorBlocks = errors
    .map(
      (e) =>
        `<div class="error-block"><pre>${escapeHtml(e)}</pre></div>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="30">
  <title>WhatsApp Hub — Startup Error</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f1117;
      color: #e1e4e8;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .container {
      max-width: 640px;
      width: 100%;
    }
    h1 {
      font-size: 1.5rem;
      color: #ff6b6b;
      margin-bottom: 0.5rem;
    }
    .subtitle {
      color: #8b949e;
      margin-bottom: 1.5rem;
      font-size: 0.9rem;
    }
    .error-block {
      background: #161b22;
      border: 1px solid #f8514966;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 1rem;
    }
    .error-block pre {
      white-space: pre-wrap;
      word-break: break-word;
      font-family: 'SF Mono', SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 0.85rem;
      color: #ffa198;
      line-height: 1.5;
    }
    .instructions {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-top: 0.5rem;
    }
    .instructions h2 {
      font-size: 0.85rem;
      color: #8b949e;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.75rem;
    }
    .instructions ol {
      padding-left: 1.25rem;
      color: #c9d1d9;
      font-size: 0.9rem;
      line-height: 1.8;
    }
    .instructions code {
      background: #0d1117;
      padding: 0.15em 0.4em;
      border-radius: 4px;
      font-size: 0.85em;
      color: #79c0ff;
    }
    .refresh-note {
      text-align: center;
      color: #484f58;
      font-size: 0.8rem;
      margin-top: 1.5rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Startup Failed</h1>
    <p class="subtitle">WhatsApp Hub could not start due to configuration errors.</p>
    ${errorBlocks}
    <div class="instructions">
      <h2>How to fix</h2>
      <ol>
        <li>Edit your <code>.env</code> file (or environment variables) to fix the errors above</li>
        <li>Restart the container: <code>docker compose up -d</code></li>
      </ol>
    </div>
    <p class="refresh-note">This page auto-refreshes every 30 seconds.</p>
  </div>
</body>
</html>`;
}

export function startErrorServer(
  port: number,
  host: string,
  errors: string[]
): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', errors }));
      return;
    }

    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderErrorPage(errors));
  });

  server.listen(port, host, () => {
    process.stderr.write(
      `Error server listening on http://${host}:${port} — fix the errors above and restart.\n`
    );
  });

  return server;
}
