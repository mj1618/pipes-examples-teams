import chalk from "chalk";
import type { Command } from "commander";
import { loadSession, isProcessRunning } from "../../core/session.js";
import { ppz } from "../../ppz/client.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show the current team status")
    .action(async () => {
      const session = await loadSession();
      if (!session) {
        console.log(chalk.yellow("No active team session found."));
        console.log(chalk.gray("  Run 'agent-teams start' to start a team."));
        return;
      }

      // Show daemon version (ppz v0.19.0+)
      const daemonVersion = await ppz.daemonVersion();

      console.log(chalk.blue(`\n📋 Team: "${session.teamName}"`));
      console.log(chalk.gray(`   Started: ${session.startedAt}`));
      console.log(chalk.gray(`   Working dir: ${session.workingDir}`));
      if (daemonVersion) {
        console.log(chalk.gray(`   ppz daemon: v${daemonVersion}`));
      }
      console.log("");

      // Coordinator status
      const coordAlive = session.coordinatorPid
        ? isProcessRunning(session.coordinatorPid)
        : false;
      const coordStatus = coordAlive
        ? chalk.green("● running")
        : session.coordinatorPid
          ? chalk.red("● stopped")
          : chalk.yellow("● manual mode");
      console.log(`   Coordinator (${session.coordinatorHandle}): ${coordStatus}`);

      // Worker statuses
      console.log(chalk.blue(`\n   Workers:`));
      for (const worker of session.workers) {
        const alive = worker.pid ? isProcessRunning(worker.pid) : false;
        const status = alive ? chalk.green("● running") : chalk.red("● stopped");
        console.log(`     ${worker.handle}: ${status} (pid: ${worker.pid || "?"})`);
      }

      // PPZ pipe info
      console.log(chalk.blue(`\n   Pipes (ppz ls):`));
      const pipes = await ppz.ls();
      const teamPipes = pipes.filter(p =>
        session.workers.some(w => p.pipe.startsWith(w.handle)) ||
        p.pipe.startsWith(session.coordinatorHandle)
      );

      if (teamPipes.length > 0) {
        for (const pipe of teamPipes) {
          const unreadIndicator = pipe.unread > 0 ? chalk.yellow(` (${pipe.unread} unread)`) : "";
          console.log(chalk.gray(`     ${pipe.pipe}${unreadIndicator}`));
        }
      } else {
        console.log(chalk.gray("     No pipes found for this team"));
      }

      console.log("");
    });
}
