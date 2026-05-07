/**
 * Tests for the MCP Server (JSON-RPC request handling)
 *
 * Covers: initialize, tools/list, tools/call (all 4 tools),
 *         notifications/initialized, unknown methods, error responses.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createMCPServer } from '../src/mcp/server.js';
import { QueryEngine } from '../src/query/engine.js';
import { MockEmbedder } from '../src/ingest/embedder.js';
import { InMemoryDatabaseStore } from '../src/storage/database/memory.js';
import { TOOL_DEFINITIONS } from '../src/mcp/tools.js';
import type { Session } from '../src/types/session.js';

// ── Test setup ────────────────────────────────────────────────────────────────

function makeServer() {
  const database = new InMemoryDatabaseStore();
  const embedder = new MockEmbedder(64);
  const queryEngine = new QueryEngine({ database, embedder });
  const server = createMCPServer({ database, queryEngine });
  return { server, database };
}

function req(id: number | string | null, method: string, params?: unknown) {
  return { jsonrpc: '2.0' as const, id, method, params };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MCPServer.handleRequest', () => {
  let server: ReturnType<typeof makeServer>['server'];
  let database: InMemoryDatabaseStore;

  beforeEach(() => {
    ({ server, database } = makeServer());
  });

  // ── Lifecycle methods ─────────────────────────────────────────────────────

  describe('initialize', () => {
    it('returns protocolVersion in result', async () => {
      const response = await server.handleRequest(req(1, 'initialize'));
      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.result).toMatchObject({
        protocolVersion: expect.any(String),
        capabilities: { tools: {} },
        serverInfo: expect.objectContaining({ name: 'agenthouse' }),
      });
      expect(response.error).toBeUndefined();
    });

    it('echoes the request id', async () => {
      const response = await server.handleRequest(req('myid', 'initialize'));
      expect(response.id).toBe('myid');
    });

    it('uses custom serverInfo when provided', async () => {
      const db = new InMemoryDatabaseStore();
      const qe = new QueryEngine({ database: db, embedder: new MockEmbedder() });
      const customServer = createMCPServer({
        database: db,
        queryEngine: qe,
        serverInfo: { name: 'custom', version: '9.9.9' },
      });
      const response = await customServer.handleRequest(req(1, 'initialize'));
      expect((response.result as { serverInfo: { name: string } }).serverInfo.name).toBe('custom');
    });
  });

  describe('tools/list', () => {
    it('returns the list of TOOL_DEFINITIONS', async () => {
      const response = await server.handleRequest(req(2, 'tools/list'));
      expect(response.error).toBeUndefined();
      const result = response.result as { tools: typeof TOOL_DEFINITIONS };
      expect(result.tools).toBeDefined();
      expect(result.tools).toHaveLength(TOOL_DEFINITIONS.length);
    });

    it('includes agenthouse_search, agenthouse_recall, agenthouse_list, agenthouse_context', async () => {
      const response = await server.handleRequest(req(3, 'tools/list'));
      const tools = (response.result as { tools: Array<{ name: string }> }).tools;
      const names = tools.map((t) => t.name);
      expect(names).toContain('agenthouse_search');
      expect(names).toContain('agenthouse_recall');
      expect(names).toContain('agenthouse_list');
      expect(names).toContain('agenthouse_context');
    });
  });

  // ── tools/call ────────────────────────────────────────────────────────────

  describe('tools/call — agenthouse_search', () => {
    it('returns a result for valid search call', async () => {
      const response = await server.handleRequest(
        req(4, 'tools/call', {
          name: 'agenthouse_search',
          arguments: { query: 'test query' },
        })
      );
      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();
    });

    it('returns error for unknown tool name', async () => {
      const response = await server.handleRequest(
        req(5, 'tools/call', {
          name: 'nonexistent_tool',
          arguments: {},
        })
      );
      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32601);
      expect(response.error!.message).toContain('Unknown tool');
    });
  });

  describe('tools/call — agenthouse_list', () => {
    it('lists sessions successfully', async () => {
      const response = await server.handleRequest(
        req(6, 'tools/call', {
          name: 'agenthouse_list',
          arguments: { entity: 'sessions' },
        })
      );
      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();
    });

    it('lists users successfully', async () => {
      const response = await server.handleRequest(
        req(7, 'tools/call', {
          name: 'agenthouse_list',
          arguments: { entity: 'users' },
        })
      );
      expect(response.error).toBeUndefined();
    });

    it('lists projects successfully', async () => {
      const response = await server.handleRequest(
        req(8, 'tools/call', {
          name: 'agenthouse_list',
          arguments: { entity: 'projects' },
        })
      );
      expect(response.error).toBeUndefined();
    });
  });

  describe('tools/call — agenthouse_context', () => {
    it('returns "session not found" for unknown sessionId', async () => {
      const response = await server.handleRequest(
        req(9, 'tools/call', {
          name: 'agenthouse_context',
          arguments: { sessionId: 'nonexistent' },
        })
      );
      expect(response.error).toBeUndefined();
      const result = response.result as { content: Array<{ text: string }> };
      expect(result.content[0].text).toContain('not found');
    });

    it('returns full context for a known session', async () => {
      const session: Session = {
        sessionId: '00000000-0000-0000-0000-000000000001',
        userId: 'alice',
        agentType: 'claude-code',
        project: '/proj',
        startedAt: '2026-01-01T10:00:00.000Z',
        messages: [
          { role: 'user', content: 'Test question', toolCalls: [] },
          { role: 'assistant', content: 'Test answer', toolCalls: [] },
        ],
        metadata: { tags: [] },
      };
      await database.upsertSession(session);

      const response = await server.handleRequest(
        req(10, 'tools/call', {
          name: 'agenthouse_context',
          arguments: { sessionId: '00000000-0000-0000-0000-000000000001' },
        })
      );
      expect(response.error).toBeUndefined();
      const result = response.result as { content: Array<{ text: string }> };
      expect(result.content[0].text).toContain('Test question');
    });
  });

  describe('tools/call — agenthouse_recall', () => {
    it('returns a result for recall call', async () => {
      const response = await server.handleRequest(
        req(11, 'tools/call', {
          name: 'agenthouse_recall',
          arguments: { description: 'that time I asked about Python' },
        })
      );
      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();
    });
  });

  // ── notifications ─────────────────────────────────────────────────────────

  describe('notifications/initialized', () => {
    it('returns null result (no response for notifications)', async () => {
      const response = await server.handleRequest(req(null, 'notifications/initialized'));
      expect(response.id).toBeNull();
      expect(response.result).toBeNull();
      expect(response.error).toBeUndefined();
    });
  });

  // ── unknown method ────────────────────────────────────────────────────────

  describe('unknown method', () => {
    it('returns method not found error (-32601)', async () => {
      const response = await server.handleRequest(req(99, 'totally/unknown'));
      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32601);
      expect(response.error!.message).toContain('Method not found');
    });

    it('echoes the request id in error responses', async () => {
      const response = await server.handleRequest(req(42, 'unknown'));
      expect(response.id).toBe(42);
    });
  });

  // ── Response structure ────────────────────────────────────────────────────

  describe('response structure', () => {
    it('always returns jsonrpc: "2.0"', async () => {
      const response = await server.handleRequest(req(1, 'initialize'));
      expect(response.jsonrpc).toBe('2.0');
    });

    it('never has both result and error', async () => {
      const responses = await Promise.all([
        server.handleRequest(req(1, 'initialize')),
        server.handleRequest(req(2, 'unknown')),
      ]);
      for (const r of responses) {
        expect(r.result === undefined || r.error === undefined).toBe(true);
      }
    });
  });
});
