/**
 * MCP Server for Agenthouse.
 *
 * Exposes four tools to any MCP-compatible client:
 *   - agenthouse_search
 *   - agenthouse_recall
 *   - agenthouse_list
 *   - agenthouse_context
 *
 * MCP (Model Context Protocol) is a JSON-RPC 2.0-based protocol.
 * This implementation provides the core request-handling logic
 * without calling listen() — the transport layer (stdio/HTTP) is
 * injected externally to keep this module testable.
 *
 * Usage:
 * ```ts
 * const server = createMCPServer({ database, queryEngine });
 * // Wire to stdio transport:
 * process.stdin.on('data', async (chunk) => {
 *   const response = await server.handleRequest(JSON.parse(chunk));
 *   process.stdout.write(JSON.stringify(response) + '\n');
 * });
 * ```
 */

import type { DatabaseStore } from '../storage/database/interface.js';
import type { QueryEngine } from '../query/engine.js';
import { TOOL_DEFINITIONS, createToolHandlers, type ToolHandlers } from './tools.js';

// ── JSON-RPC types ────────────────────────────────────────────────────────────

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: unknown;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ── MCP Server ────────────────────────────────────────────────────────────────

export interface MCPServer {
  /**
   * Handle a single MCP JSON-RPC request and return a response.
   * Does NOT write to any transport — the caller does that.
   */
  handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse>;
}

export interface MCPServerConfig {
  database: DatabaseStore;
  queryEngine: QueryEngine;
  serverInfo?: { name: string; version: string };
}

/**
 * Create an MCP server instance.
 * Exported for testing; call listen() separately to wire up a transport.
 */
export function createMCPServer(config: MCPServerConfig): MCPServer {
  const handlers: ToolHandlers = createToolHandlers(config.queryEngine, config.database);
  const serverInfo = config.serverInfo ?? { name: 'agenthouse', version: '0.1.0' };

  return {
    async handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
      const { id, method, params } = request;

      try {
        switch (method) {
          // ── MCP lifecycle ─────────────────────────────────────────────────

          case 'initialize': {
            return {
              jsonrpc: '2.0',
              id,
              result: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo,
              },
            };
          }

          case 'tools/list': {
            return {
              jsonrpc: '2.0',
              id,
              result: { tools: TOOL_DEFINITIONS },
            };
          }

          // ── Tool calls ────────────────────────────────────────────────────

          case 'tools/call': {
            const { name, arguments: args } = params as {
              name: string;
              arguments: Record<string, unknown>;
            };

            const handler = handlers[name as keyof ToolHandlers];
            if (!handler) {
              return rpcError(id, -32601, `Unknown tool: ${name}`);
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await (handler as (input: any) => Promise<unknown>)(args);
            return { jsonrpc: '2.0', id, result };
          }

          // ── Notifications (no response expected) ──────────────────────────

          case 'notifications/initialized':
            // No response for notifications
            return { jsonrpc: '2.0', id: null, result: null };

          // ── Unknown method ────────────────────────────────────────────────

          default:
            return rpcError(id, -32601, `Method not found: ${method}`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return rpcError(id, -32603, `Internal error: ${msg}`);
      }
    },
  };
}

// ── stdio transport (entry point) ─────────────────────────────────────────────

/**
 * Wire the MCP server to stdio (line-delimited JSON-RPC).
 * Call this from your CLI entry point — NOT from library code.
 */
export async function startMCPStdioServer(config: MCPServerConfig): Promise<void> {
  const server = createMCPServer(config);
  const rl = (await import('node:readline')).createInterface({ input: process.stdin });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request: JSONRPCRequest;
    try {
      request = JSON.parse(trimmed) as JSONRPCRequest;
    } catch {
      const errResp = rpcError(null, -32700, 'Parse error');
      process.stdout.write(JSON.stringify(errResp) + '\n');
      return;
    }

    const response = await server.handleRequest(request);

    // Don't write response for notifications
    if (response.id === null && response.result === null) return;

    process.stdout.write(JSON.stringify(response) + '\n');
  });

  // Keep alive
  await new Promise<void>((resolve) => {
    rl.on('close', resolve);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rpcError(
  id: string | number | null,
  code: number,
  message: string
): JSONRPCResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
