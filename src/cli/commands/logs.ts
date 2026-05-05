import chalk from "chalk";
import type { Command } from "commander";
import { loadSession } from "../../core/session.js";
import { ppz } from "../../ppz/client.js";

export function registerLogsCommand(program: Command): void {
  program
    .command("logs")
    .description("View team broadcast logs and messages")
    .argument("[worker]", "Specific worker to view logs for (or 'all')")
    .option("-n, --lines <count>", "Number of recent messages to show", "20")
    .option("--inbox", "Show inbox messages instead of broadcasts")
    .option("--since <duration>", "Show messages since duration (e.g. 5m, 1h)")
    .action(async (worker, opts) => {
      const session = await loadSession();
      if (!session) {
        console.log(chalk.red("❌ No active team session. Run 'agent-teams start' first."));
        process.exit(1);
      }

      const handles = worker && worker !== "all"
        ? [worker]
        : [...session.workers.map(w => w.handle), session.coordinatorHandle];

      const pipe = opts.inbox ? "inbox" : "broadcast";

      for (const handle of handles) {
        const target = `${handle}.${pipe}`;
        console.log(chalk.blue(`\n── ${target} ──`));

        const rereadOpts: any = {
          limit: parseInt(opts.lines),
          json: true,
        };
        if (opts.since) {
          rereadOpts.since = opts.since;
        }

        const output = await ppz.reread(target, rereadOpts);
        if (!output.trim()) {
          console.log(chalk.gray("  (no messages)"));
          continue;
        }

        const lines = output.trim().split("\n");
        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            const time = msg.timestamp
              ? new Date(msg.timestamp).toLocaleTimeString()
              : "";
            const from = msg.from ? chalk.cyan(`[${msg.from}]`) : "";
            const body = msg.body || msg.detail || msg.task?.description || line;
            console.log(`  ${chalk.gray(time)} ${from} ${body}`);
          } catch {
            console.log(`  ${line}`);
          }
        }
      }
      console.log("");
    });
}
