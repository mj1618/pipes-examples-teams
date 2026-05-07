/**
 * Tests for InMemoryDatabaseStore
 *
 * Covers: lifecycle, chunk storage, semantic search, full-text search,
 *         session CRUD, filters, housekeeping, stats.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryDatabaseStore } from '../src/storage/database/memory.js';
import type { Chunk } from '../src/types/chunk.js';
import type { Session } from '../src/types/session.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: '00000000-0000-0000-0000-000000000001',
    userId: 'alice',
    agentType: 'claude-code',
    project: '/home/alice/myproject',
    startedAt: '2026-01-01T10:00:00.000Z',
    messages: [
      { role: 'user', content: 'Hello', toolCalls: [] },
      { role: 'assistant', content: 'Hi there!', toolCalls: [] },
    ],
    metadata: { tags: [] },
    ...overrides,
  };
}

function makeChunk(overrides: Partial<Chunk> = {}): Chunk {
  return {
    chunkId: '00000000-0000-0000-0000-000000000011',
    sessionId: '00000000-0000-0000-0000-000000000001',
    userId: 'alice',
    project: '/home/alice/myproject',
    agentType: 'claude-code',
    timestamp: '2026-01-01T10:00:00.000Z',
    turnIndex: 0,
    userMessage: 'How do I sort a list in Python?',
    assistantMessage: 'You can use list.sort() or sorted().',
    toolCalls: [],
    ...overrides,
  };
}

// Normalized 3-dimensional vectors for cosine similarity tests
const VEC_A = [1, 0, 0];
const VEC_B = [0, 1, 0];
const VEC_C = [1, 0, 0]; // identical to VEC_A → cosine similarity = 1

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('InMemoryDatabaseStore', () => {
  let store: InMemoryDatabaseStore;

  beforeEach(() => {
    store = new InMemoryDatabaseStore();
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('initializes without error', async () => {
      await expect(store.initialize()).resolves.toBeUndefined();
    });

    it('closes without error', async () => {
      await expect(store.close()).resolves.toBeUndefined();
    });
  });

  // ── Chunk storage ──────────────────────────────────────────────────────────

  describe('chunk storage', () => {
    it('inserts and retrieves a single chunk', async () => {
      const chunk = makeChunk();
      await store.insertChunks([chunk]);
      const retrieved = await store.getChunk(chunk.chunkId);
      expect(retrieved).toEqual(chunk);
    });

    it('returns null for an unknown chunkId', async () => {
      const result = await store.getChunk('non-existent-id');
      expect(result).toBeNull();
    });

    it('inserts multiple chunks', async () => {
      const chunks = [
        makeChunk({ chunkId: 'aaa', turnIndex: 0 }),
        makeChunk({ chunkId: 'bbb', turnIndex: 1 }),
        makeChunk({ chunkId: 'ccc', turnIndex: 2 }),
      ];
      await store.insertChunks(chunks);
      for (const c of chunks) {
        expect(await store.getChunk(c.chunkId)).toEqual(c);
      }
    });

    it('overwrites an existing chunk on re-insert (idempotent upsert)', async () => {
      const chunk = makeChunk({ userMessage: 'original' });
      await store.insertChunks([chunk]);
      await store.insertChunks([{ ...chunk, userMessage: 'updated' }]);
      const result = await store.getChunk(chunk.chunkId);
      expect(result?.userMessage).toBe('updated');
    });

    it('getChunksBySession returns chunks sorted by turnIndex', async () => {
      const sessionId = '00000000-0000-0000-0000-000000000001';
      const chunks = [
        makeChunk({ chunkId: 'x2', turnIndex: 2 }),
        makeChunk({ chunkId: 'x0', turnIndex: 0 }),
        makeChunk({ chunkId: 'x1', turnIndex: 1 }),
      ];
      await store.insertChunks(chunks);
      const result = await store.getChunksBySession(sessionId);
      expect(result.map((c) => c.turnIndex)).toEqual([0, 1, 2]);
    });

    it('getChunksBySession returns empty array for unknown session', async () => {
      const result = await store.getChunksBySession('unknown-session');
      expect(result).toEqual([]);
    });

    it('getChunksBySession only returns chunks belonging to that session', async () => {
      const s1 = makeChunk({ chunkId: 'c1', sessionId: 'session-1' });
      const s2 = makeChunk({ chunkId: 'c2', sessionId: 'session-2' });
      await store.insertChunks([s1, s2]);
      const result = await store.getChunksBySession('session-1');
      expect(result).toHaveLength(1);
      expect(result[0].chunkId).toBe('c1');
    });
  });

  // ── Semantic search ────────────────────────────────────────────────────────

  describe('searchSemantic', () => {
    it('returns empty array when no chunks have embeddings', async () => {
      await store.insertChunks([makeChunk()]); // no embedding
      const result = await store.searchSemantic([1, 0, 0]);
      expect(result).toEqual([]);
    });

    it('finds a chunk by exact cosine similarity', async () => {
      const chunk = makeChunk({ chunkId: 'e1', embedding: VEC_A });
      await store.insertChunks([chunk]);
      const results = await store.searchSemantic(VEC_C); // VEC_C === VEC_A
      expect(results).toHaveLength(1);
      expect(results[0].chunk.chunkId).toBe('e1');
      expect(results[0].score).toBeCloseTo(1, 5);
      expect(results[0].source).toBe('semantic');
    });

    it('ranks results by descending cosine similarity', async () => {
      await store.insertChunks([
        makeChunk({ chunkId: 'low', embedding: VEC_B }),   // orthogonal → score 0
        makeChunk({ chunkId: 'high', embedding: VEC_A }),  // parallel  → score 1
      ]);
      const results = await store.searchSemantic(VEC_A);
      expect(results[0].chunk.chunkId).toBe('high');
      expect(results[1].chunk.chunkId).toBe('low');
    });

    it('respects the limit option', async () => {
      await store.insertChunks([
        makeChunk({ chunkId: 'r1', embedding: VEC_A }),
        makeChunk({ chunkId: 'r2', embedding: VEC_A }),
        makeChunk({ chunkId: 'r3', embedding: VEC_A }),
      ]);
      const results = await store.searchSemantic(VEC_A, { limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('filters by userId', async () => {
      await store.insertChunks([
        makeChunk({ chunkId: 'alice-chunk', userId: 'alice', embedding: VEC_A }),
        makeChunk({ chunkId: 'bob-chunk', userId: 'bob', embedding: VEC_A }),
      ]);
      const results = await store.searchSemantic(VEC_A, { userId: 'alice', limit: 10 });
      expect(results).toHaveLength(1);
      expect(results[0].chunk.userId).toBe('alice');
    });

    it('filters by project', async () => {
      await store.insertChunks([
        makeChunk({ chunkId: 'proj1', project: '/proj/a', embedding: VEC_A }),
        makeChunk({ chunkId: 'proj2', project: '/proj/b', embedding: VEC_A }),
      ]);
      const results = await store.searchSemantic(VEC_A, { project: '/proj/a', limit: 10 });
      expect(results).toHaveLength(1);
      expect(results[0].chunk.project).toBe('/proj/a');
    });

    it('filters by agentType', async () => {
      await store.insertChunks([
        makeChunk({ chunkId: 'cc', agentType: 'claude-code', embedding: VEC_A }),
        makeChunk({ chunkId: 'cu', agentType: 'cursor', embedding: VEC_A }),
      ]);
      const results = await store.searchSemantic(VEC_A, { agentType: 'cursor', limit: 10 });
      expect(results).toHaveLength(1);
      expect(results[0].chunk.agentType).toBe('cursor');
    });

    it('returns 0 score for zero vector', async () => {
      await store.insertChunks([makeChunk({ chunkId: 'z', embedding: [0, 0, 0] })]);
      const results = await store.searchSemantic([0, 0, 0], { limit: 10 });
      expect(results[0].score).toBe(0);
    });

    it('returns 0 for mismatched vector dimensions', async () => {
      await store.insertChunks([makeChunk({ chunkId: 'dim', embedding: [1, 0] })]);
      const results = await store.searchSemantic([1, 0, 0], { limit: 10 });
      expect(results[0].score).toBe(0);
    });
  });

  // ── Full-text search ───────────────────────────────────────────────────────

  describe('searchFullText', () => {
    it('returns empty array when no chunks match', async () => {
      await store.insertChunks([makeChunk({ userMessage: 'hello', assistantMessage: 'world' })]);
      const results = await store.searchFullText('zzz-no-match');
      expect(results).toEqual([]);
    });

    it('finds a chunk containing query terms', async () => {
      const chunk = makeChunk({
        chunkId: 'ft1',
        userMessage: 'python sorting',
        assistantMessage: 'Use sort() or sorted()',
      });
      await store.insertChunks([chunk]);
      const results = await store.searchFullText('sorting');
      expect(results).toHaveLength(1);
      expect(results[0].chunk.chunkId).toBe('ft1');
      expect(results[0].source).toBe('fulltext');
    });

    it('scores partial matches lower than full matches', async () => {
      await store.insertChunks([
        makeChunk({ chunkId: 'full', userMessage: 'python list sort', assistantMessage: '' }),
        makeChunk({ chunkId: 'partial', userMessage: 'python', assistantMessage: '' }),
      ]);
      const results = await store.searchFullText('python list sort');
      const fullIdx = results.findIndex((r) => r.chunk.chunkId === 'full');
      const partialIdx = results.findIndex((r) => r.chunk.chunkId === 'partial');
      expect(fullIdx).toBeLessThan(partialIdx);
    });

    it('is case insensitive', async () => {
      await store.insertChunks([
        makeChunk({ chunkId: 'case', userMessage: 'HELLO WORLD', assistantMessage: '' }),
      ]);
      const results = await store.searchFullText('hello world');
      expect(results).toHaveLength(1);
    });

    it('respects the limit option', async () => {
      await store.insertChunks([
        makeChunk({ chunkId: 'a1', userMessage: 'foo', assistantMessage: '' }),
        makeChunk({ chunkId: 'a2', userMessage: 'foo', assistantMessage: '' }),
        makeChunk({ chunkId: 'a3', userMessage: 'foo', assistantMessage: '' }),
      ]);
      const results = await store.searchFullText('foo', { limit: 2 });
      expect(results).toHaveLength(2);
    });
  });

  // ── Session metadata ───────────────────────────────────────────────────────

  describe('session metadata', () => {
    it('upserts and retrieves a session', async () => {
      const session = makeSession();
      await store.upsertSession(session);
      const result = await store.getSession(session.sessionId);
      expect(result).toEqual(session);
    });

    it('returns null for unknown sessionId', async () => {
      const result = await store.getSession('non-existent');
      expect(result).toBeNull();
    });

    it('updates session on re-upsert', async () => {
      const session = makeSession();
      await store.upsertSession(session);
      await store.upsertSession({ ...session, endedAt: '2026-01-01T11:00:00.000Z' });
      const result = await store.getSession(session.sessionId);
      expect(result?.endedAt).toBe('2026-01-01T11:00:00.000Z');
    });

    it('listSessions returns all sessions sorted newest first', async () => {
      const s1 = makeSession({
        sessionId: '00000000-0000-0000-0000-000000000001',
        startedAt: '2026-01-01T10:00:00.000Z',
      });
      const s2 = makeSession({
        sessionId: '00000000-0000-0000-0000-000000000002',
        startedAt: '2026-01-02T10:00:00.000Z',
      });
      await store.upsertSession(s1);
      await store.upsertSession(s2);
      const result = await store.listSessions();
      expect(result[0].sessionId).toBe(s2.sessionId); // newer first
      expect(result[1].sessionId).toBe(s1.sessionId);
    });

    it('listSessions returns SessionSummary shape', async () => {
      const session = makeSession({ metadata: { tokenCount: 42, tags: ['tag1'] } });
      await store.upsertSession(session);
      const [summary] = await store.listSessions();
      expect(summary).toMatchObject({
        sessionId: session.sessionId,
        userId: session.userId,
        agentType: session.agentType,
        project: session.project,
        startedAt: session.startedAt,
        messageCount: session.messages.length,
        tokenCount: 42,
        tags: ['tag1'],
      });
    });

    it('filters by userId', async () => {
      await store.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000001', userId: 'alice' }));
      await store.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000002', userId: 'bob' }));
      const result = await store.listSessions({ userId: 'alice' });
      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe('alice');
    });

    it('filters by project', async () => {
      await store.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000001', project: '/proj/a' }));
      await store.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000002', project: '/proj/b' }));
      const result = await store.listSessions({ project: '/proj/a' });
      expect(result).toHaveLength(1);
      expect(result[0].project).toBe('/proj/a');
    });

    it('filters by agentType', async () => {
      await store.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000001', agentType: 'claude-code' }));
      await store.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000002', agentType: 'cursor' }));
      const result = await store.listSessions({ agentType: 'cursor' });
      expect(result).toHaveLength(1);
    });

    it('filters by after date', async () => {
      await store.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000001', startedAt: '2026-01-01T10:00:00.000Z' }));
      await store.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000002', startedAt: '2026-02-01T10:00:00.000Z' }));
      const result = await store.listSessions({ after: new Date('2026-01-15') });
      expect(result).toHaveLength(1);
      expect(result[0].startedAt).toBe('2026-02-01T10:00:00.000Z');
    });

    it('filters by before date', async () => {
      await store.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000001', startedAt: '2026-01-01T10:00:00.000Z' }));
      await store.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000002', startedAt: '2026-02-01T10:00:00.000Z' }));
      const result = await store.listSessions({ before: new Date('2026-01-15') });
      expect(result).toHaveLength(1);
      expect(result[0].startedAt).toBe('2026-01-01T10:00:00.000Z');
    });

    it('respects limit and offset', async () => {
      for (let i = 1; i <= 5; i++) {
        await store.upsertSession(
          makeSession({
            sessionId: `00000000-0000-0000-0000-00000000000${i}`,
            startedAt: `2026-01-0${i}T10:00:00.000Z`,
          })
        );
      }
      const page1 = await store.listSessions({ limit: 2, offset: 0 });
      const page2 = await store.listSessions({ limit: 2, offset: 2 });
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].sessionId).not.toBe(page2[0].sessionId);
    });
  });

  // ── Housekeeping ───────────────────────────────────────────────────────────

  describe('deleteSession', () => {
    it('deletes session and its chunks', async () => {
      const session = makeSession();
      const chunk = makeChunk({ sessionId: session.sessionId });
      await store.upsertSession(session);
      await store.insertChunks([chunk]);

      await store.deleteSession(session.sessionId);

      expect(await store.getSession(session.sessionId)).toBeNull();
      expect(await store.getChunk(chunk.chunkId)).toBeNull();
    });

    it('does not delete chunks from other sessions', async () => {
      const s1 = makeSession({ sessionId: '00000000-0000-0000-0000-000000000001' });
      const s2 = makeSession({ sessionId: '00000000-0000-0000-0000-000000000002' });
      const c1 = makeChunk({ chunkId: 'c1', sessionId: s1.sessionId });
      const c2 = makeChunk({ chunkId: 'c2', sessionId: s2.sessionId });
      await store.upsertSession(s1);
      await store.upsertSession(s2);
      await store.insertChunks([c1, c2]);

      await store.deleteSession(s1.sessionId);
      expect(await store.getChunk(c2.chunkId)).not.toBeNull();
    });

    it('is a no-op for non-existent session', async () => {
      await expect(store.deleteSession('does-not-exist')).resolves.toBeUndefined();
    });
  });

  describe('clear', () => {
    it('removes all sessions and chunks', async () => {
      await store.upsertSession(makeSession());
      await store.insertChunks([makeChunk()]);
      store.clear();
      const sessions = await store.listSessions();
      const chunk = await store.getChunk(makeChunk().chunkId);
      expect(sessions).toHaveLength(0);
      expect(chunk).toBeNull();
    });
  });

  // ── Stats ──────────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns zeros on empty store', async () => {
      const stats = await store.getStats();
      expect(stats.totalChunks).toBe(0);
      expect(stats.totalSessions).toBe(0);
      expect(stats.totalUsers).toBe(0);
      expect(stats.oldestEntry).toBeUndefined();
      expect(stats.newestEntry).toBeUndefined();
    });

    it('counts sessions, chunks, and unique users', async () => {
      await store.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000001', userId: 'alice' }));
      await store.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000002', userId: 'alice' }));
      await store.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000003', userId: 'bob' }));
      await store.insertChunks([makeChunk({ chunkId: 'x1' }), makeChunk({ chunkId: 'x2' })]);

      const stats = await store.getStats();
      expect(stats.totalSessions).toBe(3);
      expect(stats.totalChunks).toBe(2);
      expect(stats.totalUsers).toBe(2); // alice + bob
    });

    it('reports oldest and newest session dates', async () => {
      await store.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000001', startedAt: '2026-01-01T10:00:00.000Z' }));
      await store.upsertSession(makeSession({ sessionId: '00000000-0000-0000-0000-000000000002', startedAt: '2026-03-01T10:00:00.000Z' }));

      const stats = await store.getStats();
      expect(stats.oldestEntry?.getFullYear()).toBe(2026);
      expect(stats.newestEntry?.getMonth()).toBe(2); // March = 2
    });
  });
});
