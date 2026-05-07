/**
 * Agenthouse — public API surface
 *
 * Import from here in application code and tests.
 * Only exports stable, tested interfaces.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type { Session, Message, ToolCall, AgentType, SessionSummary, SessionFilters } from './types/session.js';
export type { Chunk, ScoredChunk, SearchOptions, WarehouseStats } from './types/chunk.js';
export type { AgenhouseConfig, BlobConfig, DatabaseConfig, EmbedderConfig } from './types/config.js';
export { AgenhouseConfigSchema, defaultConfig } from './types/config.js';

// ── Storage ───────────────────────────────────────────────────────────────────

export type { BlobStore } from './storage/blob/interface.js';
export type { DatabaseStore } from './storage/database/interface.js';
export { FlatFileBlobStore } from './storage/blob/flatfile.js';
export { SQLiteDatabaseStore } from './storage/database/sqlite.js';
export { InMemoryDatabaseStore } from './storage/database/memory.js';
export { createBlobStore, createDatabaseStore, createInMemoryStore } from './storage/factory.js';

// ── Ingest ────────────────────────────────────────────────────────────────────

export type { Embedder } from './ingest/embedder.js';
export { MockEmbedder, OllamaEmbedder, VoyageEmbedder, createEmbedder } from './ingest/embedder.js';
export { chunkSession } from './ingest/chunker.js';
export type { ChunkerOptions } from './ingest/chunker.js';
export { IngestPipeline } from './ingest/pipeline.js';
export type { PipelineOptions, IngestResult } from './ingest/pipeline.js';

// ── CLI parsers ───────────────────────────────────────────────────────────────

export type { Parser } from './cli/parsers/parser.js';
export { ClaudeCodeParser } from './cli/parsers/claude-code.js';
export { GenericParser } from './cli/parsers/generic.js';

// ── Sync ──────────────────────────────────────────────────────────────────────

export { syncPath } from './cli/sync.js';
export type { SyncOptions, SyncResult } from './cli/sync.js';

// ── Query ─────────────────────────────────────────────────────────────────────

export { QueryEngine } from './query/engine.js';
export type { QueryEngineOptions } from './query/engine.js';

// ── MCP ───────────────────────────────────────────────────────────────────────

export { createMCPServer, startMCPStdioServer } from './mcp/server.js';
export type { MCPServer, MCPServerConfig } from './mcp/server.js';
export { TOOL_DEFINITIONS, createToolHandlers } from './mcp/tools.js';
export type { ToolHandlers, ToolResponse } from './mcp/tools.js';

// ── Convenience factory ───────────────────────────────────────────────────────

import { defaultConfig, type AgenhouseConfig } from './types/config.js';
import { createBlobStore, createDatabaseStore } from './storage/factory.js';
import { createEmbedder } from './ingest/embedder.js';
import { IngestPipeline } from './ingest/pipeline.js';
import { QueryEngine } from './query/engine.js';
import { createMCPServer, type MCPServer } from './mcp/server.js';
import type { DatabaseStore } from './storage/database/interface.js';
import type { BlobStore } from './storage/blob/interface.js';

export interface AgenhouseInstance {
  blob: BlobStore;
  database: DatabaseStore;
  pipeline: IngestPipeline;
  queryEngine: QueryEngine;
  mcpServer: MCPServer;
  /** Initialize stores (run migrations etc.) */
  initialize(): Promise<void>;
  /** Close all connections */
  close(): Promise<void>;
}

/**
 * Create a fully wired Agenthouse instance from config.
 *
 * ```ts
 * const ah = createAgenthouse();
 * await ah.initialize();
 *
 * // Ingest test fixtures
 * await syncPath('./tests/fixtures', ah.pipeline);
 *
 * // Query
 * const results = await ah.queryEngine.search('tennis strings');
 *
 * // Or use the MCP server
 * const response = await ah.mcpServer.handleRequest({ ... });
 *
 * await ah.close();
 * ```
 */
export function createAgenthouse(config: AgenhouseConfig = defaultConfig()): AgenhouseInstance {
  const blob = createBlobStore(config.storage.blob);
  const database = createDatabaseStore(config.storage.database);
  const embedder = createEmbedder(config.embedder);
  const pipeline = new IngestPipeline({ blob, database, embedder });
  const queryEngine = new QueryEngine({
    database,
    embedder,
    options: {
      semanticWeight: config.query.semanticWeight,
      fulltextWeight: config.query.fulltextWeight,
    },
  });
  const mcpServer = createMCPServer({ database, queryEngine });

  return {
    blob,
    database,
    pipeline,
    queryEngine,
    mcpServer,
    async initialize() {
      await database.initialize();
    },
    async close() {
      await database.close();
    },
  };
}
