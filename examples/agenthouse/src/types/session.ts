import { z } from 'zod';

// ── Tool call ─────────────────────────────────────────────────────────────────

export const ToolCallSchema = z.object({
  name: z.string(),
  input: z.record(z.unknown()).optional(),
  output: z.unknown().optional(),
});

export type ToolCall = z.infer<typeof ToolCallSchema>;

// ── Message ───────────────────────────────────────────────────────────────────

export const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.string().optional(),
  toolCalls: z.array(ToolCallSchema).optional().default([]),
});

export type Message = z.infer<typeof MessageSchema>;

// ── Agent type ────────────────────────────────────────────────────────────────

export const AgentTypeSchema = z.enum(['claude-code', 'cursor', 'copilot', 'generic']);
export type AgentType = z.infer<typeof AgentTypeSchema>;

// ── Session ───────────────────────────────────────────────────────────────────

export const SessionSchema = z.object({
  sessionId: z.string().uuid(),
  userId: z.string(),
  agentType: AgentTypeSchema,
  project: z.string().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  messages: z.array(MessageSchema),
  metadata: z
    .object({
      model: z.string().optional(),
      tokenCount: z.number().optional(),
      tags: z.array(z.string()).optional().default([]),
    })
    .optional()
    .default({}),
});

export type Session = z.infer<typeof SessionSchema>;

// ── Session summary (lightweight listing) ────────────────────────────────────

export const SessionSummarySchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  agentType: AgentTypeSchema,
  project: z.string().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  messageCount: z.number(),
  tokenCount: z.number().optional(),
  tags: z.array(z.string()).optional().default([]),
});

export type SessionSummary = z.infer<typeof SessionSummarySchema>;

// ── Session filters ───────────────────────────────────────────────────────────

export interface SessionFilters {
  userId?: string;
  project?: string;
  agentType?: AgentType;
  after?: Date;
  before?: Date;
  limit?: number;
  offset?: number;
}
