/**
 * Tests for Embedder implementations
 *
 * Covers: MockEmbedder (happy path, determinism, dimensions),
 *         createEmbedder factory, VoyageEmbedder constructor guard.
 */

import { describe, it, expect } from 'vitest';
import { MockEmbedder, createEmbedder } from '../src/ingest/embedder.js';

describe('MockEmbedder', () => {
  it('creates an embedder with the default 768 dimensions', () => {
    const embedder = new MockEmbedder();
    expect(embedder.dimensions).toBe(768);
  });

  it('creates an embedder with custom dimensions', () => {
    const embedder = new MockEmbedder(128);
    expect(embedder.dimensions).toBe(128);
  });

  it('embed returns a vector of the correct length', async () => {
    const embedder = new MockEmbedder(64);
    const vec = await embedder.embed('hello world');
    expect(vec).toHaveLength(64);
  });

  it('embed returns a normalized vector (unit length ~1)', async () => {
    const embedder = new MockEmbedder(128);
    const vec = await embedder.embed('test input');
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('embed is deterministic — same text produces same vector', async () => {
    const embedder = new MockEmbedder();
    const v1 = await embedder.embed('deterministic text');
    const v2 = await embedder.embed('deterministic text');
    expect(v1).toEqual(v2);
  });

  it('embed produces different vectors for different texts', async () => {
    const embedder = new MockEmbedder();
    const v1 = await embedder.embed('apple');
    const v2 = await embedder.embed('orange');
    expect(v1).not.toEqual(v2);
  });

  it('embedBatch returns one vector per text', async () => {
    const embedder = new MockEmbedder(32);
    const texts = ['foo', 'bar', 'baz'];
    const vecs = await embedder.embedBatch(texts);
    expect(vecs).toHaveLength(texts.length);
    for (const v of vecs) {
      expect(v).toHaveLength(32);
    }
  });

  it('embedBatch is consistent with embed (each element matches)', async () => {
    const embedder = new MockEmbedder();
    const texts = ['hello', 'world'];
    const batch = await embedder.embedBatch(texts);
    for (let i = 0; i < texts.length; i++) {
      const single = await embedder.embed(texts[i]);
      expect(batch[i]).toEqual(single);
    }
  });

  it('embedBatch handles an empty array', async () => {
    const embedder = new MockEmbedder();
    const vecs = await embedder.embedBatch([]);
    expect(vecs).toEqual([]);
  });

  it('handles empty string input', async () => {
    const embedder = new MockEmbedder(16);
    const vec = await embedder.embed('');
    expect(vec).toHaveLength(16);
  });
});

describe('createEmbedder', () => {
  it('creates a MockEmbedder from mock config', () => {
    const embedder = createEmbedder({ type: 'mock', dimensions: 256 });
    expect(embedder).toBeInstanceOf(MockEmbedder);
    expect(embedder.dimensions).toBe(256);
  });

  it('throws for VoyageEmbedder when apiKey is missing', () => {
    expect(() =>
      createEmbedder({ type: 'voyage', model: 'voyage-2', apiKey: '' })
    ).toThrow('apiKey is required');
  });

  it('creates OllamaEmbedder from ollama config (no network call)', () => {
    // OllamaEmbedder has no constructor-time validation beyond defaults
    const embedder = createEmbedder({
      type: 'ollama',
      model: 'nomic-embed-text',
      baseUrl: 'http://localhost:11434',
    });
    expect(embedder.dimensions).toBe(768);
  });
});
