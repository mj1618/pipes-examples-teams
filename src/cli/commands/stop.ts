import chalk from "chalk";
import type { Command } from "commander";
import { loadSession } from "../../core/session.js";
import { stopTeam } from "../../core/coordinator.js";
import { ppz } from "../../ppz/client.js";

export function registerStopCommand(program: Command): void {
  program
    .command("stop")
    .description("Stop the running team and clean up ppz sources")
    .option("--force", "Force kill processes (SIGKILL)")
    .option("--clean <pattern>", "Destroy ppz sources matching a glob pattern (e.g. 'my-team-*')")
    .action(async (opts) => {
      // If --clean is used, destroy matching sources without needing an active session
      if (opts.clean) {
        console.log(chalk.yellow(`\n🧹 Destroying sources matching: ${opts.clean}`));
        await ppz.sourceDestroy(opts.clean);
        console.log(chalk.green(`✅ Done.\n`));
        return;
      }

      const session = await loadSession();
      if (!session) {
        console.log(chalk.yellow("No active team session found."));
        return;
      }

      await stopTeam(session);
    });
}
