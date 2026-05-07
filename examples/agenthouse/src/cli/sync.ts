import fs from 'node:fs/promises';
import path from 'node:path';
import type { IngestPipeline } from '../ingest/pipeline.js';
import type { Parser } from './parsers/parser.js';
import { ClaudeCodeParser } from './parsers/claude-code.js';
import { GenericParser } from './parsers/generic.js';

export interface SyncOptions {
  /** Recursively walk directories */
  recursive?: boolean;
  /** Parsers to try in order */
  parsers?: Parser[];
  /** Progress callback */
  onProgress?: (file: string, status: 'ok' | 'skip' | 'error', detail?: string) => void;
}

export interface SyncResult {
  filesScanned: number;
  sessionsIngested: number;
  chunksIngested: number;
  errors: Array<{ file: string; error: string }>;
  durationMs: number;
}

/**
 * Sync a directory (or single file) into the warehouse.
 *
 * IMPORTANT: Only pass test fixtures or the current agent's own context
 * window. Do NOT point at real user session directories.
 */
export async function syncPath(
  targetPath: string,
  pipeline: IngestPipeline,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const start = Date.now();
  const parsers: Parser[] = options.parsers ?? [
    new ClaudeCodeParser(),
    new GenericParser(),
  ];

  const result: SyncResult = {
    filesScanned: 0,
    sessionsIngested: 0,
    chunksIngested: 0,
    errors: [],
    durationMs: 0,
  };

  const files = await collectFiles(targetPath, options.recursive ?? true);

  for (const filePath of files) {
    result.filesScanned++;

    // Find a parser that can handle this file
    const parser = parsers.find((p) => p.canHandle(filePath));
    if (!parser) {
      options.onProgress?.(filePath, 'skip', 'no parser for this file type');
      continue;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const sessions = parser.parse(content, filePath);

      if (sessions.length === 0) {
        options.onProgress?.(filePath, 'skip', 'parsed 0 sessions');
        continue;
      }

      for (const session of sessions) {
        const ingestResult = await pipeline.ingest(session);
        result.sessionsIngested++;
        result.chunksIngested += ingestResult.chunksIngested;
      }

      options.onProgress?.(filePath, 'ok', `${sessions.length} sessions`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ file: filePath, error: msg });
      options.onProgress?.(filePath, 'error', msg);
    }
  }

  result.durationMs = Date.now() - start;
  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function collectFiles(targetPath: string, recursive: boolean): Promise<string[]> {
  const stat = await fs.stat(targetPath);

  if (stat.isFile()) return [targetPath];

  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const full = path.join(targetPath, entry.name);
    if (entry.isFile()) {
      files.push(full);
    } else if (entry.isDirectory() && recursive) {
      files.push(...(await collectFiles(full, recursive)));
    }
  }

  return files;
}
