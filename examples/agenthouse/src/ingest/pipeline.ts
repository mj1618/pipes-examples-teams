import type { Session } from '../types/session.js';
import type { Chunk } from '../types/chunk.js';
import type { BlobStore } from '../storage/blob/interface.js';
import type { DatabaseStore } from '../storage/database/interface.js';
import type { Embedder } from './embedder.js';
import { chunkSession, type ChunkerOptions } from './chunker.js';

export interface PipelineOptions {
  /** Chunker configuration */
  chunker?: ChunkerOptions;
  /**
   * Batch size for embedding calls.
   * Larger batches are more efficient for API-backed embedders.
   * Default: 32
   */
  embeddingBatchSize?: number;
  /**
   * Whether to store the raw session in the blob store.
   * Default: true
   */
  storeBlob?: boolean;
}

export interface IngestResult {
  sessionId: string;
  chunksIngested: number;
  durationMs: number;
}

/**
 * IngestPipeline
 *
 * Orchestrates: Raw session → Parse → Chunk → Embed → Store
 *
 * Usage:
 * ```ts
 * const pipeline = new IngestPipeline({ blob, database, embedder });
 * const result = await pipeline.ingest(session);
 * ```
 */
export class IngestPipeline {
  private readonly blob: BlobStore;
  private readonly database: DatabaseStore;
  private readonly embedder: Embedder;

  constructor({
    blob,
    database,
    embedder,
  }: {
    blob: BlobStore;
    database: DatabaseStore;
    embedder: Embedder;
  }) {
    this.blob = blob;
    this.database = database;
    this.embedder = embedder;
  }

  /**
   * Ingest a single session through the full pipeline.
   */
  async ingest(session: Session, options: PipelineOptions = {}): Promise<IngestResult> {
    const { embeddingBatchSize = 32, storeBlob = true, chunker: chunkerOptions } = options;
    const start = Date.now();

    // 1. Store raw blob (idempotent by sessionId)
    if (storeBlob) {
      const blobKey = `sessions/${session.sessionId}.json`;
      const raw = Buffer.from(JSON.stringify(session));
      await this.blob.put(blobKey, raw);
    }

    // 2. Upsert session metadata
    await this.database.upsertSession(session);

    // 3. Chunk
    const chunks = chunkSession(session, chunkerOptions);
    if (chunks.length === 0) {
      return { sessionId: session.sessionId, chunksIngested: 0, durationMs: Date.now() - start };
    }

    // 4. Embed in batches
    const texts = chunks.map((c) => buildEmbeddingText(c));
    const embeddings = await this.embedBatch(texts, embeddingBatchSize);

    // Attach embeddings to chunks
    const embeddedChunks: Chunk[] = chunks.map((c, i) => ({
      ...c,
      embedding: embeddings[i],
    }));

    // 5. Store chunks
    await this.database.insertChunks(embeddedChunks);

    return {
      sessionId: session.sessionId,
      chunksIngested: embeddedChunks.length,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Ingest multiple sessions in sequence.
   * Logs progress to the provided callback.
   */
  async ingestMany(
    sessions: Session[],
    options: PipelineOptions = {},
    onProgress?: (done: number, total: number, result: IngestResult) => void
  ): Promise<IngestResult[]> {
    const results: IngestResult[] = [];
    for (let i = 0; i < sessions.length; i++) {
      const result = await this.ingest(sessions[i], options);
      results.push(result);
      onProgress?.(i + 1, sessions.length, result);
    }
    return results;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async embedBatch(texts: string[], batchSize: number): Promise<number[][]> {
    const all: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const embeddings = await this.embedder.embedBatch(batch);
      all.push(...embeddings);
    }

    return all;
  }
}

/**
 * Build the text that gets embedded for a chunk.
 * We embed both the user question and the assistant answer together
 * to maximise retrieval recall.
 */
function buildEmbeddingText(chunk: Chunk): string {
  return `${chunk.userMessage}\n\n${chunk.assistantMessage}`;
}
