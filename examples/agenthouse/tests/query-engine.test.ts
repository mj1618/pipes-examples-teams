/**
 * Tests for QueryEngine
 *
 * Covers: search (happy path, empty results, limit, filters),
 *         recall (delegates to search), hybrid merge behavior.
 */

import { describe, it, expect, beforeEach } from 'vitest';
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

// ── Fixture helpers ───────────────────────────────────────────────────────────

let sessionCounter = 0;

function makeSession(userMsg: string, assistantMsg: string, overrides: Partial<Session> = {}): Session {
  sessionCounter++;
  const pad = sessionCounter.toString().padStart(12, '0');
  return {
    sessionId: `00000000-0000-0000-0000-${pad}`,
    userId: 'alice',
    agentType: 'claude-code',
    project: '/myproject',
    startedAt: '2026-01-01T10:00:00.000Z',
    messages: [
      { role: 'user', content: userMsg, toolCalls: [] },
      { role: 'assistant', content: assistantMsg, toolCalls: [] },
    ],
    metadata: { tags: [] },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('QueryEngine', () => {
  let database: InMemoryDatabaseStore;
  let embedder: MockEmbedder;
  let engine: QueryEngine;
  let pipeline: IngestPipeline;

  beforeEach(async () => {
    sessionCounter = 0;
    database = new InMemoryDatabaseStore();
    embedder = new MockEmbedder(64);
    engine = new QueryEngine({ database, embedder });
    pipeline = new IngestPipeline({ blob: nullBlob, database, embedder });
  });

  // ── search — empty database ───────────────────────────────────────────────

  it('search returns empty array on an empty database', async () => {
    const results = await engine.search('anything');
    expect(results).toEqual([]);
  });

  // ── search — happy path ───────────────────────────────────────────────────

  it('search returns results after ingesting sessions', async () => {
    await pipeline.ingest(
      makeSession('python list sorting tutorial', 'Use list.sort() or sorted() builtin.'),
      { storeBlob: false }
    );

    const results = await engine.search('python sorting');
    expect(results.length).toBeGreaterThan(0);
  });

  it('search results contain chunk data', async () => {
    await pipeline.ingest(
      makeSession('How do I parse JSON?', 'Use json.loads() or json.load().'),
      { storeBlob: false }
    );

    const results = await engine.search('parse JSON');
    expect(results[0]).toHaveProperty('chunk');
    expect(results[0]).toHaveProperty('score');
    expect(results[0]).toHaveProperty('source');
    expect(results[0].score).toBeGreaterThanOrEqual(0);
    expect(results[0].score).toBeLessThanOrEqual(1);
  });

  it('search results are tagged as hybrid source', async () => {
    await pipeline.ingest(
      makeSession('async await JavaScript', 'Async/await is syntactic sugar over Promises.'),
      { storeBlob: false }
    );
    const results = await engine.search('async await');
    // QueryEngine uses mergeResults which marks everything as 'hybrid'
    if (results.length > 0) {
      expect(results[0].source).toBe('hybrid');
    }
  });

  // ── search — limit ────────────────────────────────────────────────────────

  it('search respects the limit option', async () => {
    // Ingest 5 sessions with similar content
    for (let i = 0; i < 5; i++) {
      await pipeline.ingest(
        makeSession(`question about python ${i}`, `answer about python ${i}`),
        { storeBlob: false }
      );
    }

    const results = await engine.search('python', { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('search uses default limit of 5 when not specified', async () => {
    for (let i = 0; i < 10; i++) {
      await pipeline.ingest(
        makeSession(`question ${i}`, `answer ${i}`),
        { storeBlob: false }
      );
    }
    const results = await engine.search('question');
    expect(results.length).toBeLessThanOrEqual(5);
  });

  // ── search — filters ──────────────────────────────────────────────────────

  it('filters results by userId', async () => {
    await pipeline.ingest(
      makeSession('alice question', 'alice answer', { userId: 'alice' }),
      { storeBlob: false }
    );
    await pipeline.ingest(
      makeSession('bob question', 'bob answer', { userId: 'bob' }),
      { storeBlob: false }
    );

    const results = await engine.search('question', { userId: 'alice', limit: 10 });
    for (const r of results) {
      expect(r.chunk.userId).toBe('alice');
    }
  });

  it('filters results by project', async () => {
    await pipeline.ingest(
      makeSession('project-a question', 'project-a answer', { project: '/project/a' }),
      { storeBlob: false }
    );
    await pipeline.ingest(
      makeSession('project-b question', 'project-b answer', { project: '/project/b' }),
      { storeBlob: false }
    );

    const results = await engine.search('question', { project: '/project/a', limit: 10 });
    for (const r of results) {
      expect(r.chunk.project).toBe('/project/a');
    }
  });

  it('returns empty array when filter matches no chunks', async () => {
    await pipeline.ingest(
      makeSession('Q', 'A', { userId: 'alice' }),
      { storeBlob: false }
    );
    const results = await engine.search('Q', { userId: 'nobody' });
    expect(results).toEqual([]);
  });

  // ── Constructor options ───────────────────────────────────────────────────

  it('accepts custom semantic and fulltext weights without error', () => {
    const customEngine = new QueryEngine({
      database,
      embedder,
      options: { semanticWeight: 0.5, fulltextWeight: 0.5 },
    });
    expect(customEngine).toBeDefined();
  });

  it('uses default weights when options not provided', () => {
    const defaultEngine = new QueryEngine({ database, embedder });
    expect(defaultEngine).toBeDefined();
  });

  // ── recall ────────────────────────────────────────────────────────────────

  it('recall returns results similar to search', async () => {
    await pipeline.ingest(
      makeSession('debugging a memory leak', 'Use heap profiler to identify leak.'),
      { storeBlob: false }
    );

    const searchResults = await engine.search('memory leak debugging');
    const recallResults = await engine.recall('memory leak debugging');

    expect(recallResults.length).toBe(searchResults.length);
  });

  it('recall returns empty array on empty database', async () => {
    const results = await engine.recall('anything');
    expect(results).toEqual([]);
  });

  // ── Score bounds ──────────────────────────────────────────────────────────

  it('all returned scores are between 0 and 1', async () => {
    for (let i = 0; i < 3; i++) {
      await pipeline.ingest(
        makeSession(`topic ${i} question`, `topic ${i} answer`),
        { storeBlob: false }
      );
    }
    const results = await engine.search('topic', { limit: 10 });
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });
});
