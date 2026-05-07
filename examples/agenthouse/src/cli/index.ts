#!/usr/bin/env node
/**
 * Agenthouse CLI entry point.
 *
 * Commands:
 *   agenthouse sync <path>   — ingest sessions from a path
 *   agenthouse query <text>  — search the warehouse
 *   agenthouse stats         — show warehouse statistics
 *   agenthouse list          — list recent sessions
 */

import { Command } from 'commander';
import { defaultConfig } from '../types/config.js';
import { createBlobStore, createDatabaseStore } from '../storage/factory.js';
import { createEmbedder } from '../ingest/embedder.js';
import { IngestPipeline } from '../ingest/pipeline.js';
import { QueryEngine } from '../query/engine.js';
import { syncPath } from './sync.js';

const program = new Command();

program
  .name('agenthouse')
  .description('A data warehouse for agent context windows')
  .version('0.1.0');

// ── sync ──────────────────────────────────────────────────────────────────────

program
  .command('sync <path>')
  .description('Ingest sessions from a file or directory')
  .option('-r, --recursive', 'Recursively walk directories', true)
  .action(async (targetPath: string, opts: { recursive: boolean }) => {
    const config = defaultConfig();
    const blob = createBlobStore(config.storage.blob);
    const database = createDatabaseStore(config.storage.database);
    const embedder = createEmbedder(config.embedder);

    await database.initialize();

    const pipeline = new IngestPipeline({ blob, database, embedder });

    console.log(`Syncing: ${targetPath}`);

    const result = await syncPath(targetPath, pipeline, {
      recursive: opts.recursive,
      onProgress: (file, status, detail) => {
        const icon = status === 'ok' ? '✓' : status === 'skip' ? '·' : '✗';
        console.log(`  ${icon} ${file}${detail ? ` — ${detail}` : ''}`);
      },
    });

    await database.close();

    console.log('\nSync complete:');
    console.log(`  Files scanned:     ${result.filesScanned}`);
    console.log(`  Sessions ingested: ${result.sessionsIngested}`);
    console.log(`  Chunks ingested:   ${result.chunksIngested}`);
    console.log(`  Errors:            ${result.errors.length}`);
    console.log(`  Duration:          ${result.durationMs}ms`);
  });

// ── query ─────────────────────────────────────────────────────────────────────

program
  .command('query <text>')
  .description('Search the warehouse')
  .option('-l, --limit <n>', 'Max results', '5')
  .option('-u, --user <userId>', 'Filter by user')
  .option('-p, --project <path>', 'Filter by project')
  .action(async (text: string, opts: { limit: string; user?: string; project?: string }) => {
    const config = defaultConfig();
    const database = createDatabaseStore(config.storage.database);
    const embedder = createEmbedder(config.embedder);

    await database.initialize();

    const engine = new QueryEngine({ database, embedder });
    const results = await engine.search(text, {
      limit: parseInt(opts.limit, 10),
      userId: opts.user,
      project: opts.project,
    });

    await database.close();

    if (results.length === 0) {
      console.log('No results found.');
      return;
    }

    console.log(`\nTop ${results.length} results for: "${text}"\n`);
    for (const [i, r] of results.entries()) {
      console.log(`${i + 1}. [${(r.score * 100).toFixed(1)}%] ${r.chunk.timestamp ?? 'unknown date'}`);
      console.log(`   Session: ${r.chunk.sessionId}`);
      console.log(`   Q: ${r.chunk.userMessage.slice(0, 100).replace(/\n/g, ' ')}...`);
      console.log(`   A: ${r.chunk.assistantMessage.slice(0, 200).replace(/\n/g, ' ')}...`);
      console.log();
    }
  });

// ── stats ─────────────────────────────────────────────────────────────────────

program
  .command('stats')
  .description('Show warehouse statistics')
  .action(async () => {
    const config = defaultConfig();
    const database = createDatabaseStore(config.storage.database);

    await database.initialize();
    const stats = await database.getStats();
    await database.close();

    console.log('Warehouse statistics:');
    console.log(`  Total sessions: ${stats.totalSessions}`);
    console.log(`  Total chunks:   ${stats.totalChunks}`);
    console.log(`  Total users:    ${stats.totalUsers}`);
    if (stats.oldestEntry) console.log(`  Oldest entry:   ${stats.oldestEntry.toISOString()}`);
    if (stats.newestEntry) console.log(`  Newest entry:   ${stats.newestEntry.toISOString()}`);
  });

// ── list ──────────────────────────────────────────────────────────────────────

program
  .command('list')
  .description('List recent sessions')
  .option('-n, --limit <n>', 'Number of sessions', '20')
  .option('-u, --user <userId>', 'Filter by user')
  .action(async (opts: { limit: string; user?: string }) => {
    const config = defaultConfig();
    const database = createDatabaseStore(config.storage.database);

    await database.initialize();
    const sessions = await database.listSessions({
      limit: parseInt(opts.limit, 10),
      userId: opts.user,
    });
    await database.close();

    if (sessions.length === 0) {
      console.log('No sessions found.');
      return;
    }

    console.log(`\n${sessions.length} session(s):\n`);
    for (const s of sessions) {
      console.log(`  ${s.sessionId}  ${s.agentType}  ${s.startedAt}  ${s.userId}`);
      if (s.project) console.log(`    project: ${s.project}`);
    }
  });

// Run
program.parse(process.argv);
