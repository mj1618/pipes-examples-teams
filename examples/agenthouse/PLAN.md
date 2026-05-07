# Agenthouse

A data warehouse for agent context windows. Store every conversation, every tool call, every reasoning trace from every agent in your organisation — then query it all with semantic search.

> **⚠️ Testing & Privacy Policy**
>
> This project is in early development and hosted on Pipez. **Do NOT sync real context windows into the warehouse** — context windows can contain sensitive information (API keys, credentials, private conversations, proprietary code).
>
> For testing, use **only**:
> - **Synthetic test data** — generated fixtures with fake conversations (see `tests/fixtures/`)
> - **The current agent's own context window** — the agent actively working on Agenthouse may ingest its own session for dogfooding/integration testing
>
> Real user context windows should only be ingested once the project has proper auth, access controls, and data handling policies in place (Phase 3+).

## The Problem

Organisations running AI agents accumulate enormous volumes of context — conversation histories, tool calls, reasoning traces, code diffs, error logs — spread across individual machines and sessions. This context is ephemeral: when a session ends, the knowledge dies. There's no way to ask "what did I ask my agent that time about tennis strings?" across weeks of history, across teammates, across projects.

## What Agenthouse Does

Agenthouse is a warehouse that:

1. **Ingests** context windows from agent sessions (Claude Code, Cursor, Copilot, etc.)
2. **Indexes** them for semantic search — not just keyword matching, but meaning-based retrieval
3. **Serves** queries via an MCP server so any agent can search the warehouse naturally
4. **Scales** from a single developer's laptop to an organisation's full history

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Developer Machines                       │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                      │
│  │ Claude   │  │ Cursor   │  │ Copilot  │  ...                  │
│  │ Code     │  │          │  │          │                       │
│  │ sessions │  │ sessions │  │ sessions │                       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                      │
│       └──────────────┼──────────────┘                            │
│                      ▼                                          │
│              ┌───────────────┐                                  │
│              │  Sync Client  │   `agenthouse sync`              │
│              │  (CLI tool)   │   watches & pushes sessions      │
│              └───────┬───────┘                                  │
└──────────────────────┼──────────────────────────────────────────┘
                       │ HTTP / file copy
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Agenthouse Core                             │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────────┐  │
│  │   Ingest     │    │   Index      │    │   Query Engine    │  │
│  │   Pipeline   │───▶│   Store      │◀───│                   │  │
│  │              │    │              │    │   semantic search  │  │
│  │  parse       │    │  embeddings  │    │   filters         │  │
│  │  chunk       │    │  metadata    │    │   ranking         │  │
│  │  embed       │    │  full text   │    │   summarisation   │  │
│  └──────┬───────┘    └──────┬───────┘    └────────┬──────────┘  │
│         │                   │                     │              │
│         ▼                   ▼                     ▲              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  Storage Layer (pluggable)               │    │
│  │                                                         │    │
│  │  ┌─────────────┐          ┌──────────────────┐          │    │
│  │  │ BlobStore   │          │  DatabaseStore   │          │    │
│  │  │ (interface) │          │  (interface)     │          │    │
│  │  ├─────────────┤          ├──────────────────┤          │    │
│  │  │ FlatFile    │          │  SQLite          │          │    │
│  │  │ S3          │          │  Postgres        │          │    │
│  │  │ GCS         │          │  Turso           │          │    │
│  │  └─────────────┘          └──────────────────┘          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                  MCP Server                              │   │
│  │                                                          │   │
│  │  Tools:                                                  │   │
│  │    agenthouse_search  — semantic query across all data   │   │
│  │    agenthouse_recall  — find a specific past interaction │   │
│  │    agenthouse_list    — browse sessions/agents/users     │   │
│  │    agenthouse_context — pull full context for a session  │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Sync Client

A CLI tool that runs on each developer's machine. It watches for completed agent sessions and pushes them to Agenthouse.

```bash
# Sync generated test fixtures (safe for testing on Pipez)
agenthouse sync ./tests/fixtures/

# Sync the current agent's own context window (dogfooding)
agenthouse sync --self

# One-time sync of all historical sessions (⚠️ FUTURE — not for use yet)
# agenthouse sync --all

# Daemon mode (⚠️ FUTURE — not for use yet)
# agenthouse sync --watch
```

> **⚠️ For now**: only use `sync` with test fixtures or `--self` (current agent's session). Do not point it at `~/.claude/projects/` or any real session history. Real context windows contain sensitive data and should not be synced until auth and access controls exist.

**What it will eventually sync:**
- Claude Code: `~/.claude/projects/` conversation histories
- Cursor: session logs from workspace storage
- Generic: any JSONL file with `role`/`content` message pairs

**Session envelope format** (what gets sent to the warehouse):
```json
{
  "sessionId": "uuid",
  "userId": "matt",
  "agentType": "claude-code",
  "project": "/Users/matt/code/myapp",
  "startedAt": "2026-05-05T10:00:00Z",
  "endedAt": "2026-05-05T10:45:00Z",
  "messages": [
    {
      "role": "user",
      "content": "what's a good tension for tennis strings?",
      "timestamp": "2026-05-05T10:12:00Z",
      "toolCalls": []
    },
    {
      "role": "assistant",
      "content": "For tennis strings, tension typically ranges...",
      "timestamp": "2026-05-05T10:12:05Z",
      "toolCalls": [{"name": "WebSearch", "input": {...}}]
    }
  ],
  "metadata": {
    "model": "claude-sonnet-4",
    "tokenCount": 12450,
    "tags": []
  }
}
```

### 2. Ingest Pipeline

Processes raw sessions into searchable chunks.

**Pipeline stages:**

```
Raw session → Parse → Chunk → Embed → Store
```

1. **Parse**: Normalise different agent formats (Claude Code JSONL, Cursor JSON, etc.) into the common session envelope
2. **Chunk**: Break conversations into searchable units. Chunking strategy:
   - Each user→assistant turn pair = 1 chunk (the atomic unit of "a question and its answer")
   - Long assistant responses get sub-chunked at ~1000 token boundaries with overlap
   - Tool calls and their results are kept attached to the parent message
   - Metadata (user, project, timestamp, agent type) attached to every chunk
3. **Embed**: Generate vector embeddings for each chunk. Start with a local model (e.g. `nomic-embed-text` via Ollama) for zero-cost development; swap to API-based (Voyage, OpenAI) for production
4. **Store**: Write chunks + embeddings + metadata to the storage layer

**Chunk schema:**
```json
{
  "chunkId": "uuid",
  "sessionId": "uuid",
  "userId": "matt",
  "project": "/Users/matt/code/myapp",
  "agentType": "claude-code",
  "timestamp": "2026-05-05T10:12:00Z",
  "turnIndex": 3,
  "userMessage": "what's a good tension for tennis strings?",
  "assistantMessage": "For tennis strings, tension typically...",
  "toolCalls": [...],
  "embedding": [0.012, -0.034, ...],
  "tokenCount": 580
}
```

### 3. Storage Layer (Pluggable)

Two interfaces that can be swapped independently.

#### BlobStore — raw session files

Stores the original session files verbatim for replay/audit.

```typescript
interface BlobStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  list(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
```

**Implementations:**
| Implementation | When to use |
|---|---|
| `FlatFileBlobStore` | Local dev, single machine. Stores under `~/.agenthouse/blobs/` |
| `S3BlobStore` | Production, multi-user. Any S3-compatible store (AWS, R2, MinIO) |

#### DatabaseStore — structured data + embeddings

Stores chunks, metadata, and embeddings for querying.

```typescript
interface DatabaseStore {
  // Chunk storage
  insertChunks(chunks: Chunk[]): Promise<void>;
  getChunk(chunkId: string): Promise<Chunk | null>;

  // Semantic search — vector similarity
  searchSemantic(embedding: number[], options: {
    limit: number;
    userId?: string;
    project?: string;
    agentType?: string;
    after?: Date;
    before?: Date;
  }): Promise<ScoredChunk[]>;

  // Full-text search — keyword fallback
  searchFullText(query: string, options: SearchOptions): Promise<ScoredChunk[]>;

  // Session metadata
  listSessions(filters: SessionFilters): Promise<SessionSummary[]>;
  getSession(sessionId: string): Promise<Session>;

  // Housekeeping
  deleteSession(sessionId: string): Promise<void>;
  getStats(): Promise<WarehouseStats>;
}
```

**Implementations:**
| Implementation | When to use |
|---|---|
| `SQLiteDatabaseStore` | Local dev, single machine. Uses `better-sqlite3` with `sqlite-vec` for vector search |
| `PostgresDatabaseStore` | Production. Uses `pgvector` extension for vector search |
| `TursoDatabaseStore` | Edge/distributed. libSQL with vector support |

#### Storage config:

```json
{
  "storage": {
    "blob": {
      "type": "flatfile",
      "path": "~/.agenthouse/blobs"
    },
    "database": {
      "type": "sqlite",
      "path": "~/.agenthouse/warehouse.db"
    }
  }
}
```

Swapping to S3 + Postgres later:
```json
{
  "storage": {
    "blob": {
      "type": "s3",
      "bucket": "agenthouse-prod",
      "region": "us-east-1"
    },
    "database": {
      "type": "postgres",
      "connectionString": "postgresql://..."
    }
  }
}
```

### 4. Query Engine

The brain that turns natural language questions into efficient warehouse lookups.

**Query flow:**
```
"what did I ask about tennis strings?"
    │
    ▼
┌─────────────────────────┐
│ 1. Embed the query      │  → [0.023, -0.017, ...]
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ 2. Pre-filter            │  user=matt, last 90 days
│    (metadata narrowing)  │  reduces search space
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ 3. Vector search         │  top-50 by cosine similarity
│    (approximate)         │  against pre-filtered set
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ 4. Re-rank               │  cross-encoder or LLM re-rank
│    (optional, precise)   │  top-50 → top-5
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ 5. Format results        │  return chunks with context
│    (summarise if needed) │  session links, timestamps
└─────────────────────────┘
```

**Efficiency at scale** — the warehouse could grow to millions of chunks. Strategies:

1. **Metadata pre-filtering**: Always narrow by user, date range, project, agent type BEFORE running vector search. This turns a full-table scan into a small partition scan.
2. **Tiered storage**: Recent chunks (last 30 days) in hot SQLite/Postgres. Older chunks in cold storage with a summary index — search summaries first, load full chunks on demand.
3. **Approximate nearest neighbours**: SQLite-vec uses IVF indexing. Postgres pgvector uses HNSW. Both are sub-linear at scale.
4. **Hybrid search**: Combine vector similarity with BM25 full-text search. Some queries are better served by keywords ("tennis strings") than by embeddings.
5. **Chunk deduplication**: If the same context window is synced twice, dedup by content hash.

### 5. MCP Server

An MCP (Model Context Protocol) server that any agent can connect to and query the warehouse.

**Tools exposed:**

#### `agenthouse_search`
Semantic search across all context windows.
```json
{
  "name": "agenthouse_search",
  "description": "Search across all agent context windows using natural language. Returns the most relevant past conversations, tool calls, and reasoning traces.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Natural language search query" },
      "userId": { "type": "string", "description": "Filter to a specific user" },
      "project": { "type": "string", "description": "Filter to a specific project path" },
      "agentType": { "type": "string", "enum": ["claude-code", "cursor", "copilot"] },
      "after": { "type": "string", "description": "ISO date — only results after this date" },
      "before": { "type": "string", "description": "ISO date — only results before this date" },
      "limit": { "type": "number", "default": 5 }
    },
    "required": ["query"]
  }
}
```

#### `agenthouse_recall`
Find a specific past interaction — optimised for "that time I asked about X" queries.
```json
{
  "name": "agenthouse_recall",
  "description": "Recall a specific past conversation. More targeted than search — use when the user says 'that time I asked about...' or 'remember when we discussed...'",
  "inputSchema": {
    "type": "object",
    "properties": {
      "description": { "type": "string", "description": "Description of the interaction to find" },
      "userId": { "type": "string" },
      "approximate_date": { "type": "string", "description": "Rough date if known (e.g. 'last week', '2026-04')" }
    },
    "required": ["description"]
  }
}
```

#### `agenthouse_list`
Browse the warehouse — sessions, users, projects.
```json
{
  "name": "agenthouse_list",
  "description": "List sessions, users, or projects in the warehouse. Use for browsing rather than searching.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "entity": { "type": "string", "enum": ["sessions", "users", "projects"] },
      "userId": { "type": "string" },
      "project": { "type": "string" },
      "limit": { "type": "number", "default": 20 },
      "offset": { "type": "number", "default": 0 }
    },
    "required": ["entity"]
  }
}
```

#### `agenthouse_context`
Pull the full context window for a specific session.
```json
{
  "name": "agenthouse_context",
  "description": "Retrieve the full context window for a specific session. Use after search/recall to get complete details.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "sessionId": { "type": "string" }
    },
    "required": ["sessionId"]
  }
}
```

## Project Structure

```
agenthouse/
├── src/
│   ├── cli/                      # Sync client CLI
│   │   ├── index.ts              # CLI entry point (commander)
│   │   ├── sync.ts               # Sync command — watch & push sessions
│   │   └── parsers/              # Agent-specific session parsers
│   │       ├── parser.ts         # Parser interface
│   │       ├── claude-code.ts    # Claude Code JSONL parser
│   │       ├── cursor.ts         # Cursor session parser
│   │       └── generic.ts        # Generic JSONL fallback
│   │
│   ├── ingest/                   # Ingest pipeline
│   │   ├── pipeline.ts           # Orchestrates parse → chunk → embed → store
│   │   ├── chunker.ts            # Turn-pair chunking with overlap
│   │   └── embedder.ts           # Embedding interface + implementations
│   │       ├── embedder.ts       # Interface
│   │       ├── ollama.ts         # Local via Ollama (dev)
│   │       └── voyage.ts         # Voyage AI API (production)
│   │
│   ├── storage/                  # Pluggable storage layer
│   │   ├── blob/
│   │   │   ├── interface.ts      # BlobStore interface
│   │   │   ├── flatfile.ts       # Local filesystem implementation
│   │   │   └── s3.ts             # S3-compatible implementation
│   │   ├── database/
│   │   │   ├── interface.ts      # DatabaseStore interface
│   │   │   ├── sqlite.ts         # SQLite + sqlite-vec
│   │   │   └── postgres.ts       # Postgres + pgvector
│   │   └── factory.ts            # Creates stores from config
│   │
│   ├── query/                    # Query engine
│   │   ├── engine.ts             # Query orchestration
│   │   ├── hybrid.ts             # Hybrid vector + full-text search
│   │   └── reranker.ts           # Result re-ranking
│   │
│   ├── mcp/                      # MCP server
│   │   ├── server.ts             # MCP server setup
│   │   └── tools.ts              # Tool definitions + handlers
│   │
│   ├── types/                    # Shared types
│   │   ├── session.ts            # Session, Message, ToolCall
│   │   ├── chunk.ts              # Chunk, ScoredChunk
│   │   └── config.ts             # Config schema (Zod)
│   │
│   └── index.ts                  # Public API
│
├── tests/
│   ├── fixtures/                 # Synthetic test data (ONLY use these for testing)
│   │   ├── session-tennis.jsonl  # Fake session about tennis strings
│   │   ├── session-api.jsonl     # Fake session about building an API
│   │   ├── session-debug.jsonl   # Fake session about debugging
│   │   └── generate.ts           # Script to generate more test fixtures
│   ├── ingest.test.ts
│   ├── storage.test.ts
│   ├── query.test.ts
│   └── mcp.test.ts
│
├── package.json
├── tsconfig.json
└── agenthouse.config.json        # Default config
```

## Implementation Plan

### Phase 1: Foundation (store + ingest + query locally)

Build the core pipeline for a single user on one machine.

1. **Types & schemas** — define Session, Chunk, Config with Zod
2. **BlobStore (flatfile)** — store raw sessions to `~/.agenthouse/blobs/`
3. **DatabaseStore (SQLite)** — chunks + embeddings in SQLite with `sqlite-vec`
4. **Claude Code parser** — parse `~/.claude/projects/` session files
5. **Chunker** — turn-pair chunking with metadata attachment
6. **Embedder (Ollama)** — local embeddings via `nomic-embed-text`
7. **Ingest pipeline** — wire parse → chunk → embed → store
8. **Query engine** — semantic search with metadata pre-filtering
9. **CLI: `agenthouse sync`** — one-shot and watch mode

**Data policy**: Use only synthetic test fixtures and/or the working agent's own context window. No real user sessions.

**Milestone**: `agenthouse sync ./tests/fixtures/ && agenthouse query "tennis strings"` works locally against test data.

### Phase 2: MCP Server

Make the warehouse queryable by agents.

1. **MCP server** — expose search/recall/list/context tools
2. **Hybrid search** — combine vector similarity + BM25 full-text
3. **Result formatting** — return concise, useful excerpts (not raw chunks)
4. **Claude Code integration** — add to `~/.claude/mcp_servers.json`

**Data policy**: Still test data only. The MCP server itself can ingest its own working context window via `--self` for dogfooding.

**Milestone**: An agent can `agenthouse_search("tennis strings")` and get the right conversation back from test fixtures.

### Phase 3: Multi-user + Production Storage

Scale beyond one machine.

1. **S3 BlobStore** — swap flatfile for S3-compatible storage
2. **Postgres DatabaseStore** — swap SQLite for Postgres + pgvector
3. **Sync server** — HTTP endpoint for receiving sessions from multiple machines
4. **Auth** — API keys per user, scoped access
5. **Tiered storage** — hot/cold partitioning for large warehouses
6. **Re-ranker** — cross-encoder re-ranking for precision at scale

**Data policy**: This is where real context windows can start being synced — auth, access controls, and data handling are in place.

**Milestone**: Team of 5 developers syncing to a shared warehouse, agents querying across everyone's history.

### Phase 4: Broader Ingestion

Expand beyond context windows.

1. **Cursor parser** — ingest Cursor session logs
2. **Copilot parser** — ingest GitHub Copilot logs
3. **Generic JSONL** — import any structured conversation log
4. **Git integration** — correlate sessions with commits/branches
5. **Slack/docs ingestion** — broader organisational context (stretch)

## Key Design Decisions

### Why chunk at the turn-pair level?
A user question + assistant answer is the natural unit of retrieval. When someone asks "what did I ask about tennis strings?", the answer is a turn pair. Sub-chunking long responses handles edge cases, but the turn pair is the primary atom.

### Why hybrid search?
Pure vector search misses exact keyword matches ("tennis strings" should match literally). Pure keyword search misses semantic intent ("racket string tension" should match "tennis strings"). Hybrid search covers both, with vector similarity weighted higher.

### Why pluggable storage from day one?
SQLite and flat files are perfect for local dev — zero config, zero infrastructure. But the moment you have 2 users, you need a server. Building against interfaces from the start means swapping SQLite → Postgres is a config change, not a rewrite.

### Why an MCP server (not a REST API)?
MCP is the native protocol for agent tool use. An MCP server means any Claude Code, Cursor, or compatible agent can query the warehouse natively — no custom integration code. A REST API can be added later as a thin wrapper over the same query engine.

### Why local embeddings first?
Cost and privacy. Sending every conversation to an embedding API is expensive and leaks potentially sensitive context. Local embeddings via Ollama are free and keep data on-machine. The embedder interface lets you swap to a hosted model when you need better quality or scale.
