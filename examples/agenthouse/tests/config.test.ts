/**
 * Tests for config types and factory functions
 *
 * Covers: defaultConfig() schema validation, AgenhouseConfigSchema,
 *         createInMemoryStore factory.
 *
 * NOTE: createBlobStore/createDatabaseStore tests for sqlite/s3/postgres/turso
 * are omitted here because better-sqlite3 requires a native build that may not
 * be available in all environments. The factory error-path tests are tested
 * via the types instead.
 */

import { describe, it, expect } from 'vitest';
import { defaultConfig, AgenhouseConfigSchema } from '../src/types/config.js';
import { createInMemoryStore } from '../src/storage/factory.js';
import { InMemoryDatabaseStore } from '../src/storage/database/memory.js';

describe('defaultConfig', () => {
  it('returns a valid config with all defaults applied', () => {
    const config = defaultConfig();
    expect(config.storage.blob.type).toBe('flatfile');
    expect(config.storage.database.type).toBe('sqlite');
    expect(config.embedder.type).toBe('mock');
    expect(config.chunking.maxTokensPerChunk).toBe(1000);
    expect(config.query.semanticWeight).toBe(0.7);
  });
});

describe('AgenhouseConfigSchema', () => {
  // ── Valid configs (providing required storage field) ────────────────────────

  const validStorageInput = {
    storage: {
      blob: { type: 'flatfile', path: '~/.agenthouse/blobs' },
      database: { type: 'sqlite', path: '~/.agenthouse/warehouse.db' },
    },
  };

  it('parses a complete config with all fields provided', () => {
    const config = AgenhouseConfigSchema.parse(validStorageInput);
    expect(config.storage.blob.type).toBe('flatfile');
    expect(config.storage.database.type).toBe('sqlite');
    expect(config.embedder.type).toBe('mock'); // defaults applied
    expect(config.chunking.maxTokensPerChunk).toBe(1000);
    expect(config.query.semanticWeight).toBe(0.7);
  });

  it('applies embedder default (mock with 768 dimensions)', () => {
    const config = AgenhouseConfigSchema.parse(validStorageInput);
    expect(config.embedder.type).toBe('mock');
    if (config.embedder.type === 'mock') {
      expect(config.embedder.dimensions).toBe(768);
    }
  });

  it('applies chunking defaults', () => {
    const config = AgenhouseConfigSchema.parse(validStorageInput);
    expect(config.chunking.maxTokensPerChunk).toBe(1000);
    expect(config.chunking.overlapTokens).toBe(100);
  });

  it('applies query defaults', () => {
    const config = AgenhouseConfigSchema.parse(validStorageInput);
    expect(config.query.defaultLimit).toBe(5);
    expect(config.query.semanticWeight).toBe(0.7);
    expect(config.query.fulltextWeight).toBe(0.3);
  });

  it('accepts a custom mock embedder config', () => {
    const config = AgenhouseConfigSchema.parse({
      ...validStorageInput,
      embedder: { type: 'mock', dimensions: 256 },
    });
    expect(config.embedder.type).toBe('mock');
    if (config.embedder.type === 'mock') {
      expect(config.embedder.dimensions).toBe(256);
    }
  });

  it('accepts a custom query config', () => {
    const config = AgenhouseConfigSchema.parse({
      ...validStorageInput,
      query: { semanticWeight: 0.5, fulltextWeight: 0.5, defaultLimit: 10 },
    });
    expect(config.query.semanticWeight).toBe(0.5);
    expect(config.query.fulltextWeight).toBe(0.5);
    expect(config.query.defaultLimit).toBe(10);
  });

  it('accepts a voyage embedder config', () => {
    const config = AgenhouseConfigSchema.parse({
      ...validStorageInput,
      embedder: { type: 'voyage', model: 'voyage-2', apiKey: 'key-123' },
    });
    expect(config.embedder.type).toBe('voyage');
  });

  it('accepts an ollama embedder config', () => {
    const config = AgenhouseConfigSchema.parse({
      ...validStorageInput,
      embedder: { type: 'ollama', model: 'nomic-embed-text', baseUrl: 'http://localhost:11434' },
    });
    expect(config.embedder.type).toBe('ollama');
  });

  it('accepts an S3 blob config', () => {
    const config = AgenhouseConfigSchema.parse({
      storage: {
        blob: { type: 's3', bucket: 'my-bucket', region: 'us-west-2', prefix: '' },
        database: validStorageInput.storage.database,
      },
    });
    expect(config.storage.blob.type).toBe('s3');
  });

  // ── Validation errors ─────────────────────────────────────────────────────

  it('rejects an unknown embedder type', () => {
    expect(() =>
      AgenhouseConfigSchema.parse({
        ...validStorageInput,
        embedder: { type: 'unknown_embedder' },
      })
    ).toThrow();
  });

  it('rejects semanticWeight above 1', () => {
    expect(() =>
      AgenhouseConfigSchema.parse({
        ...validStorageInput,
        query: { semanticWeight: 1.5, fulltextWeight: 0.3, defaultLimit: 5 },
      })
    ).toThrow();
  });

  it('rejects fulltextWeight below 0', () => {
    expect(() =>
      AgenhouseConfigSchema.parse({
        ...validStorageInput,
        query: { semanticWeight: 0.7, fulltextWeight: -0.1, defaultLimit: 5 },
      })
    ).toThrow();
  });

  it('rejects an unknown database type', () => {
    expect(() =>
      AgenhouseConfigSchema.parse({
        storage: {
          blob: { type: 'flatfile', path: '~/.agenthouse/blobs' },
          database: { type: 'cassandra', connectionString: 'cassandra://localhost' },
        },
      })
    ).toThrow();
  });
});

// ── Storage factories (memory store only — SQLite requires native binary) ────

describe('createInMemoryStore', () => {
  it('returns an InMemoryDatabaseStore', () => {
    const store = createInMemoryStore();
    expect(store).toBeInstanceOf(InMemoryDatabaseStore);
  });

  it('is functional: initialize + getStats', async () => {
    const store = createInMemoryStore();
    await store.initialize();
    const stats = await store.getStats();
    expect(stats.totalSessions).toBe(0);
    expect(stats.totalChunks).toBe(0);
    expect(stats.totalUsers).toBe(0);
    await store.close();
  });

  it('can store and retrieve a session', async () => {
    const store = createInMemoryStore();
    await store.initialize();
    const session = {
      sessionId: '00000000-0000-0000-0000-000000000001',
      userId: 'test-user',
      agentType: 'generic' as const,
      startedAt: '2026-01-01T00:00:00.000Z',
      messages: [],
      metadata: { tags: [] },
    };
    await store.upsertSession(session);
    const retrieved = await store.getSession(session.sessionId);
    expect(retrieved?.userId).toBe('test-user');
  });
});
