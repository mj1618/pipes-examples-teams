/**
 * Tests for chunkSession — basic turn pairing, system messages, orphaned messages
 */

import { describe, it, expect } from 'vitest';
import { chunkSession } from '../src/ingest/chunker.js';
import type { Session, Message } from '../src/types/session.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function msg(role: Message['role'], content: string, toolCalls?: Message['toolCalls']): Message {
  return { role, content, toolCalls: toolCalls ?? [] };
}

function session(messages: Message[], overrides: Partial<Session> = {}): Session {
  return {
    sessionId: '00000000-0000-0000-0000-000000000001',
    userId: 'alice',
    agentType: 'claude-code',
    project: '/myproject',
    startedAt: '2026-01-01T10:00:00.000Z',
    messages,
    metadata: { tags: [] },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('chunkSession — basic pairing', () => {
  it('returns empty array for a session with no messages', () => {
    expect(chunkSession(session([]))).toEqual([]);
  });

  it('returns empty array when only user messages present', () => {
    expect(chunkSession(session([msg('user', 'Hello?')]))).toEqual([]);
  });

  it('returns empty array when only assistant messages present', () => {
    expect(chunkSession(session([msg('assistant', 'Hi!')]))).toEqual([]);
  });

  it('produces one chunk for a single user→assistant pair', () => {
    const chunks = chunkSession(
      session([msg('user', 'What is Python?'), msg('assistant', 'Python is a language.')])
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].userMessage).toBe('What is Python?');
    expect(chunks[0].assistantMessage).toBe('Python is a language.');
    expect(chunks[0].turnIndex).toBe(0);
  });

  it('produces multiple chunks for multiple turn pairs', () => {
    const chunks = chunkSession(
      session([
        msg('user', 'Q1'), msg('assistant', 'A1'),
        msg('user', 'Q2'), msg('assistant', 'A2'),
      ])
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0].userMessage).toBe('Q1');
    expect(chunks[1].userMessage).toBe('Q2');
    expect(chunks[0].turnIndex).toBe(0);
    expect(chunks[1].turnIndex).toBe(1);
  });

  it('assigns chunk fields from session metadata', () => {
    const chunks = chunkSession(session([msg('user', 'hello'), msg('assistant', 'world')]));
    expect(chunks[0].sessionId).toBe('00000000-0000-0000-0000-000000000001');
    expect(chunks[0].userId).toBe('alice');
    expect(chunks[0].agentType).toBe('claude-code');
    expect(chunks[0].project).toBe('/myproject');
  });

  it('generates unique chunkIds for each chunk', () => {
    const chunks = chunkSession(
      session([msg('user', 'Q1'), msg('assistant', 'A1'), msg('user', 'Q2'), msg('assistant', 'A2')])
    );
    const ids = chunks.map((c) => c.chunkId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('skips system messages', () => {
    const chunks = chunkSession(
      session([msg('system', 'You are helpful.'), msg('user', 'Hello'), msg('assistant', 'Hi')])
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].userMessage).toBe('Hello');
  });

  it('ignores a trailing user message with no assistant response', () => {
    const chunks = chunkSession(
      session([msg('user', 'Q1'), msg('assistant', 'A1'), msg('user', 'Q2 unanswered')])
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].userMessage).toBe('Q1');
  });

  it('handles consecutive user messages — last one pairs with assistant', () => {
    const chunks = chunkSession(
      session([
        msg('user', 'First (orphaned)'),
        msg('user', 'Second'),
        msg('assistant', 'Reply to second'),
      ])
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].userMessage).toBe('Second');
  });

  it('attaches tool calls to the chunk', () => {
    const toolCalls = [{ name: 'read_file', input: { path: '/foo.ts' } }];
    const chunks = chunkSession(
      session([msg('user', 'Read file'), msg('assistant', 'Sure.', toolCalls)])
    );
    expect(chunks[0].toolCalls).toEqual(toolCalls);
  });

  it('defaults toolCalls to empty array when none present', () => {
    const chunks = chunkSession(session([msg('user', 'Q'), msg('assistant', 'A')]));
    expect(chunks[0].toolCalls).toEqual([]);
  });

  it('uses user message timestamp when present', () => {
    const chunks = chunkSession(
      session([
        { role: 'user', content: 'Q', timestamp: '2026-05-01T12:00:00.000Z', toolCalls: [] },
        msg('assistant', 'A'),
      ])
    );
    expect(chunks[0].timestamp).toBe('2026-05-01T12:00:00.000Z');
  });

  it('falls back to session.startedAt when user message has no timestamp', () => {
    const chunks = chunkSession(session([msg('user', 'Q'), msg('assistant', 'A')]));
    expect(chunks[0].timestamp).toBe('2026-01-01T10:00:00.000Z');
  });

  it('includes a tokenCount field on each chunk', () => {
    const chunks = chunkSession(session([msg('user', 'Q'), msg('assistant', 'A')]));
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
  });
});
