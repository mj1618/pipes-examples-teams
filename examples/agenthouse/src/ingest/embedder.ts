/**
 * Embedder interface + implementations.
 *
 * Implementations:
 *  - MockEmbedder      — deterministic random vectors (tests / offline dev)
 *  - OllamaEmbedder    — local embeddings via Ollama (nomic-embed-text)
 *  - VoyageEmbedder    — Voyage AI API (production quality)
 */

// ── Interface ─────────────────────────────────────────────────────────────────

export interface Embedder {
  /** Embed a single string and return a float vector */
  embed(text: string): Promise<number[]>;

  /** Embed a batch of strings (may be more efficient for some backends) */
  embedBatch(texts: string[]): Promise<number[][]>;

  /** Dimensionality of the embedding vectors */
  readonly dimensions: number;
}

// ── Mock embedder ─────────────────────────────────────────────────────────────

/**
 * Deterministic mock embedder for tests and offline development.
 *
 * Generates vectors based on a simple hash of the text so that similar
 * strings produce similar (though not semantically meaningful) vectors.
 */
export class MockEmbedder implements Embedder {
  readonly dimensions: number;

  constructor(dimensions = 768) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    return this.deterministicVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.deterministicVector(t));
  }

  private deterministicVector(text: string): number[] {
    // Simple hash to seed a pseudo-random vector
    let seed = 0;
    for (let i = 0; i < text.length; i++) {
      seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
    }

    const vec: number[] = [];
    let s = seed;
    for (let i = 0; i < this.dimensions; i++) {
      s = ((s * 1664525) + 1013904223) >>> 0;
      vec.push((s / 0xffffffff) * 2 - 1);
    }

    return normalize(vec);
  }
}

// ── Ollama embedder ───────────────────────────────────────────────────────────

/**
 * Ollama embedder — calls the Ollama local inference server.
 *
 * Requires: `ollama pull nomic-embed-text` and `ollama serve` running locally.
 *
 * Model: nomic-embed-text (768-dimensional, Apache-2.0 licensed)
 */
export class OllamaEmbedder implements Embedder {
  readonly dimensions = 768;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(
    model = 'nomic-embed-text',
    baseUrl = 'http://localhost:11434'
  ) {
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama embed failed: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as { embedding: number[] };
    return data.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Ollama doesn't have a native batch endpoint; call sequentially
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
}

// ── Voyage embedder ───────────────────────────────────────────────────────────

/**
 * Voyage AI embedder — calls the Voyage API.
 *
 * Requires: `VOYAGE_API_KEY` env var or explicit apiKey.
 * Model: voyage-2 (1024-dimensional)
 */
export class VoyageEmbedder implements Embedder {
  readonly dimensions = 1024;
  private readonly model: string;
  private readonly apiKey: string;

  constructor(
    apiKey: string = process.env.VOYAGE_API_KEY ?? '',
    model = 'voyage-2'
  ) {
    if (!apiKey) throw new Error('VoyageEmbedder: apiKey is required (or set VOYAGE_API_KEY)');
    this.apiKey = apiKey;
    this.model = model;
  }

  async embed(text: string): Promise<number[]> {
    const [embedding] = await this.embedBatch([text]);
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ input: texts, model: this.model }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Voyage embed failed: ${response.status} — ${body}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Return in input order
    return data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

import type { EmbedderConfig } from '../types/config.js';

export function createEmbedder(config: EmbedderConfig): Embedder {
  switch (config.type) {
    case 'mock':
      return new MockEmbedder(config.dimensions);
    case 'ollama':
      return new OllamaEmbedder(config.model, config.baseUrl);
    case 'voyage':
      return new VoyageEmbedder(config.apiKey, config.model);
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unknown embedder type: ${(_exhaustive as { type: string }).type}`);
    }
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? vec : vec.map((v) => v / norm);
}
