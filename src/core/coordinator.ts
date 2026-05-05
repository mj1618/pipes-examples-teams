import { nanoid } from "nanoid";
import chalk from "chalk";
import { ppz } from "../ppz/client.js";
import { InboxPoller } from "../ppz/poller.js";
import { spawnWorkerAgent, spawnCoordinatorAgent, type SpawnedAgent } from "../claude/spawn.js";
import { saveSession, clearSession, type SessionState } from "./session.js";
import type { TeamConfigType, WorkerConfigType } from "../types/config.js";

export interface TeamInstance {
  coordinatorHandle: string;
  coordinator: SpawnedAgent | null;
  workers: SpawnedAgent[];
  pollers: InboxPoller[];
  session: SessionState;
}

/**
 * Generate a short unique suffix for this run to avoid ppz source conflicts.
 * ppz terminal share creates sources and they can't be reused.
 */
function runSuffix(): string {
  return nanoid(4).toLowerCase().replace(/[^a-z0-9]/g, "x");
}

/**
 * Start a full team: spawn workers via ppz terminal share, start coordination.
 *
 * IMPORTANT: ppz terminal share creates sources implicitly.
 * We append a run suffix to make handles unique per invocation.
 *
 * Two modes:
 * 1. AI coordinator: a Claude agent acts as coordinator, delegating and monitoring
 * 2. Manual coordinator: the user acts as coordinator, using CLI commands to delegate
 */
export async function startTeam(
  config: TeamConfigType,
  opts: {
    goal?: string;
    aiCoordinator?: boolean;
    dangerouslySkipPermissions?: boolean;
    workingDir?: string;
    dryRun?: boolean;
  },
): Promise<TeamInstance> {
  const suffix = runSuffix();
  const coordinatorHandle = `${config.name}-lead-${suffix}`;
  const workingDir = opts.workingDir || config.workingDir || process.cwd();
  const workers: SpawnedAgent[] = [];
  const pollers: InboxPoller[] = [];

  // Map config handles to actual runtime handles (with suffix)
  const handleMap = new Map<string, string>();
  for (const w of config.workers) {
    handleMap.set(w.handle, `${w.handle}-${suffix}`);
  }

  console.log(chalk.blue(`\n🚀 Starting team "${config.name}" (run: ${suffix})...\n`));

  // 1. Spawn worker agents via ppz terminal share (which creates sources)
  for (const workerConfig of config.workers) {
    const runtimeHandle = handleMap.get(workerConfig.handle)!;

    // Resolve working directory
    const workerDir = workerConfig.workingDir === "."
      ? workingDir
      : workerConfig.workingDir.startsWith("/")
        ? workerConfig.workingDir
        : `${workingDir}/${workerConfig.workingDir}`;

    if (!opts.dryRun) {
      console.log(chalk.green(`  ✓ Spawning worker: ${runtimeHandle} (model: ${workerConfig.model})`));
      const agent = spawnWorkerAgent(
        { ...workerConfig, handle: runtimeHandle, workingDir: workerDir },
        coordinatorHandle,
        {
          workingDir: workerDir,
          dangerouslySkipPermissions: opts.dangerouslySkipPermissions,
        },
      );
      workers.push(agent);
    } else {
      console.log(chalk.yellow(`  ⏸ [dry-run] Would spawn worker: ${runtimeHandle} (model: ${workerConfig.model})`));
    }

    // Start broadcast poller for this worker
    const poller = new InboxPoller(
      `${runtimeHandle}.broadcast`,
      async (messages) => {
        for (const msg of messages) {
          const preview = typeof msg === "string" ? msg : (msg.body || msg.detail || JSON.stringify(msg)).slice(0, 80);
          console.log(chalk.cyan(`  📢 [${workerConfig.handle}] ${preview}`));
        }
      },
      config.settings.pollIntervalMs,
    );
    pollers.push(poller);
  }

  // 2. Optionally spawn AI coordinator via ppz terminal share
  let coordinator: SpawnedAgent | null = null;
  if (opts.aiCoordinator && opts.goal && !opts.dryRun) {
    console.log(chalk.green(`  ✓ Spawning AI coordinator: ${coordinatorHandle} (model: ${config.coordinator.model})`));
    coordinator = spawnCoordinatorAgent(
      config.name,
      coordinatorHandle,
      Array.from(handleMap.values()),
      opts.goal,
      {
        model: config.coordinator.model,
        workingDir: workingDir,
        customPrompt: config.coordinator.systemPrompt,
        dangerouslySkipPermissions: opts.dangerouslySkipPermissions,
      },
    );
  } else if (opts.aiCoordinator && opts.goal && opts.dryRun) {
    console.log(chalk.yellow(`  ⏸ [dry-run] Would spawn AI coordinator: ${coordinatorHandle} (model: ${config.coordinator.model})`));
  } else if (!opts.aiCoordinator && !opts.dryRun) {
    // Manual mode: create coordinator source for sending messages
    await ppz.sourceCreate(coordinatorHandle);
  }

  // 3. Build session state
  const session: SessionState = {
    teamName: config.name,
    coordinatorHandle,
    coordinatorPid: coordinator?.pid,
    workers: workers.map((w, i) => ({
      handle: w.handle,
      pid: w.pid,
      startedAt: new Date().toISOString(),
    })),
    startedAt: new Date().toISOString(),
    workingDir,
  };

  // 4. Save session
  await saveSession(session, workingDir);

  // 5. Start broadcast pollers (wait a moment for sources to be created by terminal share)
  if (!opts.dryRun) {
    // Give terminal share processes a moment to create their sources
    await new Promise(resolve => setTimeout(resolve, 2000));
    for (const poller of pollers) {
      poller.start();
    }
  }

  console.log(chalk.blue(`\n✅ Team "${config.name}" is running!`));
  console.log(chalk.gray(`   Coordinator: ${coordinatorHandle}`));
  console.log(chalk.gray(`   Workers: ${Array.from(handleMap.values()).join(", ")}`));
  console.log(chalk.gray(`   Session saved to: .agent-teams-session.json\n`));

  if (!opts.aiCoordinator) {
    console.log(chalk.yellow(`   Manual mode — use these commands:`));
    console.log(chalk.gray(`     agent-teams send <worker-handle> "task description"`));
    console.log(chalk.gray(`     agent-teams status`));
    console.log(chalk.gray(`     agent-teams logs`));
    console.log(chalk.gray(`     agent-teams stop\n`));
  }

  return { coordinatorHandle, coordinator, workers, pollers, session };
}

/**
 * Send a task to a specific worker.
 */
export async function sendTask(
  workerHandle: string,
  description: string,
  fromHandle: string,
  opts?: { context?: string; priority?: "low" | "normal" | "high" },
): Promise<string> {
  const taskId = nanoid(8);
  const message = {
    type: "task.assign",
    id: nanoid(),
    from: fromHandle,
    timestamp: new Date().toISOString(),
    task: {
      id: taskId,
      description,
      context: opts?.context,
      priority: opts?.priority || "normal",
    },
  };

  await ppz.send(workerHandle, message);
  return taskId;
}

/**
 * Send a chat message to any handle.
 */
export async function sendChat(
  targetHandle: string,
  body: string,
  fromHandle: string,
): Promise<void> {
  const message = {
    type: "chat",
    id: nanoid(),
    from: fromHandle,
    timestamp: new Date().toISOString(),
    body,
  };
  await ppz.send(targetHandle, message);
}

/**
 * Stop all team processes and clean up.
 */
export async function stopTeam(session: SessionState): Promise<void> {
  console.log(chalk.yellow(`\n🛑 Stopping team "${session.teamName}"...\n`));

  // Kill worker processes
  for (const worker of session.workers) {
    if (worker.pid) {
      try {
        process.kill(worker.pid, "SIGTERM");
        console.log(chalk.gray(`  Stopped worker: ${worker.handle} (pid: ${worker.pid})`));
      } catch {
        console.log(chalk.gray(`  Worker already stopped: ${worker.handle}`));
      }
    }
  }

  // Kill coordinator
  if (session.coordinatorPid) {
    try {
      process.kill(session.coordinatorPid, "SIGTERM");
      console.log(chalk.gray(`  Stopped coordinator (pid: ${session.coordinatorPid})`));
    } catch {
      console.log(chalk.gray(`  Coordinator already stopped`));
    }
  }

  // Clear session file
  await clearSession(session.workingDir);
  console.log(chalk.green(`\n✅ Team "${session.teamName}" stopped.\n`));
}
