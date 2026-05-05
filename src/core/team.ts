import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { TeamConfig, type TeamConfigType } from "../types/config.js";

/**
 * Load and validate a team configuration file.
 */
export async function loadTeamConfig(filePath: string): Promise<TeamConfigType> {
  const absPath = resolve(filePath);
  const raw = await readFile(absPath, "utf-8");

  let parsed: unknown;
  if (absPath.endsWith(".json")) {
    parsed = JSON.parse(raw);
  } else {
    // Assume YAML
    parsed = parseYaml(raw);
  }

  return TeamConfig.parse(parsed);
}

/**
 * Create a minimal team config for quick starts.
 */
export function createQuickConfig(opts: {
  name: string;
  workerCount: number;
  workingDir?: string;
  model?: "opus" | "sonnet" | "haiku";
}): TeamConfigType {
  const workers = Array.from({ length: opts.workerCount }, (_, i) => ({
    handle: `worker-${i + 1}`,
    model: (opts.model || "sonnet") as "opus" | "sonnet" | "haiku",
    workingDir: opts.workingDir || ".",
  }));

  return TeamConfig.parse({
    name: opts.name,
    workingDir: opts.workingDir || ".",
    coordinator: { model: "opus" },
    workers,
  });
}
