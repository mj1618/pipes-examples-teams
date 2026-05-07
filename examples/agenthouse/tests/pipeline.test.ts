/**
 * Tests for IngestPipeline
 *
 * Covers: ingest happy path, storeBlob flag, empty session,
 *         ingestMany with progress callback, embedding batch logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IngestPipeline } from '../src/ingest/pipeline.js';
import { MockEmbedder } from '../src/ingest/embedder.js';
import { InMemoryDatabaseStore } from '../src/storage/database/memory.js';
import type { Session } from '../src/types/session.js';
import type { BlobStore } from '../src/storage/blob/interface.js';

// ── Mock BlobStore ────────────────────────────────────────────────────────────

function makeMockBlobStore(): BlobStore & { data: Map<string, Buffer>; putCalled: number } {
  const data = new Map<string, Buffer>();
  let putCalled = 0;
  return {
    data,
    get putCalled() {
      return putCalled;
    },
    async put(key: string, value: Buffer) {
      putCalled++;
      data.set(key, value);
    },
    async get(key: string) {
      return data.get(key) ?? null;
    },
    async delete(key: string) {
      data.delete(key);
    },
    async exists(key: string) {
      return data.has(key);
    },
    async list(prefix: string) {
      return Array.from(data.keys()).filter((k) => k.startsWith(prefix));
    },
  };
}

// ── Fixture helper ────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: '00000000-0000-0000-0000-000000000001',
    userId: 'alice',
    agentType: 'claude-code',
    project: '/myproject',
    startedAt: '2026-01-01T10:00:00.000Z',
    messages: [
      { role: 'user', content: 'How does Python garbage collection work?', toolCalls: [] },
      { role: 'assistant', content: 'Python uses reference counting plus a cyclic garbage collector.', toolCalls: [] },
    ],
    metadata: { tags: [] },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IngestPipeline', () => {
  let blob: ReturnType<typeof makeMockBlobStore>;
  let database: InMemoryDatabaseStore;
  let embedder: MockEmbedder;
  let pipeline: IngestPipeline;

  beforeEach(() => {
    blob = makeMockBlobStore();
    database = new InMemoryDatabaseStore();
    embedder = new MockEmbedder(64);
    pipeline = new IngestPipeline({ blob, database, embedder });
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('ingest returns an IngestResult with correct sessionId', async () => {
    const session = makeSession();
    const result = await pipeline.ingest(session);
    expect(result.sessionId).toBe(session.sessionId);
  });

  it('ingest stores chunks in the database', async () => {
    const session = makeSession();
    const result = await pipeline.ingest(session);
    expect(result.chunksIngested).toBeGreaterThan(0);

    const chunks = await database.getChunksBySession(session.sessionId);
    expect(chunks).toHaveLength(result.chunksIngested);
  });

  it('ingest attaches embeddings to stored chunks', async () => {
    const session = makeSession();
    await pipeline.ingest(session);

    const chunks = await database.getChunksBySession(session.sessionId);
    for (const chunk of chunks) {
      expect(chunk.embedding).toBeDefined();
      expect(chunk.embedding).toHaveLength(64); // MockEmbedder dimensions
    }
  });

  it('ingest upserts session metadata in the database', async () => {
    const session = makeSession();
    await pipeline.ingest(session);

    const stored = await database.getSession(session.sessionId);
    expect(stored?.sessionId).toBe(session.sessionId);
    expect(stored?.userId).toBe(session.userId);
  });

  it('ingest writes raw JSON blob by default', async () => {
    const session = makeSession();
    await pipeline.ingest(session);

    expect(blob.putCalled).toBe(1);
    expect(blob.data.has(`sessions/${session.sessionId}.json`)).toBe(true);

    const raw = blob.data.get(`sessions/${session.sessionId}.json`)!;
    const parsed = JSON.parse(raw.toString());
    expect(parsed.sessionId).toBe(session.sessionId);
  });

  it('ingest skips blob store when storeBlob=false', async () => {
    const session = makeSession();
    await pipeline.ingest(session, { storeBlob: false });
    expect(blob.putCalled).toBe(0);
  });

  it('reports durationMs as a non-negative number', async () => {
    const result = await pipeline.ingest(makeSession());
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // ── Empty session (no turn pairs) ─────────────────────────────────────────

  it('ingest handles session with no user→assistant pairs gracefully', async () => {
    const session = makeSession({ messages: [] });
    const result = await pipeline.ingest(session, { storeBlob: false });
    expect(result.chunksIngested).toBe(0);
  });

  it('ingest handles session with only system messages', async () => {
    const session = makeSession({
      messages: [{ role: 'system', content: 'System prompt only.', toolCalls: [] }],
    });
    const result = await pipeline.ingest(session, { storeBlob: false });
    expect(result.chunksIngested).toBe(0);
  });

  // ── Re-ingest (idempotent) ────────────────────────────────────────────────

  it('re-ingesting the same session is idempotent (no errors)', async () => {
    const session = makeSession();
    await pipeline.ingest(session, { storeBlob: false });
    await expect(pipeline.ingest(session, { storeBlob: false })).resolves.not.toThrow();
  });

  // ── ingestMany ────────────────────────────────────────────────────────────

  it('ingestMany processes all sessions and returns results', async () => {
    const sessions = [
      makeSession({ sessionId: '00000000-0000-0000-0000-000000000001' }),
      makeSession({ sessionId: '00000000-0000-0000-0000-000000000002' }),
      makeSession({ sessionId: '00000000-0000-0000-0000-000000000003' }),
    ];
    const results = await pipeline.ingestMany(sessions, { storeBlob: false });
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.chunksIngested).toBeGreaterThan(0);
    }
  });

  it('ingestMany calls onProgress callback for each session', async () => {
    const sessions = [
      makeSession({ sessionId: '00000000-0000-0000-0000-000000000001' }),
      makeSession({ sessionId: '00000000-0000-0000-0000-000000000002' }),
    ];
    const progressCalls: Array<{ done: number; total: number }> = [];
    await pipeline.ingestMany(sessions, { storeBlob: false }, (done, total) => {
      progressCalls.push({ done, total });
    });
    expect(progressCalls).toHaveLength(2);
    expect(progressCalls[0]).toEqual({ done: 1, total: 2 });
    expect(progressCalls[1]).toEqual({ done: 2, total: 2 });
  });

  it('ingestMany handles empty session list', async () => {
    const results = await pipeline.ingestMany([], { storeBlob: false });
    expect(results).toEqual([]);
  });

  // ── Batch embedding ───────────────────────────────────────────────────────

  it('respects embeddingBatchSize option (no error for small batch)', async () => {
    // Create a session with multiple turn pairs
    const session = makeSession({
      messages: [
        { role: 'user', content: 'Q1', toolCalls: [] },
        { role: 'assistant', content: 'A1', toolCalls: [] },
        { role: 'user', content: 'Q2', toolCalls: [] },
        { role: 'assistant', content: 'A2', toolCalls: [] },
        { role: 'user', content: 'Q3', toolCalls: [] },
        { role: 'assistant', content: 'A3', toolCalls: [] },
      ],
    });
    // With batch size = 1, embedBatch is called once per chunk
    const result = await pipeline.ingest(session, { storeBlob: false, embeddingBatchSize: 1 });
    expect(result.chunksIngested).toBe(3);
  });
});
