import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

const SESSION_FILE = ".agent-teams-session.json";

export interface SessionState {
  teamName: string;
  coordinatorHandle: string;
  coordinatorPid?: number;
  workers: Array<{
    handle: string;
    pid?: number;
    startedAt: string;
  }>;
  startedAt: string;
  workingDir: string;
}

/**
 * Get the session file path for the current working directory.
 */
function sessionPath(dir?: string): string {
  return join(dir || process.cwd(), SESSION_FILE);
}

/**
 * Save the active session state to disk.
 */
export async function saveSession(state: SessionState, dir?: string): Promise<void> {
  await writeFile(sessionPath(dir), JSON.stringify(state, null, 2));
}

/**
 * Load the active session state from disk.
 */
export async function loadSession(dir?: string): Promise<SessionState | null> {
  try {
    const data = await readFile(sessionPath(dir), "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Remove the session file (on stop/cleanup).
 */
export async function clearSession(dir?: string): Promise<void> {
  try {
    await unlink(sessionPath(dir));
  } catch {
    // File might not exist
  }
}

/**
 * Check if a process is still running by its PID.
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
