/**
 * Tests for MCP Tool Handlers
 *
 * Covers: agenthouse_search, agenthouse_recall, agenthouse_list,
 *         agenthouse_context — happy paths, empty results, error cases.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createToolHandlers } from '../src/mcp/tools.js';
import { QueryEngine } from '../src/query/engine.js';
import { MockEmbedder } from '../src/ingest/embedder.js';
import { InMemoryDatabaseStore } from '../src/storage/database/memory.js';
import { IngestPipeline } from '../src/ingest/pipeline.js';
import type { Session } from '../src/types/session.js';
import type { BlobStore } from '../src/storage/blob/interface.js';

// ── Null BlobStore ────────────────────────────────────────────────────────────

const nullBlob: BlobStore = {
  async put() {},
  async get() { return Buffer.from(''); },
  async list() { return []; },
  async delete() {},
  async exists() { return false; },
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SESSION_ID = '00000000-0000-0000-0000-000000000001';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: SESSION_ID,
    userId: 'alice',
    agentType: 'claude-code',
    project: '/myproject',
    startedAt: '2026-01-01T10:00:00.000Z',
    messages: [
      { role: 'user', content: 'How does Python work?', toolCalls: [] },
      { role: 'assistant', content: 'Python is an interpreted language.', toolCalls: [] },
    ],
    metadata: { tags: [] },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createToolHandlers', () => {
  let database: InMemoryDatabaseStore;
  let queryEngine: QueryEngine;
  let pipeline: IngestPipeline;
  let handlers: ReturnType<typeof createToolHandlers>;

  beforeEach(async () => {
    database = new InMemoryDatabaseStore();
    const embedder = new MockEmbedder(64);
    queryEngine = new QueryEngine({ database, embedder });
    pipeline = new IngestPipeline({ blob: nullBlob, database, embedder });
    handlers = createToolHandlers(queryEngine, database);
  });

  // ── agenthouse_search ─────────────────────────────────────────────────────

  describe('agenthouse_search', () => {
    it('returns "no results" text when database is empty', async () => {
      const result = await handlers.agenthouse_search({ query: 'anything' });
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('No results');
      expect(result.isError).toBeFalsy();
    });

    it('returns results text when matches found', async () => {
      await pipeline.ingest(makeSession(), { storeBlob: false });
      const result = await handlers.agenthouse_search({ query: 'Python' });
      expect(result.content[0].text).toContain('result');
      expect(result.isError).toBeFalsy();
    });

    it('includes the query in the response text', async () => {
      await pipeline.ingest(makeSession(), { storeBlob: false });
      const result = await handlers.agenthouse_search({ query: 'python language' });
      expect(result.content[0].text).toContain('python language');
    });

    it('response content is an array with at least one text item', async () => {
      const result = await handlers.agenthouse_search({ query: 'q' });
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0].type).toBe('text');
    });

    it('handles userId filter without error', async () => {
      await pipeline.ingest(makeSession(), { storeBlob: false });
      const result = await handlers.agenthouse_search({
        query: 'Python',
        userId: 'alice',
        limit: 3,
      });
      expect(result.isError).toBeFalsy();
    });

    it('handles date filters without error', async () => {
      await pipeline.ingest(makeSession(), { storeBlob: false });
      const result = await handlers.agenthouse_search({
        query: 'Python',
        after: '2025-01-01',
        before: '2027-01-01',
      });
      expect(result.isError).toBeFalsy();
    });

    it('handles project filter without error', async () => {
      await pipeline.ingest(makeSession(), { storeBlob: false });
      const result = await handlers.agenthouse_search({
        query: 'Python',
        project: '/myproject',
      });
      expect(result.isError).toBeFalsy();
    });
  });

  // ── agenthouse_recall ─────────────────────────────────────────────────────

  describe('agenthouse_recall', () => {
    it('returns "could not find" text when nothing matches', async () => {
      const result = await handlers.agenthouse_recall({ description: 'xyz-no-match-abc' });
      expect(result.content[0].text).toContain('Could not find');
      expect(result.isError).toBeFalsy();
    });

    it('returns best match text when something matches', async () => {
      await pipeline.ingest(makeSession(), { storeBlob: false });
      const result = await handlers.agenthouse_recall({ description: 'Python language' });
      expect(result.content[0].text).toContain('Best match');
    });

    it('includes the description in the response', async () => {
      await pipeline.ingest(makeSession(), { storeBlob: false });
      const result = await handlers.agenthouse_recall({ description: 'Python interpreted' });
      expect(result.content[0].text).toContain('Python interpreted');
    });

    it('handles userId filter without error', async () => {
      await pipeline.ingest(makeSession(), { storeBlob: false });
      const result = await handlers.agenthouse_recall({
        description: 'Python',
        userId: 'alice',
      });
      expect(result.isError).toBeFalsy();
    });
  });

  // ── agenthouse_list ───────────────────────────────────────────────────────

  describe('agenthouse_list', () => {
    describe('entity: sessions', () => {
      it('returns "No sessions found" when database is empty', async () => {
        const result = await handlers.agenthouse_list({ entity: 'sessions' });
        expect(result.content[0].text).toContain('No sessions found');
        expect(result.isError).toBeFalsy();
      });

      it('returns session list when sessions exist', async () => {
        await database.upsertSession(makeSession());
        const result = await handlers.agenthouse_list({ entity: 'sessions' });
        expect(result.content[0].text).toContain('session');
        expect(result.content[0].text).toContain(SESSION_ID);
      });

      it('filters sessions by userId', async () => {
        await database.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000001', userId: 'alice' }));
        await database.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000002', userId: 'bob' }));
        const result = await handlers.agenthouse_list({ entity: 'sessions', userId: 'alice' });
        expect(result.content[0].text).toContain('alice');
        // Bob's session should not appear
        expect(result.content[0].text).not.toContain('bob');
      });

      it('respects limit and offset', async () => {
        for (let i = 1; i <= 5; i++) {
          await database.upsertSession(
            makeSession({
              sessionId: `00000000-0000-0000-0000-00000000000${i}`,
            })
          );
        }
        const result = await handlers.agenthouse_list({ entity: 'sessions', limit: 2, offset: 0 });
        expect(result.isError).toBeFalsy();
      });
    });

    describe('entity: users', () => {
      it('returns "No users found" when database is empty', async () => {
        const result = await handlers.agenthouse_list({ entity: 'users' });
        expect(result.content[0].text).toContain('No users found');
      });

      it('returns list of unique users', async () => {
        await database.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000001', userId: 'alice' }));
        await database.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000002', userId: 'alice' }));
        await database.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000003', userId: 'bob' }));
        const result = await handlers.agenthouse_list({ entity: 'users' });
        expect(result.content[0].text).toContain('alice');
        expect(result.content[0].text).toContain('bob');
        expect(result.content[0].text).toContain('2 user');
      });
    });

    describe('entity: projects', () => {
      it('returns "No projects found" when no projects exist', async () => {
        // Session with no project
        await database.upsertSession(makeSession({ project: undefined }));
        const result = await handlers.agenthouse_list({ entity: 'projects' });
        expect(result.content[0].text).toContain('No projects found');
      });

      it('returns list of unique projects', async () => {
        await database.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000001', project: '/proj/a' }));
        await database.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000002', project: '/proj/b' }));
        await database.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000003', project: '/proj/a' }));
        const result = await handlers.agenthouse_list({ entity: 'projects' });
        expect(result.content[0].text).toContain('/proj/a');
        expect(result.content[0].text).toContain('/proj/b');
        expect(result.content[0].text).toContain('2 project');
      });
    });
  });

  // ── agenthouse_context ────────────────────────────────────────────────────

  describe('agenthouse_context', () => {
    it('returns "Session not found" for unknown sessionId', async () => {
      const result = await handlers.agenthouse_context({ sessionId: 'nonexistent-session-id' });
      expect(result.content[0].text).toContain('Session not found');
      expect(result.isError).toBeFalsy();
    });

    it('returns session context for known sessionId', async () => {
      await database.upsertSession(makeSession());
      const result = await handlers.agenthouse_context({ sessionId: SESSION_ID });
      expect(result.content[0].text).toContain(SESSION_ID);
      expect(result.content[0].text).toContain('alice');
      expect(result.content[0].text).toContain('[USER]');
      expect(result.content[0].text).toContain('[ASSISTANT]');
    });

    it('includes message content in the response', async () => {
      await database.upsertSession(makeSession());
      const result = await handlers.agenthouse_context({ sessionId: SESSION_ID });
      expect(result.content[0].text).toContain('How does Python work?');
      expect(result.content[0].text).toContain('Python is an interpreted language.');
    });

    it('includes tool call info when present', async () => {
      const sessionWithTools = makeSession({
        messages: [
          { role: 'user', content: 'Read the file', toolCalls: [] },
          {
            role: 'assistant',
            content: 'Here is the file content.',
            toolCalls: [{ name: 'read_file', input: { path: '/foo.py' }, output: 'contents' }],
          },
        ],
      });
      await database.upsertSession(sessionWithTools);
      const result = await handlers.agenthouse_context({ sessionId: SESSION_ID });
      expect(result.content[0].text).toContain('read_file');
    });

    it('shows agent type and project in response', async () => {
      await database.upsertSession(makeSession({ agentType: 'cursor', project: '/some/project' }));
      const result = await handlers.agenthouse_context({ sessionId: SESSION_ID });
      expect(result.content[0].text).toContain('cursor');
      expect(result.content[0].text).toContain('/some/project');
    });
  });
});
