import type { Chunk, ScoredChunk, SearchOptions, WarehouseStats } from '../../types/chunk.js';
import type { Session, SessionSummary, SessionFilters } from '../../types/session.js';

/**
 * DatabaseStore interface — stores structured chunks, embeddings, and session metadata.
 *
 * Implementations: SQLiteDatabaseStore, PostgresDatabaseStore
 */
export interface DatabaseStore {
  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /** Initialise tables / run migrations. Call once before first use. */
  initialize(): Promise<void>;

  /** Close the underlying connection */
  close(): Promise<void>;

  // ── Chunk storage ───────────────────────────────────────────────────────────

  /** Upsert a batch of chunks (idempotent by chunkId) */
  insertChunks(chunks: Chunk[]): Promise<void>;

  /** Fetch a single chunk by ID */
  getChunk(chunkId: string): Promise<Chunk | null>;

  /** Fetch all chunks belonging to a session */
  getChunksBySession(sessionId: string): Promise<Chunk[]>;

  // ── Semantic search ─────────────────────────────────────────────────────────

  /**
   * Vector similarity search.
   * Returns at most options.limit chunks sorted by descending cosine similarity.
   */
  searchSemantic(embedding: number[], options?: SearchOptions): Promise<ScoredChunk[]>;

  // ── Full-text search ────────────────────────────────────────────────────────

  /**
   * BM25 / keyword full-text search.
   */
  searchFullText(query: string, options?: SearchOptions): Promise<ScoredChunk[]>;

  // ── Session metadata ────────────────────────────────────────────────────────

  /** Upsert session metadata (idempotent by sessionId) */
  upsertSession(session: Session): Promise<void>;

  /** List sessions matching filters */
  listSessions(filters?: SessionFilters): Promise<SessionSummary[]>;

  /** Fetch a full session with all messages */
  getSession(sessionId: string): Promise<Session | null>;

  // ── Housekeeping ────────────────────────────────────────────────────────────

  /** Delete a session and all its chunks */
  deleteSession(sessionId: string): Promise<void>;

  /** Aggregate stats about the warehouse */
  getStats(): Promise<WarehouseStats>;
}
