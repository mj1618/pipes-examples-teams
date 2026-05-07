import type { DatabaseStore } from './interface.js';
import type { Chunk, ScoredChunk, SearchOptions, WarehouseStats } from '../../types/chunk.js';
import type { Session, SessionSummary, SessionFilters } from '../../types/session.js';

/**
 * InMemoryDatabaseStore
 *
 * Pure in-memory implementation — no external dependencies.
 * Useful for tests and lightweight scenarios.
 * Not persistent across process restarts.
 */
export class InMemoryDatabaseStore implements DatabaseStore {
  private sessions = new Map<string, Session>();
  private chunks = new Map<string, Chunk>();

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    // Nothing to set up
  }

  async close(): Promise<void> {
    // Nothing to close
  }

  // ── Chunk storage ───────────────────────────────────────────────────────────

  async insertChunks(chunks: Chunk[]): Promise<void> {
    for (const c of chunks) {
      this.chunks.set(c.chunkId, c);
    }
  }

  async getChunk(chunkId: string): Promise<Chunk | null> {
    return this.chunks.get(chunkId) ?? null;
  }

  async getChunksBySession(sessionId: string): Promise<Chunk[]> {
    return Array.from(this.chunks.values())
      .filter((c) => c.sessionId === sessionId)
      .sort((a, b) => a.turnIndex - b.turnIndex);
  }

  // ── Semantic search ─────────────────────────────────────────────────────────

  async searchSemantic(embedding: number[], options: SearchOptions = {}): Promise<ScoredChunk[]> {
    const limit = options.limit ?? 5;
    const candidates = Array.from(this.chunks.values()).filter((c) => {
      if (!c.embedding) return false;
      return matchesFilters(c, options);
    });

    return candidates
      .map((c) => ({
        chunk: c,
        score: cosineSimilarity(embedding, c.embedding!),
        source: 'semantic' as const,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // ── Full-text search ────────────────────────────────────────────────────────

  async searchFullText(query: string, options: SearchOptions = {}): Promise<ScoredChunk[]> {
    const limit = options.limit ?? 5;
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

    const candidates = Array.from(this.chunks.values()).filter((c) =>
      matchesFilters(c, options)
    );

    return candidates
      .map((c) => {
        const text = `${c.userMessage} ${c.assistantMessage}`.toLowerCase();
        const hits = terms.filter((t) => text.includes(t)).length;
        const score = hits / terms.length;
        return { chunk: c, score, source: 'fulltext' as const };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // ── Session metadata ────────────────────────────────────────────────────────

  async upsertSession(session: Session): Promise<void> {
    this.sessions.set(session.sessionId, session);
  }

  async listSessions(filters: SessionFilters = {}): Promise<SessionSummary[]> {
    let list = Array.from(this.sessions.values());

    if (filters.userId) list = list.filter((s) => s.userId === filters.userId);
    if (filters.project) list = list.filter((s) => s.project === filters.project);
    if (filters.agentType) list = list.filter((s) => s.agentType === filters.agentType);
    if (filters.after) list = list.filter((s) => new Date(s.startedAt) >= filters.after!);
    if (filters.before) list = list.filter((s) => new Date(s.startedAt) <= filters.before!);

    // Sort newest first
    list.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 20;

    return list.slice(offset, offset + limit).map((s) => ({
      sessionId: s.sessionId,
      userId: s.userId,
      agentType: s.agentType,
      project: s.project,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      messageCount: s.messages.length,
      tokenCount: s.metadata?.tokenCount,
      tags: s.metadata?.tags ?? [],
    }));
  }

  async getSession(sessionId: string): Promise<Session | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  // ── Housekeeping ────────────────────────────────────────────────────────────

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    for (const [id, chunk] of this.chunks) {
      if (chunk.sessionId === sessionId) this.chunks.delete(id);
    }
  }

  async getStats(): Promise<WarehouseStats> {
    const sessions = Array.from(this.sessions.values());
    const dates = sessions.map((s) => new Date(s.startedAt));

    return {
      totalChunks: this.chunks.size,
      totalSessions: this.sessions.size,
      totalUsers: new Set(sessions.map((s) => s.userId)).size,
      oldestEntry: dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : undefined,
      newestEntry: dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : undefined,
    };
  }

  /** Utility: clear all data (useful in tests) */
  clear(): void {
    this.sessions.clear();
    this.chunks.clear();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function matchesFilters(chunk: Chunk, options: SearchOptions): boolean {
  if (options.userId && chunk.userId !== options.userId) return false;
  if (options.project && chunk.project !== options.project) return false;
  if (options.agentType && chunk.agentType !== options.agentType) return false;
  if (options.after && chunk.timestamp && new Date(chunk.timestamp) < options.after) return false;
  if (options.before && chunk.timestamp && new Date(chunk.timestamp) > options.before) return false;
  return true;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
