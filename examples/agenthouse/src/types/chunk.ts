import { z } from 'zod';
import type { AgentType, ToolCall } from './session.js';

// ── Chunk ─────────────────────────────────────────────────────────────────────

export const ChunkSchema = z.object({
  chunkId: z.string().uuid(),
  sessionId: z.string().uuid(),
  userId: z.string(),
  project: z.string().optional(),
  agentType: z.string(),
  timestamp: z.string().datetime().optional(),
  turnIndex: z.number().int().nonnegative(),
  userMessage: z.string(),
  assistantMessage: z.string(),
  toolCalls: z
    .array(
      z.object({
        name: z.string(),
        input: z.record(z.unknown()).optional(),
        output: z.unknown().optional(),
      })
    )
    .optional()
    .default([]),
  embedding: z.array(z.number()).optional(),
  tokenCount: z.number().int().nonnegative().optional(),
});

export type Chunk = z.infer<typeof ChunkSchema>;

// ── Scored chunk (search result) ──────────────────────────────────────────────

export interface ScoredChunk {
  chunk: Chunk;
  /** Similarity score 0–1 (higher = more relevant) */
  score: number;
  /** Which search method contributed this result */
  source: 'semantic' | 'fulltext' | 'hybrid';
}

// ── Search options ────────────────────────────────────────────────────────────

export interface SearchOptions {
  limit?: number;
  userId?: string;
  project?: string;
  agentType?: AgentType;
  after?: Date;
  before?: Date;
}

// ── Warehouse stats ───────────────────────────────────────────────────────────

export interface WarehouseStats {
  totalChunks: number;
  totalSessions: number;
  totalUsers: number;
  oldestEntry?: Date;
  newestEntry?: Date;
  storageSizeBytes?: number;
}
