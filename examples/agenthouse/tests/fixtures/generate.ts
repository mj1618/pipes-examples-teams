/**
 * Synthetic fixture generator for Agenthouse tests.
 *
 * Generates fake sessions with plausible conversation content.
 * IMPORTANT: Only use synthetic data — never use real context windows.
 */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  output?: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolCalls: ToolCall[];
}

interface Session {
  sessionId: string;
  userId: string;
  agentType: string;
  project: string;
  startedAt: string;
  endedAt: string;
  messages: Message[];
  metadata: {
    model: string;
    tokenCount: number;
    tags: string[];
  };
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const TOPICS: Record<string, { turns: Array<[string, string]>; tags: string[] }> = {
  debugging: {
    tags: ['debugging', 'typescript', 'errors'],
    turns: [
      [
        "I'm getting a TypeScript error: 'Property does not exist on type'. How do I fix it?",
        "This error means you're trying to access a property that TypeScript doesn't know exists on that type. Common fixes: 1) Add the property to your interface/type definition, 2) Use a type assertion `(obj as MyType).property`, 3) Use optional chaining `obj?.property`. The safest fix is updating your types to accurately reflect the data shape.",
      ],
      [
        'The error is on `event.target.value` in a React onChange handler.',
        "For React input events, type the event parameter explicitly:\n\n```typescript\nconst handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {\n  const value = event.target.value;\n};\n```",
      ],
    ],
  },
  'git-workflow': {
    tags: ['git', 'branching', 'workflow'],
    turns: [
      [
        "What's a good git branching strategy for a small team of 4 developers?",
        "For a small team, GitHub Flow works well: one `main` branch that's always deployable, feature branches off main, pull requests for code review before merging. Keep branches short-lived with descriptive names like `feat/user-auth` or `fix/login-bug`.",
      ],
      [
        'How do I handle merge conflicts?',
        "Merge conflicts happen when two branches modify the same code. Resolution: 1) `git pull origin main`, 2) `git merge main` into your branch, 3) Look for conflict markers `<<<`, `===`, `>>>`, 4) Edit to keep correct code, remove markers, 5) `git add` resolved files, 6) `git commit`.",
      ],
    ],
  },
  performance: {
    tags: ['performance', 'optimization', 'profiling'],
    turns: [
      [
        'My React app is slow on initial load. How do I diagnose the problem?',
        "Use Chrome DevTools Performance tab and Lighthouse. Key things to check:\n1. Bundle size — run `npm run build` and check output\n2. Network waterfalls — look for render-blocking resources\n3. Unused code — use webpack-bundle-analyzer\n4. Images — unoptimized images are common culprit",
      ],
      [
        "The bundle is 4MB. That's too large, right?",
        "Yes, 4MB is large. Target under 200KB for initial load (compressed). Optimization strategies:\n1. Code splitting: `React.lazy()` + `Suspense`\n2. Tree shaking: import only what you need\n3. Dynamic imports for non-critical code\n4. Audit dependencies with `npx depcheck`",
      ],
    ],
  },
};

export function generateSession(topic: string, userId: string): Session {
  const topicData = TOPICS[topic] ?? TOPICS.debugging;
  const sessionId = `sess-${topic}-${generateId()}`;
  const startedAt = new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString();
  const endedAt = new Date(new Date(startedAt).getTime() + Math.random() * 60 * 60 * 1000).toISOString();

  const messages: Message[] = [];
  let timestamp = new Date(startedAt).getTime();

  for (const [userMsg, assistantMsg] of topicData.turns) {
    messages.push({
      role: 'user',
      content: userMsg,
      timestamp: new Date(timestamp).toISOString(),
      toolCalls: [],
    });
    timestamp += Math.floor(Math.random() * 30000) + 5000;

    messages.push({
      role: 'assistant',
      content: assistantMsg,
      timestamp: new Date(timestamp).toISOString(),
      toolCalls: [],
    });
    timestamp += Math.floor(Math.random() * 60000) + 10000;
  }

  const tokenCount = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);

  return {
    sessionId,
    userId,
    agentType: 'claude-code',
    project: `/Users/${userId}/projects/${topic}-project`,
    startedAt,
    endedAt,
    messages,
    metadata: {
      model: 'claude-sonnet-4',
      tokenCount,
      tags: topicData.tags,
    },
  };
}

function main() {
  const sessions = [
    generateSession('debugging', 'carol'),
    generateSession('git-workflow', 'dave'),
    generateSession('performance', 'eve'),
  ];

  for (const session of sessions) {
    const fileName = `session-generated-${session.sessionId.slice(5, 15)}.jsonl`;
    const filePath = join(__dirname, fileName);
    writeFileSync(filePath, JSON.stringify(session, null, 2));
    console.log(`Generated: ${filePath} (${session.messages.length} messages)`);
  }

  console.log(`\nGenerated ${sessions.length} synthetic test sessions.`);
  console.log('Remember: Use ONLY synthetic data — never real context windows!');
}

main();
