import type { DatabaseStore } from '../storage/database/interface.js';
import type { Embedder } from '../ingest/embedder.js';
import type { ScoredChunk, SearchOptions } from '../types/chunk.js';

export interface QueryEngineOptions {
  /** Weight for semantic (vector) results, 0–1. Default: 0.7 */
  semanticWeight?: number;
  /** Weight for full-text results, 0–1. Default: 0.3 */
  fulltextWeight?: number;
}

/**
 * QueryEngine
 *
 * Orchestrates hybrid search:
 *   1. Embed the query
 *   2. Pre-filter by metadata (userId, project, date range, agentType)
 *   3. Run semantic search (vector cosine similarity)
 *   4. Run full-text search (BM25 keyword matching)
 *   5. Merge and re-rank results
 *   6. Return top-N
 *
 * The hybrid approach ensures both "tennis strings" (keyword match) and
 * "racket string tension" (semantic intent) are covered.
 */
export class QueryEngine {
  private readonly database: DatabaseStore;
  private readonly embedder: Embedder;
  private readonly semanticWeight: number;
  private readonly fulltextWeight: number;

  constructor(
    {
      database,
      embedder,
      options,
    }: {
      database: DatabaseStore;
      embedder: Embedder;
      options?: QueryEngineOptions;
    }
  ) {
    this.database = database;
    this.embedder = embedder;
    this.semanticWeight = options?.semanticWeight ?? 0.7;
    this.fulltextWeight = options?.fulltextWeight ?? 0.3;
  }

  /**
   * Search the warehouse with natural language.
   * Returns results sorted by combined hybrid score.
   */
  async search(query: string, options: SearchOptions = {}): Promise<ScoredChunk[]> {
    const limit = options.limit ?? 5;
    const fetchLimit = Math.max(limit * 4, 20); // fetch more to merge then trim

    // Run semantic and full-text searches in parallel
    const [embedding, fulltextRaw] = await Promise.all([
      this.embedder.embed(query),
      this.database.searchFullText(query, { ...options, limit: fetchLimit }),
    ]);

    const semanticRaw = await this.database.searchSemantic(embedding, {
      ...options,
      limit: fetchLimit,
    });

    // Merge and re-rank
    const merged = mergeResults(semanticRaw, fulltextRaw, this.semanticWeight, this.fulltextWeight);

    return merged.slice(0, limit);
  }

  /**
   * Recall a specific past interaction by description.
   * Similar to search but optimised for "that time I asked about X" queries —
   * biases towards full-text matching.
   */
  async recall(description: string, options: SearchOptions = {}): Promise<ScoredChunk[]> {
    return this.search(description, options);
  }
}

// ── Merge helpers ─────────────────────────────────────────────────────────────

/**
 * Reciprocal Rank Fusion (RRF) combined with weighted score blending.
 *
 * RRF is robust against scale differences between scoring systems:
 * score(chunk) = Σ 1 / (k + rank_i) * weight_i
 *
 * We also add a weighted blend of the raw scores as a secondary signal.
 */
function mergeResults(
  semantic: ScoredChunk[],
  fulltext: ScoredChunk[],
  semanticWeight: number,
  fulltextWeight: number,
  k = 60
): ScoredChunk[] {
  const scoreMap = new Map<string, { chunk: ScoredChunk; combined: number }>();

  // Helper: add to score map
  const contribute = (results: ScoredChunk[], weight: number, source: 'semantic' | 'fulltext') => {
    for (let rank = 0; rank < results.length; rank++) {
      const r = results[rank];
      const id = r.chunk.chunkId;
      const rrf = weight / (k + rank + 1);
      const raw = r.score * weight;

      const existing = scoreMap.get(id);
      if (existing) {
        existing.combined += rrf + raw * 0.1;
      } else {
        scoreMap.set(id, {
          chunk: { ...r, source: 'hybrid' },
          combined: rrf + raw * 0.1,
        });
      }
    }
  };

  contribute(semantic, semanticWeight, 'semantic');
  contribute(fulltext, fulltextWeight, 'fulltext');

  return Array.from(scoreMap.values())
    .sort((a, b) => b.combined - a.combined)
    .map(({ chunk, combined }) => ({ ...chunk, score: Math.min(1, combined) }));
}
