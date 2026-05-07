import { v4 as uuidv4 } from 'uuid';
import type { Session, Message } from '../types/session.js';
import type { Chunk } from '../types/chunk.js';

export interface ChunkerOptions {
  /**
   * Approximate token budget per chunk.
   * Long assistant messages are sub-chunked if they exceed this.
   * Default: 1000
   */
  maxTokensPerChunk?: number;
  /**
   * Token overlap between sub-chunks of a long message.
   * Default: 100
   */
  overlapTokens?: number;
}

/**
 * Turn-pair chunker.
 *
 * Strategy:
 * - Each (user → assistant) consecutive pair = one primary chunk.
 * - If an assistant response is very long (> maxTokensPerChunk),
 *   it is sub-chunked with overlap, producing multiple Chunk records
 *   from the same turn.
 * - Tool calls on the assistant message are attached to every
 *   sub-chunk produced from that turn.
 * - System messages are skipped.
 */
export function chunkSession(session: Session, options: ChunkerOptions = {}): Chunk[] {
  const { maxTokensPerChunk = 1000, overlapTokens = 100 } = options;
  const chunks: Chunk[] = [];

  // Extract user→assistant turn pairs
  const turns = extractTurnPairs(session.messages);

  let turnIndex = 0;
  for (const turn of turns) {
    const baseChunk: Omit<Chunk, 'chunkId' | 'assistantMessage'> = {
      sessionId: session.sessionId,
      userId: session.userId,
      project: session.project,
      agentType: session.agentType,
      timestamp: turn.user.timestamp ?? session.startedAt,
      turnIndex,
      userMessage: turn.user.content,
      toolCalls: turn.assistant.toolCalls ?? [],
    };

    const assistantText = turn.assistant.content;
    const estimatedTokens = estimateTokens(assistantText);

    if (estimatedTokens <= maxTokensPerChunk) {
      // Single chunk for this turn
      chunks.push({
        ...baseChunk,
        chunkId: uuidv4(),
        assistantMessage: assistantText,
        tokenCount: estimateTokens(turn.user.content) + estimatedTokens,
      });
    } else {
      // Sub-chunk long assistant responses
      const subChunks = subChunkText(assistantText, maxTokensPerChunk, overlapTokens);
      for (const sub of subChunks) {
        chunks.push({
          ...baseChunk,
          chunkId: uuidv4(),
          assistantMessage: sub,
          tokenCount: estimateTokens(turn.user.content) + estimateTokens(sub),
        });
      }
    }

    turnIndex++;
  }

  return chunks;
}

// ── Internals ─────────────────────────────────────────────────────────────────

interface TurnPair {
  user: Message;
  assistant: Message;
}

/**
 * Walk the message list and collect consecutive user→assistant pairs.
 * Skips system messages and orphaned messages.
 */
function extractTurnPairs(messages: Message[]): TurnPair[] {
  const pairs: TurnPair[] = [];
  let pendingUser: Message | null = null;

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (msg.role === 'user') {
      pendingUser = msg;
    } else if (msg.role === 'assistant' && pendingUser) {
      pairs.push({ user: pendingUser, assistant: msg });
      pendingUser = null;
    }
  }

  return pairs;
}

/**
 * Rough token count estimator: ~4 characters per token.
 * Good enough for chunking decisions; replace with tiktoken for precision.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split text into overlapping sub-chunks.
 *
 * Tries to split on paragraph/sentence boundaries first.
 * Falls back to hard word-boundary splits.
 */
function subChunkText(text: string, maxTokens: number, overlapTokens: number): string[] {
  const maxChars = maxTokens * 4;
  const overlapChars = overlapTokens * 4;

  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let pos = 0;

  while (pos < text.length) {
    const end = Math.min(pos + maxChars, text.length);
    let slice = text.slice(pos, end);

    // Try to end at a paragraph boundary
    if (end < text.length) {
      const lastPara = slice.lastIndexOf('\n\n');
      if (lastPara > maxChars * 0.5) {
        slice = slice.slice(0, lastPara + 2);
      } else {
        // Fall back to sentence boundary
        const lastPeriod = Math.max(
          slice.lastIndexOf('. '),
          slice.lastIndexOf('! '),
          slice.lastIndexOf('? ')
        );
        if (lastPeriod > maxChars * 0.5) {
          slice = slice.slice(0, lastPeriod + 2);
        }
      }
    }

    chunks.push(slice.trimEnd());
    // Advance position with overlap
    pos += slice.length - overlapChars;
    if (pos <= 0) pos = slice.length; // safety: avoid infinite loop
  }

  return chunks;
}
