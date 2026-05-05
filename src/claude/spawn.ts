import { execa, type ResultPromise } from "execa";
import { buildWorkerPrompt, buildCoordinatorPrompt } from "./agent-prompt.js";
import type { WorkerConfigType } from "../types/config.js";

export interface SpawnedAgent {
  handle: string;
  process: ResultPromise;
  pid: number | undefined;
}

/**
 * Spawn a Claude Code agent worker inside a ppz terminal share session.
 *
 * ppz terminal share creates the source and binds:
 * - stdout → <handle>.stdout (observable via ppz terminal read)
 * - stdin  ← <handle>.stdin  (can send input via ppz send <handle>.stdin)
 *
 * Claude runs in -p (print) mode with a comprehensive system prompt
 * that includes ppz communication instructions. The agent does its work
 * in a single autonomous turn.
 */
export function spawnWorkerAgent(
  config: WorkerConfigType,
  coordinatorHandle: string,
  opts?: { workingDir?: string; dangerouslySkipPermissions?: boolean },
): SpawnedAgent {
  const systemPrompt = buildWorkerPrompt(config, coordinatorHandle);
  const workingDir = opts?.workingDir || config.workingDir || process.cwd();

  // Build claude command arguments
  const claudeArgs = [
    "--system-prompt", systemPrompt,
    "--model", config.model || "sonnet",
    "--allowedTools", config.allowedTools || "Bash,Read,Edit,Write,Glob,Grep",
    "-p",  // Print mode: process prompt, do work, exit
    `You are worker "${config.handle}". Check your inbox with: ppz read inbox\nIf your inbox is empty, your task is defined in your system prompt - proceed with it immediately.\nWhen done, report completion via: ppz send ${coordinatorHandle} '{"type":"task.status","from":"${config.handle}","status":"completed","detail":"<what you did>"}'`,
  ];

  if (opts?.dangerouslySkipPermissions) {
    claudeArgs.push("--dangerously-skip-permissions");
  }

  // Spawn via ppz terminal share so the session is observable
  const proc = execa("ppz", [
    "terminal", "share", config.handle,
    "--",
    "claude", ...claudeArgs,
  ], {
    cwd: workingDir,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    detached: false,
  });

  return {
    handle: config.handle,
    process: proc,
    pid: proc.pid,
  };
}

/**
 * Spawn a Claude Code agent as coordinator inside ppz terminal share.
 */
export function spawnCoordinatorAgent(
  teamName: string,
  coordinatorHandle: string,
  workerHandles: string[],
  goal: string,
  opts?: {
    model?: string;
    workingDir?: string;
    customPrompt?: string;
    dangerouslySkipPermissions?: boolean;
  },
): SpawnedAgent {
  const systemPrompt = buildCoordinatorPrompt(
    teamName,
    workerHandles,
    coordinatorHandle,
    opts?.customPrompt,
  );

  const claudeArgs = [
    "--system-prompt", systemPrompt,
    "--model", opts?.model || "opus",
    "--allowedTools", "Bash,Read,Edit,Write,Glob,Grep",
    "-p",  // Print mode: process goal, delegate, monitor, exit
    `Goal: ${goal}\n\nYour workers are: ${workerHandles.join(", ")}\nThey are already running and waiting for tasks in their inboxes.\nDelegate tasks now using: ppz send <worker-handle> '<json task>'\nAfter delegating, poll their broadcasts and your inbox for status updates.\nWhen all workers report completion, verify the work and broadcast the final result.`,
  ];

  if (opts?.dangerouslySkipPermissions) {
    claudeArgs.push("--dangerously-skip-permissions");
  }

  const proc = execa("ppz", [
    "terminal", "share", coordinatorHandle,
    "--",
    "claude", ...claudeArgs,
  ], {
    cwd: opts?.workingDir || process.cwd(),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    detached: false,
  });

  return {
    handle: coordinatorHandle,
    process: proc,
    pid: proc.pid,
  };
}

/**
 * Spawn a plain Claude agent (no ppz terminal share) - useful for non-interactive coordination.
 */
export function spawnClaudeHeadless(
  prompt: string,
  opts?: {
    model?: string;
    workingDir?: string;
    systemPrompt?: string;
    dangerouslySkipPermissions?: boolean;
  },
): ResultPromise {
  const args: string[] = [];

  if (opts?.systemPrompt) {
    args.push("--system-prompt", opts.systemPrompt);
  }
  if (opts?.model) {
    args.push("--model", opts.model);
  }
  if (opts?.dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions");
  }
  args.push("-p", prompt);

  return execa("claude", args, {
    cwd: opts?.workingDir || process.cwd(),
  });
}
