import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { DatabaseStore } from './interface.js';
import type { Chunk, ScoredChunk, SearchOptions, WarehouseStats } from '../../types/chunk.js';
import type { Session, SessionSummary, SessionFilters } from '../../types/session.js';

/**
 * SQLiteDatabaseStore
 *
 * Uses sql.js (pure WASM SQLite) — no native compilation needed.
 * Full-text search uses SQLite FTS5.
 * Vector search is brute-force cosine similarity in JS (adequate for dev scale).
 */
export class SQLiteDatabaseStore implements DatabaseStore {
  private db: SqlJsDatabase | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string = '~/.agenthouse/warehouse.db') {
    this.dbPath = dbPath.startsWith('~')
      ? path.join(os.homedir(), dbPath.slice(1))
      : dbPath;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    const dir = path.dirname(this.dbPath);
    fs.mkdirSync(dir, { recursive: true });

    const SQL = await initSqlJs();

    // Load existing DB file if it exists
    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA foreign_keys = ON');
    this.createTables();
  }

  async close(): Promise<void> {
    if (this.db) {
      // Persist to disk
      const data = this.db.export();
      fs.writeFileSync(this.dbPath, Buffer.from(data));
      this.db.close();
      this.db = null;
    }
  }

  /** Flush current state to disk without closing */
  private save(): void {
    if (this.db) {
      const data = this.db.export();
      fs.writeFileSync(this.dbPath, Buffer.from(data));
    }
  }

  private getDb(): SqlJsDatabase {
    if (!this.db) throw new Error('DatabaseStore not initialized. Call initialize() first.');
    return this.db;
  }

  private createTables(): void {
    const db = this.getDb();

    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id    TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL,
        agent_type    TEXT NOT NULL,
        project       TEXT,
        started_at    TEXT NOT NULL,
        ended_at      TEXT,
        message_count INTEGER NOT NULL DEFAULT 0,
        token_count   INTEGER,
        tags          TEXT NOT NULL DEFAULT '[]',
        raw_json      TEXT NOT NULL
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project)');
    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at)');

    db.run(`
      CREATE TABLE IF NOT EXISTS chunks (
        chunk_id         TEXT PRIMARY KEY,
        session_id       TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        user_id          TEXT NOT NULL,
        project          TEXT,
        agent_type       TEXT NOT NULL,
        timestamp        TEXT,
        turn_index       INTEGER NOT NULL,
        user_message     TEXT NOT NULL,
        assistant_message TEXT NOT NULL,
        tool_calls       TEXT NOT NULL DEFAULT '[]',
        embedding        TEXT,
        token_count      INTEGER
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_chunks_session   ON chunks(session_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_chunks_user      ON chunks(user_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_chunks_project   ON chunks(project)');
    db.run('CREATE INDEX IF NOT EXISTS idx_chunks_timestamp ON chunks(timestamp)');
  }

  // ── Chunk storage ─────────────────────────────────────────────────────────

  async insertChunks(chunks: Chunk[]): Promise<void> {
    const db = this.getDb();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO chunks (
        chunk_id, session_id, user_id, project, agent_type,
        timestamp, turn_index, user_message, assistant_message,
        tool_calls, embedding, token_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const c of chunks) {
      stmt.run([
        c.chunkId,
        c.sessionId,
        c.userId,
        c.project ?? null,
        c.agentType,
        c.timestamp ?? null,
        c.turnIndex,
        c.userMessage,
        c.assistantMessage,
        JSON.stringify(c.toolCalls ?? []),
        c.embedding ? JSON.stringify(c.embedding) : null,
        c.tokenCount ?? null,
      ]);
    }
    stmt.free();
    this.save();
  }

  async getChunk(chunkId: string): Promise<Chunk | null> {
    const db = this.getDb();
    const stmt = db.prepare('SELECT * FROM chunks WHERE chunk_id = ?');
    stmt.bind([chunkId]);
    if (stmt.step()) {
      const row = stmtToObj(stmt);
      stmt.free();
      return rowToChunk(row);
    }
    stmt.free();
    return null;
  }

  async getChunksBySession(sessionId: string): Promise<Chunk[]> {
    const db = this.getDb();
    const results: Chunk[] = [];
    const stmt = db.prepare('SELECT * FROM chunks WHERE session_id = ? ORDER BY turn_index');
    stmt.bind([sessionId]);
    while (stmt.step()) {
      results.push(rowToChunk(stmtToObj(stmt)));
    }
    stmt.free();
    return results;
  }

  // ── Semantic search ───────────────────────────────────────────────────────

  async searchSemantic(embedding: number[], options: SearchOptions = {}): Promise<ScoredChunk[]> {
    const db = this.getDb();
    const limit = options.limit ?? 5;

    const { where, params } = buildWhereClause(options);
    const whereClause = where
      ? `WHERE ${where} AND embedding IS NOT NULL`
      : 'WHERE embedding IS NOT NULL';

    const results: ScoredChunk[] = [];
    const stmt = db.prepare(`SELECT * FROM chunks ${whereClause}`);
    if (params.length) stmt.bind(params);

    while (stmt.step()) {
      const row = stmtToObj(stmt);
      const storedEmbedding = JSON.parse(row.embedding as string) as number[];
      const score = cosineSimilarity(embedding, storedEmbedding);
      results.push({ chunk: rowToChunk(row), score, source: 'semantic' as const });
    }
    stmt.free();

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // ── Full-text search ──────────────────────────────────────────────────────

  async searchFullText(query: string, options: SearchOptions = {}): Promise<ScoredChunk[]> {
    const db = this.getDb();
    const limit = options.limit ?? 5;

    // sql.js may not have FTS5 compiled in — fall back to LIKE search
    const { where, params } = buildWhereClause(options);
    const likePattern = `%${query}%`;
    const whereClause = where ? `WHERE ${where} AND` : 'WHERE';
    const sql = `
      SELECT * FROM chunks
      ${whereClause} (user_message LIKE ? OR assistant_message LIKE ?)
      ORDER BY timestamp DESC
      LIMIT ?
    `;

    const allParams = [...params, likePattern, likePattern, limit];
    const results: ScoredChunk[] = [];
    const stmt = db.prepare(sql);
    stmt.bind(allParams);

    while (stmt.step()) {
      const row = stmtToObj(stmt);
      const chunk = rowToChunk(row);
      // Simple relevance: count how many times the query appears
      const text = `${chunk.userMessage} ${chunk.assistantMessage}`.toLowerCase();
      const queryLower = query.toLowerCase();
      const count = text.split(queryLower).length - 1;
      const score = Math.min(1, count * 0.2);
      results.push({ chunk, score, source: 'fulltext' as const });
    }
    stmt.free();

    return results.sort((a, b) => b.score - a.score);
  }

  // ── Session metadata ──────────────────────────────────────────────────────

  async upsertSession(session: Session): Promise<void> {
    const db = this.getDb();
    db.run(`
      INSERT OR REPLACE INTO sessions (
        session_id, user_id, agent_type, project, started_at, ended_at,
        message_count, token_count, tags, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      session.sessionId,
      session.userId,
      session.agentType,
      session.project ?? null,
      session.startedAt,
      session.endedAt ?? null,
      session.messages.length,
      session.metadata?.tokenCount ?? null,
      JSON.stringify(session.metadata?.tags ?? []),
      JSON.stringify(session),
    ]);
    this.save();
  }

  async listSessions(filters: SessionFilters = {}): Promise<SessionSummary[]> {
    const db = this.getDb();
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filters.userId) { conditions.push('user_id = ?'); params.push(filters.userId); }
    if (filters.project) { conditions.push('project = ?'); params.push(filters.project); }
    if (filters.agentType) { conditions.push('agent_type = ?'); params.push(filters.agentType); }
    if (filters.after) { conditions.push('started_at >= ?'); params.push(filters.after.toISOString()); }
    if (filters.before) { conditions.push('started_at <= ?'); params.push(filters.before.toISOString()); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? 20;
    const offset = filters.offset ?? 0;
    params.push(limit, offset);

    const results: SessionSummary[] = [];
    const stmt = db.prepare(`
      SELECT session_id, user_id, agent_type, project, started_at, ended_at,
             message_count, token_count, tags
      FROM sessions ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?
    `);
    stmt.bind(params);

    while (stmt.step()) {
      const r = stmtToObj(stmt);
      results.push({
        sessionId: r.session_id as string,
        userId: r.user_id as string,
        agentType: r.agent_type as SessionSummary['agentType'],
        project: (r.project as string) ?? undefined,
        startedAt: r.started_at as string,
        endedAt: (r.ended_at as string) ?? undefined,
        messageCount: r.message_count as number,
        tokenCount: (r.token_count as number) ?? undefined,
        tags: JSON.parse((r.tags as string) ?? '[]') as string[],
      });
    }
    stmt.free();
    return results;
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const db = this.getDb();
    const stmt = db.prepare('SELECT raw_json FROM sessions WHERE session_id = ?');
    stmt.bind([sessionId]);
    if (stmt.step()) {
      const row = stmtToObj(stmt);
      stmt.free();
      return JSON.parse(row.raw_json as string) as Session;
    }
    stmt.free();
    return null;
  }

  // ── Housekeeping ──────────────────────────────────────────────────────────

  async deleteSession(sessionId: string): Promise<void> {
    const db = this.getDb();
    db.run('DELETE FROM chunks WHERE session_id = ?', [sessionId]);
    db.run('DELETE FROM sessions WHERE session_id = ?', [sessionId]);
    this.save();
  }

  async getStats(): Promise<WarehouseStats> {
    const db = this.getDb();
    const chunks = db.exec('SELECT COUNT(*) FROM chunks')[0]?.values[0]?.[0] as number ?? 0;
    const sessions = db.exec('SELECT COUNT(*) FROM sessions')[0]?.values[0]?.[0] as number ?? 0;
    const users = db.exec('SELECT COUNT(DISTINCT user_id) FROM sessions')[0]?.values[0]?.[0] as number ?? 0;
    const oldest = db.exec('SELECT MIN(started_at) FROM sessions')[0]?.values[0]?.[0] as string | null;
    const newest = db.exec('SELECT MAX(started_at) FROM sessions')[0]?.values[0]?.[0] as string | null;

    return {
      totalChunks: chunks,
      totalSessions: sessions,
      totalUsers: users,
      oldestEntry: oldest ? new Date(oldest) : undefined,
      newestEntry: newest ? new Date(newest) : undefined,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert sql.js statement columns to a plain object */
function stmtToObj(stmt: { getColumnNames: () => string[]; get: () => unknown[] }): Record<string, unknown> {
  const cols = stmt.getColumnNames();
  const vals = stmt.get();
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < cols.length; i++) {
    obj[cols[i]] = vals[i];
  }
  return obj;
}

function rowToChunk(row: Record<string, unknown>): Chunk {
  return {
    chunkId: row.chunk_id as string,
    sessionId: row.session_id as string,
    userId: row.user_id as string,
    project: (row.project as string) ?? undefined,
    agentType: row.agent_type as string,
    timestamp: (row.timestamp as string) ?? undefined,
    turnIndex: row.turn_index as number,
    userMessage: row.user_message as string,
    assistantMessage: row.assistant_message as string,
    toolCalls: JSON.parse((row.tool_calls as string) ?? '[]'),
    embedding: row.embedding ? (JSON.parse(row.embedding as string) as number[]) : undefined,
    tokenCount: (row.token_count as number) ?? undefined,
  };
}

function buildWhereClause(
  options: SearchOptions,
  alias = ''
): { where: string; params: (string | number)[] } {
  const prefix = alias ? `${alias}.` : '';
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options.userId) { conditions.push(`${prefix}user_id = ?`); params.push(options.userId); }
  if (options.project) { conditions.push(`${prefix}project = ?`); params.push(options.project); }
  if (options.agentType) { conditions.push(`${prefix}agent_type = ?`); params.push(options.agentType); }
  if (options.after) { conditions.push(`${prefix}timestamp >= ?`); params.push(options.after.toISOString()); }
  if (options.before) { conditions.push(`${prefix}timestamp <= ?`); params.push(options.before.toISOString()); }

  return { where: conditions.join(' AND '), params };
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
