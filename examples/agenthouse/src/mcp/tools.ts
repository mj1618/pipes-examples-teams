import type { DatabaseStore } from '../storage/database/interface.js';
import type { QueryEngine } from '../query/engine.js';
import type { ScoredChunk } from '../types/chunk.js';
import type { SessionFilters } from '../types/session.js';

// ── Tool input schemas (JSON Schema) ──────────────────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    name: 'agenthouse_search',
    description:
      'Search across all agent context windows using natural language. Returns the most relevant past conversations, tool calls, and reasoning traces.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        userId: { type: 'string', description: 'Filter to a specific user' },
        project: { type: 'string', description: 'Filter to a specific project path' },
        agentType: {
          type: 'string',
          enum: ['claude-code', 'cursor', 'copilot', 'generic'],
          description: 'Filter to a specific agent type',
        },
        after: { type: 'string', description: 'ISO date — only results after this date' },
        before: { type: 'string', description: 'ISO date — only results before this date' },
        limit: { type: 'number', default: 5, description: 'Maximum number of results' },
      },
      required: ['query'],
    },
  },
  {
    name: 'agenthouse_recall',
    description:
      "Recall a specific past conversation. More targeted than search — use when the user says 'that time I asked about...' or 'remember when we discussed...'",
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Description of the interaction to find' },
        userId: { type: 'string' },
        approximate_date: {
          type: 'string',
          description: "Rough date if known (e.g. 'last week', '2026-04')",
        },
      },
      required: ['description'],
    },
  },
  {
    name: 'agenthouse_list',
    description:
      'List sessions, users, or projects in the warehouse. Use for browsing rather than searching.',
    inputSchema: {
      type: 'object',
      properties: {
        entity: {
          type: 'string',
          enum: ['sessions', 'users', 'projects'],
          description: 'What to list',
        },
        userId: { type: 'string' },
        project: { type: 'string' },
        limit: { type: 'number', default: 20 },
        offset: { type: 'number', default: 0 },
      },
      required: ['entity'],
    },
  },
  {
    name: 'agenthouse_context',
    description:
      'Retrieve the full context window for a specific session. Use after search/recall to get complete details.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
      },
      required: ['sessionId'],
    },
  },
] as const;

// ── Tool handlers ─────────────────────────────────────────────────────────────

export interface ToolHandlers {
  agenthouse_search: (input: SearchInput) => Promise<ToolResponse>;
  agenthouse_recall: (input: RecallInput) => Promise<ToolResponse>;
  agenthouse_list: (input: ListInput) => Promise<ToolResponse>;
  agenthouse_context: (input: ContextInput) => Promise<ToolResponse>;
}

export interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// Input types
interface SearchInput {
  query: string;
  userId?: string;
  project?: string;
  agentType?: string;
  after?: string;
  before?: string;
  limit?: number;
}

interface RecallInput {
  description: string;
  userId?: string;
  approximate_date?: string;
}

interface ListInput {
  entity: 'sessions' | 'users' | 'projects';
  userId?: string;
  project?: string;
  limit?: number;
  offset?: number;
}

interface ContextInput {
  sessionId: string;
}

/**
 * Create tool handlers bound to a query engine and database store.
 */
export function createToolHandlers(
  queryEngine: QueryEngine,
  database: DatabaseStore
): ToolHandlers {
  return {
    // ── agenthouse_search ─────────────────────────────────────────────────────

    async agenthouse_search(input: SearchInput): Promise<ToolResponse> {
      try {
        const results = await queryEngine.search(input.query, {
          userId: input.userId,
          project: input.project,
          agentType: input.agentType as SearchInput['agentType'] & undefined,
          after: input.after ? new Date(input.after) : undefined,
          before: input.before ? new Date(input.before) : undefined,
          limit: input.limit ?? 5,
        });

        if (results.length === 0) {
          return text(`No results found for: "${input.query}"`);
        }

        const formatted = results
          .map((r, i) => formatChunkResult(r, i + 1))
          .join('\n\n---\n\n');

        return text(`Found ${results.length} result(s) for "${input.query}":\n\n${formatted}`);
      } catch (err) {
        return errorText(`Search failed: ${(err as Error).message}`);
      }
    },

    // ── agenthouse_recall ─────────────────────────────────────────────────────

    async agenthouse_recall(input: RecallInput): Promise<ToolResponse> {
      try {
        const results = await queryEngine.recall(input.description, {
          userId: input.userId,
          limit: 3,
        });

        if (results.length === 0) {
          return text(`Could not find a conversation matching: "${input.description}"`);
        }

        const formatted = results
          .map((r, i) => formatChunkResult(r, i + 1))
          .join('\n\n---\n\n');

        return text(`Best match for "${input.description}":\n\n${formatted}`);
      } catch (err) {
        return errorText(`Recall failed: ${(err as Error).message}`);
      }
    },

    // ── agenthouse_list ───────────────────────────────────────────────────────

    async agenthouse_list(input: ListInput): Promise<ToolResponse> {
      try {
        switch (input.entity) {
          case 'sessions': {
            const filters: SessionFilters = {
              userId: input.userId,
              project: input.project,
              limit: input.limit ?? 20,
              offset: input.offset ?? 0,
            };
            const sessions = await database.listSessions(filters);

            if (sessions.length === 0) return text('No sessions found.');

            const lines = sessions.map(
              (s) =>
                `• ${s.sessionId} | ${s.agentType} | ${s.startedAt.slice(0, 10)} | user: ${s.userId}${s.project ? ` | ${s.project}` : ''}`
            );
            return text(`${sessions.length} session(s):\n\n${lines.join('\n')}`);
          }

          case 'users': {
            const sessions = await database.listSessions({ limit: 1000 });
            const users = [...new Set(sessions.map((s) => s.userId))];
            if (users.length === 0) return text('No users found.');
            return text(`${users.length} user(s):\n\n${users.map((u) => `• ${u}`).join('\n')}`);
          }

          case 'projects': {
            const filters: SessionFilters = {
              userId: input.userId,
              limit: 1000,
            };
            const sessions = await database.listSessions(filters);
            const projects = [...new Set(sessions.map((s) => s.project).filter(Boolean))];
            if (projects.length === 0) return text('No projects found.');
            return text(
              `${projects.length} project(s):\n\n${projects.map((p) => `• ${p}`).join('\n')}`
            );
          }
        }
      } catch (err) {
        return errorText(`List failed: ${(err as Error).message}`);
      }
    },

    // ── agenthouse_context ────────────────────────────────────────────────────

    async agenthouse_context(input: ContextInput): Promise<ToolResponse> {
      try {
        const session = await database.getSession(input.sessionId);

        if (!session) {
          return text(`Session not found: ${input.sessionId}`);
        }

        const lines: string[] = [
          `Session: ${session.sessionId}`,
          `User: ${session.userId}`,
          `Agent: ${session.agentType}`,
          `Project: ${session.project ?? 'N/A'}`,
          `Started: ${session.startedAt}`,
          `Messages: ${session.messages.length}`,
          '',
          '--- Conversation ---',
          '',
        ];

        for (const msg of session.messages) {
          lines.push(`[${msg.role.toUpperCase()}]: ${msg.content}`);
          if (msg.toolCalls && msg.toolCalls.length > 0) {
            for (const tc of msg.toolCalls) {
              lines.push(`  → Tool: ${tc.name}(${JSON.stringify(tc.input ?? {})})`);
            }
          }
          lines.push('');
        }

        return text(lines.join('\n'));
      } catch (err) {
        return errorText(`Context retrieval failed: ${(err as Error).message}`);
      }
    },
  };
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatChunkResult(r: ScoredChunk, index: number): string {
  const score = (r.score * 100).toFixed(1);
  const date = r.chunk.timestamp
    ? new Date(r.chunk.timestamp).toLocaleDateString()
    : 'unknown date';

  return [
    `**Result ${index}** (relevance: ${score}%) — ${date}`,
    `Session: ${r.chunk.sessionId}`,
    `User: ${r.chunk.userId}${r.chunk.project ? ` | Project: ${r.chunk.project}` : ''}`,
    '',
    `**You asked:** ${r.chunk.userMessage}`,
    '',
    `**Assistant:** ${r.chunk.assistantMessage.slice(0, 500)}${
      r.chunk.assistantMessage.length > 500 ? '...' : ''
    }`,
  ].join('\n');
}

function text(content: string): ToolResponse {
  return { content: [{ type: 'text', text: content }] };
}

function errorText(content: string): ToolResponse {
  return { content: [{ type: 'text', text: content }], isError: true };
}
