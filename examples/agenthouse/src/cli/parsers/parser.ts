import type { Session } from '../../types/session.js';

/**
 * Parser interface — converts raw files into Session objects.
 *
 * Each agent type (Claude Code, Cursor, generic JSONL) has its own parser.
 */
export interface Parser {
  /**
   * Parse raw file contents into one or more Sessions.
   *
   * A single file may contain multiple sessions (e.g. a Claude Code project
   * JSONL contains one conversation per file but a project directory
   * has many).
   */
  parse(content: string, filePath?: string): Session[];

  /** Whether this parser can handle the given file */
  canHandle(filePath: string): boolean;
}
