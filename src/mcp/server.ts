/**
 * Minimal MCP server over stdio (newline-delimited JSON, Content-Length too).
 * Zero dependencies — replaces @modelcontextprotocol/sdk in the cold path.
 * Speaks: initialize, notifications/initialized, notifications/cancelled,
 * ping, tools/list, tools/call. Tool handlers run in main or hot worker;
 * this layer only frames JSON-RPC.
 */
import type { ToolDef } from './schemas.js';

const KNOWN_PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
const LATEST_PROTOCOL = '2025-11-25';

export interface McpServerOptions {
  name: string;
  version: string;
  instructions: string;
  tools: ToolDef[];
  onShutdown: () => Promise<void>;
}

function send(obj: unknown): void {
  try {
    process.stdout.write(JSON.stringify(obj) + '\n');
  } catch {
    // stdout closed — nothing to do.
  }
}

function result(id: unknown, res: unknown): void {
  send({ jsonrpc: '2.0', id, result: res });
}

function error(id: unknown, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

export async function serveMcp(opts: McpServerOptions): Promise<void> {
  const byName = new Map(opts.tools.map((t) => [t.name, t]));

  async function handle(msg: { id?: unknown; method?: unknown; params?: unknown }): Promise<void> {
    const { id, method, params } = msg ?? {};
    const isNotification = id === undefined || id === null;
    if (typeof method !== 'string') {
      if (!isNotification) error(id ?? null, -32600, 'Invalid Request: missing method');
      return;
    }
    switch (method) {
      case 'initialize': {
        const reqVer = params && typeof params === 'object'
          ? (params as Record<string, unknown>).protocolVersion
          : undefined;
        const version = typeof reqVer === 'string' && KNOWN_PROTOCOLS.includes(reqVer)
          ? reqVer
          : LATEST_PROTOCOL;
        result(id, {
          protocolVersion: version,
          capabilities: { tools: {} },
          serverInfo: { name: opts.name, version: opts.version },
          instructions: opts.instructions,
        });
        return;
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return; // notifications: no reply
      case 'ping':
        result(id, {});
        return;
      case 'tools/list':
        result(id, {
          tools: opts.tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });
        return;
      case 'tools/call': {
        const p = (params ?? {}) as Record<string, unknown>;
        if (typeof p.name !== 'string') {
          error(id, -32602, 'Invalid params: tools/call requires {name: string, arguments?: object}');
          return;
        }
        const tool = byName.get(p.name);
        if (!tool) {
          error(id, -32601, `Unknown tool: ${p.name}`);
          return;
        }
        const args = p.arguments === undefined ? {} : p.arguments;
        if (!args || typeof args !== 'object' || Array.isArray(args)) {
          error(id, -32602, 'Invalid params: arguments must be an object');
          return;
        }
        try {
          const out = await tool.run(args as Record<string, unknown>);
          result(id, out);
        } catch (e) {
          result(id, {
            content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
            isError: true,
          });
        }
        return;
      }
      default:
        if (!isNotification) error(id, -32601, `Method not found: ${method}`);
    }
  }

  function dispatchLine(line: string): void {
    let parsed: { id?: unknown; method?: unknown; params?: unknown };
    try {
      parsed = JSON.parse(line);
    } catch {
      error(null, -32700, 'Parse error: expected a JSON-RPC object per line');
      return;
    }
    void handle(parsed);
  }

  let inBuf = Buffer.alloc(0);
  process.stdin.on('data', (chunk: Buffer) => {
    inBuf = Buffer.concat([inBuf, chunk]);
    for (;;) {
      // Legacy Content-Length framing?
      if (inBuf.slice(0, 15).toString().startsWith('Content-Length')) {
        const h = inBuf.indexOf('\r\n\r\n');
        if (h === -1) return;
        const m = /Content-Length:\s*(\d+)/i.exec(inBuf.slice(0, h).toString());
        const len = m ? Number(m[1]) : NaN;
        if (!Number.isFinite(len)) {
          inBuf = inBuf.slice(h + 4);
          continue;
        }
        if (inBuf.length < h + 4 + len) return;
        const body = inBuf.slice(h + 4, h + 4 + len).toString();
        inBuf = inBuf.slice(h + 4 + len);
        dispatchLine(body);
      } else {
        const nl = inBuf.indexOf('\n');
        if (nl === -1) return;
        const line = inBuf.slice(0, nl).toString().trim();
        inBuf = inBuf.slice(nl + 1);
        if (!line) continue;
        dispatchLine(line);
      }
    }
  });

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await opts.onShutdown();
    } finally {
      process.exit(0);
    }
  }

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  process.stdin.on('end', () => void shutdown());
}
