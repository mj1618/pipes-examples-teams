import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';
import type { Parser } from './parser.js';
import type { Session, Message, ToolCall } from '../../types/session.js';

/**
 * Claude Code JSONL parser.
 *
 * Claude Code stores conversation history in JSONL files under
 * `~/.claude/projects/<project-hash>/<session-id>.jsonl`.
 *
 * Each line is a JSON object with at least { role, content }.
 * Tool calls appear as content blocks of type "tool_use".
 */
export class ClaudeCodeParser implements Parser {
  canHandle(filePath: string): boolean {
    return filePath.endsWith('.jsonl');
  }

  parse(content: string, filePath = ''): Session[] {
    const lines = content.split('\n').filter((l) => l.trim());
    if (lines.length === 0) return [];

    const messages: Message[] = [];
    let firstTimestamp: string | undefined;
    let lastTimestamp: string | undefined;

    for (const line of lines) {
      let record: ClaudeCodeRecord;
      try {
        record = JSON.parse(line) as ClaudeCodeRecord;
      } catch {
        continue; // Skip malformed lines
      }

      const msg = this.recordToMessage(record);
      if (msg) {
        messages.push(msg);
        const ts = msg.timestamp;
        if (ts) {
          if (!firstTimestamp) firstTimestamp = ts;
          lastTimestamp = ts;
        }
      }
    }

    if (messages.length === 0) return [];

    // Derive project path from the file path convention
    // ~/.claude/projects/<project-hash>/conversation.jsonl
    const projectHash = this.extractProjectHash(filePath);

    // Use the session ID from the filename if it looks like a UUID, otherwise generate
    const fileBasename = path.basename(filePath, '.jsonl');
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const sessionId = uuidRegex.test(fileBasename) ? fileBasename : uuidv4();

    const session: Session = {
      sessionId,
      userId: process.env.USER ?? 'unknown',
      agentType: 'claude-code',
      project: projectHash ?? undefined,
      startedAt: firstTimestamp ?? new Date().toISOString(),
      endedAt: lastTimestamp,
      messages,
      metadata: {
        tags: [],
      },
    };

    return [session];
  }

  private recordToMessage(record: ClaudeCodeRecord): Message | null {
    // Claude Code JSONL has two possible formats:
    //
    // Format 1 (actual Claude Code): top-level { type: "user"|"assistant", message: { role, content }, timestamp }
    // Format 2 (simple JSONL):       top-level { role, content, timestamp }
    //
    // Normalise to { role, content, timestamp } first.

    let role: string | undefined;
    let rawContent: string | ContentBlock[] | undefined;
    let timestamp: string | undefined = record.timestamp;

    if (record.type && ['user', 'assistant'].includes(record.type) && record.message) {
      // Format 1: real Claude Code sessions
      role = record.message.role ?? record.type;
      rawContent = record.message.content;
    } else if (record.role) {
      // Format 2: simple { role, content }
      role = record.role;
      rawContent = record.content;
    } else {
      return null; // Not a user/assistant record (e.g. "queue-operation", "progress")
    }

    if (!role || !['user', 'assistant', 'system'].includes(role)) return null;

    let content = '';
    const toolCalls: ToolCall[] = [];

    if (typeof rawContent === 'string') {
      content = rawContent;
    } else if (Array.isArray(rawContent)) {
      // Content blocks
      for (const block of rawContent) {
        if (block.type === 'text') {
          content += (block.text ?? '') + '\n';
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            name: block.name ?? '',
            input: block.input ?? {},
          });
        } else if (block.type === 'tool_result') {
          // Attach tool result to last tool call
          if (toolCalls.length > 0) {
            toolCalls[toolCalls.length - 1].output = block.content;
          }
        }
      }
    }

    return {
      role: role as 'user' | 'assistant' | 'system',
      content: content.trim(),
      timestamp,
      toolCalls: toolCalls.length > 0 ? toolCalls : [],
    };
  }

  private extractProjectHash(filePath: string): string | null {
    // ~/.claude/projects/<hash>/something.jsonl
    const parts = filePath.split(path.sep);
    const projectsIdx = parts.lastIndexOf('projects');
    if (projectsIdx !== -1 && projectsIdx + 1 < parts.length) {
      return parts[projectsIdx + 1];
    }
    return null;
  }
}

// ── Claude Code record shape ──────────────────────────────────────────────────

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: unknown;
}

interface ClaudeCodeRecord {
  // Format 1 (real Claude Code): { type: "user"|"assistant", message: { role, content }, timestamp }
  type?: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
  };
  // Format 2 (simple JSONL): { role, content }
  role?: string;
  content?: string | ContentBlock[];
  // Common
  timestamp?: string;
  uuid?: string;
  sessionId?: string;
}
