import chalk from "chalk";
import type { Command } from "commander";
import { loadSession } from "../../core/session.js";
import { ppz } from "../../ppz/client.js";
import { execa } from "execa";

export function registerTerminalCommand(program: Command): void {
  program
    .command("terminal")
    .description("View or interact with a worker's terminal")
    .argument("<worker>", "Worker handle to view")
    .option("--read", "Read current screen state (default for agents)")
    .option("--watch", "Open interactive terminal watcher (for humans)")
    .action(async (worker, opts) => {
      const session = await loadSession();
      if (!session) {
        console.log(chalk.red("❌ No active team session. Run 'agent-teams start' first."));
        process.exit(1);
      }

      // Verify worker exists
      const validHandles = [
        ...session.workers.map(w => w.handle),
        session.coordinatorHandle,
      ];
      if (!validHandles.includes(worker)) {
        console.log(chalk.red(`❌ Unknown worker: ${worker}`));
        console.log(chalk.gray(`   Available: ${validHandles.join(", ")}`));
        process.exit(1);
      }

      if (opts.watch) {
        // Interactive watch (for human users)
        console.log(chalk.gray(`Opening terminal watcher for ${worker}... (Ctrl+C to exit)\n`));
        try {
          await execa("ppz", ["terminal", "watch", worker], {
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
          });
        } catch {
          // Normal exit on Ctrl+C
        }
      } else {
        // Read current screen (for agents or quick check)
        const screen = await ppz.terminalRead(worker);
        if (screen) {
          console.log(chalk.blue(`\n── Terminal: ${worker} ──\n`));
          console.log(screen);
          console.log(chalk.blue(`\n── End ──\n`));
        } else {
          console.log(chalk.yellow(`No terminal output available for ${worker}`));
        }
      }
    });
}
