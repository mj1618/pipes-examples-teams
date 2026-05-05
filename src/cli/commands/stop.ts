import chalk from "chalk";
import type { Command } from "commander";
import { loadSession } from "../../core/session.js";
import { stopTeam } from "../../core/coordinator.js";

export function registerStopCommand(program: Command): void {
  program
    .command("stop")
    .description("Stop the running team and clean up")
    .option("--force", "Force kill processes (SIGKILL)")
    .action(async (opts) => {
      const session = await loadSession();
      if (!session) {
        console.log(chalk.yellow("No active team session found."));
        return;
      }

      await stopTeam(session);
    });
}
