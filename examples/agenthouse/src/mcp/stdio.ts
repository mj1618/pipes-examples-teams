#!/usr/bin/env node
/**
 * Agenthouse MCP server — stdio transport for Claude Desktop / Claude Code.
 *
 * Usage:
 *   npx tsx src/mcp/stdio.ts
 *
 * Claude Desktop config (~/.claude/mcp_servers.json or claude_desktop_config.json):
 *   {
 *     "agenthouse": {
 *       "command": "npx",
 *       "args": ["tsx", "src/mcp/stdio.ts"],
 *       "cwd": "/Users/matt/code/pipes-examples-teams/examples/agenthouse"
 *     }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { defaultConfig } from '../types/config.js';
import { createDatabaseStore } from '../storage/factory.js';
import { createEmbedder } from '../ingest/embedder.js';
import { QueryEngine } from '../query/engine.js';

// ── Bootstrap stores ──────────────────────────────────────────────────────────

const config = defaultConfig();
const database = createDatabaseStore(config.storage.database);
const embedder = createEmbedder(config.embedder);

await database.initialize();

const queryEngine = new QueryEngine({ database, embedder });

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'agenthouse',
  version: '0.1.0',
});

// ── agenthouse_search ─────────────────────────────────────────────────────────

server.tool(
  'agenthouse_search',
  'Search across all agent context windows using natural language. Returns the most relevant past conversations, tool calls, and reasoning traces.',
  {
    query: z.string().describe('Natural language search query'),
    userId: z.string().optional().describe('Filter to a specific user'),
    project: z.string().optional().describe('Filter to a specific project path'),
    agentType: z.enum(['claude-code', 'cursor', 'copilot', 'generic']).optional().describe('Filter to a specific agent type'),
    after: z.string().optional().describe('ISO date — only results after this date'),
    before: z.string().optional().describe('ISO date — only results before this date'),
    limit: z.number().optional().default(5).describe('Maximum number of results'),
  },
  async (input) => {
    const results = await queryEngine.search(input.query, {
      userId: input.userId,
      project: input.project,
      agentType: input.agentType,
      after: input.after ? new Date(input.after) : undefined,
      before: input.before ? new Date(input.before) : undefined,
      limit: input.limit,
    });

    if (results.length === 0) {
      return { content: [{ type: 'text', text: `No results found for: "${input.query}"` }] };
    }

    const formatted = results
      .map((r, i) => {
        const score = (r.score * 100).toFixed(1);
        const date = r.chunk.timestamp ? new Date(r.chunk.timestamp).toLocaleDateString() : 'unknown';
        return [
          `**Result ${i + 1}** (${score}%) — ${date}`,
          `Session: ${r.chunk.sessionId}`,
          r.chunk.project ? `Project: ${r.chunk.project}` : '',
          '',
          `**User:** ${r.chunk.userMessage.slice(0, 300)}`,
          '',
          `**Assistant:** ${r.chunk.assistantMessage.slice(0, 500)}${r.chunk.assistantMessage.length > 500 ? '...' : ''}`,
        ].filter(Boolean).join('\n');
      })
      .join('\n\n---\n\n');

    return { content: [{ type: 'text', text: `Found ${results.length} result(s) for "${input.query}":\n\n${formatted}` }] };
  }
);

// ── agenthouse_recall ─────────────────────────────────────────────────────────

server.tool(
  'agenthouse_recall',
  "Recall a specific past conversation. Use when the user says 'that time I asked about...' or 'remember when we discussed...'",
  {
    description: z.string().describe('Description of the interaction to find'),
    userId: z.string().optional(),
  },
  async (input) => {
    const results = await queryEngine.recall(input.description, {
      userId: input.userId,
      limit: 3,
    });

    if (results.length === 0) {
      return { content: [{ type: 'text', text: `Could not find a conversation matching: "${input.description}"` }] };
    }

    const formatted = results
      .map((r, i) => {
        const date = r.chunk.timestamp ? new Date(r.chunk.timestamp).toLocaleDateString() : 'unknown';
        return [
          `**Match ${i + 1}** — ${date}`,
          `Session: ${r.chunk.sessionId}`,
          '',
          `**User:** ${r.chunk.userMessage}`,
          '',
          `**Assistant:** ${r.chunk.assistantMessage.slice(0, 800)}${r.chunk.assistantMessage.length > 800 ? '...' : ''}`,
        ].join('\n');
      })
      .join('\n\n---\n\n');

    return { content: [{ type: 'text', text: formatted }] };
  }
);

// ── agenthouse_list ───────────────────────────────────────────────────────────

server.tool(
  'agenthouse_list',
  'List sessions, users, or projects in the warehouse.',
  {
    entity: z.enum(['sessions', 'users', 'projects']).describe('What to list'),
    userId: z.string().optional(),
    project: z.string().optional(),
    limit: z.number().optional().default(20),
  },
  async (input) => {
    if (input.entity === 'sessions') {
      const sessions = await database.listSessions({
        userId: input.userId,
        project: input.project,
        limit: input.limit,
      });
      if (sessions.length === 0) return { content: [{ type: 'text', text: 'No sessions found.' }] };

      const lines = sessions.map(
        (s) => `• ${s.sessionId} | ${s.agentType} | ${s.startedAt.slice(0, 10)} | user: ${s.userId}${s.project ? ` | ${s.project}` : ''}`
      );
      return { content: [{ type: 'text', text: `${sessions.length} session(s):\n\n${lines.join('\n')}` }] };
    }

    if (input.entity === 'users') {
      const sessions = await database.listSessions({ limit: 1000 });
      const users = [...new Set(sessions.map((s) => s.userId))];
      return { content: [{ type: 'text', text: users.length ? users.map((u) => `• ${u}`).join('\n') : 'No users found.' }] };
    }

    // projects
    const sessions = await database.listSessions({ userId: input.userId, limit: 1000 });
    const projects = [...new Set(sessions.map((s) => s.project).filter(Boolean))];
    return { content: [{ type: 'text', text: projects.length ? projects.map((p) => `• ${p}`).join('\n') : 'No projects found.' }] };
  }
);

// ── agenthouse_context ────────────────────────────────────────────────────────

server.tool(
  'agenthouse_context',
  'Retrieve the full context window for a specific session. Use after search/recall to get complete details.',
  {
    sessionId: z.string().describe('The session ID to retrieve'),
  },
  async (input) => {
    const session = await database.getSession(input.sessionId);
    if (!session) {
      return { content: [{ type: 'text', text: `Session not found: ${input.sessionId}` }] };
    }

    const lines: string[] = [
      `Session: ${session.sessionId}`,
      `User: ${session.userId} | Agent: ${session.agentType}`,
      `Project: ${session.project ?? 'N/A'}`,
      `Started: ${session.startedAt} | Messages: ${session.messages.length}`,
      '',
      '--- Conversation ---',
      '',
    ];

    for (const msg of session.messages) {
      lines.push(`[${msg.role.toUpperCase()}]: ${msg.content}`);
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          lines.push(`  → Tool: ${tc.name}`);
        }
      }
      lines.push('');
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── Start stdio transport ─────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
