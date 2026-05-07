import { v4 as uuidv4 } from 'uuid';
import type { Parser } from './parser.js';
import type { Session, Message } from '../../types/session.js';

/**
 * Generic JSONL parser.
 *
 * Handles any JSONL file where each line is a message with at minimum
 * { role, content } fields. Also handles JSON arrays of messages.
 *
 * Supports:
 * - JSONL files (one message per line)
 * - JSON array files ([ { role, content }, ... ])
 * - Session envelope format (SessionSchema-compatible JSON)
 */
export class GenericParser implements Parser {
  canHandle(filePath: string): boolean {
    return filePath.endsWith('.jsonl') || filePath.endsWith('.json');
  }

  parse(content: string, filePath = ''): Session[] {
    // Try to parse as session envelope first
    const sessionEnvelope = this.tryParseSessionEnvelope(content);
    if (sessionEnvelope) return [sessionEnvelope];

    // Try JSON array of messages
    const jsonArray = this.tryParseJsonArray(content);
    if (jsonArray) return [this.messagesToSession(jsonArray, filePath)];

    // Try JSONL line-by-line
    const jsonlMessages = this.parseJsonl(content);
    if (jsonlMessages.length > 0) {
      return [this.messagesToSession(jsonlMessages, filePath)];
    }

    return [];
  }

  // ── Parsers ──────────────────────────────────────────────────────────────────

  private tryParseSessionEnvelope(content: string): Session | null {
    try {
      const obj = JSON.parse(content.trim()) as Record<string, unknown>;
      // Minimal check: has sessionId, userId, messages array
      if (
        typeof obj.sessionId === 'string' &&
        typeof obj.userId === 'string' &&
        Array.isArray(obj.messages)
      ) {
        return obj as unknown as Session;
      }
    } catch {
      // Not a valid JSON object
    }
    return null;
  }

  private tryParseJsonArray(content: string): Message[] | null {
    try {
      const arr = JSON.parse(content.trim()) as unknown[];
      if (!Array.isArray(arr)) return null;
      const messages = arr
        .map((item) => this.toMessage(item as Record<string, unknown>))
        .filter((m): m is Message => m !== null);
      return messages.length > 0 ? messages : null;
    } catch {
      return null;
    }
  }

  private parseJsonl(content: string): Message[] {
    const messages: Message[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        const msg = this.toMessage(obj);
        if (msg) messages.push(msg);
      } catch {
        // skip bad lines
      }
    }
    return messages;
  }

  private toMessage(obj: Record<string, unknown>): Message | null {
    const role = obj.role as string | undefined;
    if (!role || !['user', 'assistant', 'system'].includes(role)) return null;

    const content =
      typeof obj.content === 'string'
        ? obj.content
        : JSON.stringify(obj.content ?? '');

    return {
      role: role as 'user' | 'assistant' | 'system',
      content,
      timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : undefined,
      toolCalls: [],
    };
  }

  private messagesToSession(messages: Message[], filePath: string): Session {
    const timestamps = messages
      .map((m) => m.timestamp)
      .filter((t): t is string => Boolean(t));

    const startedAt =
      timestamps[0] ?? new Date().toISOString();
    const endedAt = timestamps[timestamps.length - 1];

    return {
      sessionId: uuidv4(),
      userId: process.env.USER ?? 'unknown',
      agentType: 'generic',
      project: filePath || undefined,
      startedAt,
      endedAt,
      messages,
      metadata: { tags: [] },
    };
  }
}
