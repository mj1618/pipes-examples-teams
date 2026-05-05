import chalk from "chalk";
import type { Command } from "commander";
import { loadTeamConfig, createQuickConfig } from "../../core/team.js";
import { startTeam } from "../../core/coordinator.js";
import { loadSession } from "../../core/session.js";

export function registerStartCommand(program: Command): void {
  program
    .command("start")
    .description("Start a team from a config file or with quick options")
    .argument("[config]", "Path to team config file (yaml/json)")
    .option("-g, --goal <goal>", "Goal for the AI coordinator to accomplish")
    .option("-n, --name <name>", "Team name (for quick start without config)", "team")
    .option("-w, --workers <count>", "Number of workers (for quick start)", "2")
    .option("-m, --model <model>", "Model for workers (sonnet/opus/haiku)", "sonnet")
    .option("--ai-coordinator", "Use an AI agent as coordinator (otherwise manual)")
    .option("--dangerously-skip-permissions", "Skip permission prompts for all agents")
    .option("--dry-run", "Validate and set up ppz sources but don't spawn agents")
    .action(async (configPath, opts) => {
      // Check for existing session
      const existingSession = await loadSession();
      if (existingSession) {
        console.log(chalk.red(`❌ A team is already running: "${existingSession.teamName}"`));
        console.log(chalk.gray(`   Run 'agent-teams stop' first, or delete .agent-teams-session.json`));
        process.exit(1);
      }

      let config;
      if (configPath) {
        // Load from file
        try {
          config = await loadTeamConfig(configPath);
        } catch (err: any) {
          console.error(chalk.red(`❌ Failed to load config: ${err.message}`));
          process.exit(1);
        }
      } else {
        // Quick start mode
        config = createQuickConfig({
          name: opts.name,
          workerCount: parseInt(opts.workers),
          model: opts.model,
        });
      }

      const team = await startTeam(config, {
        goal: opts.goal,
        aiCoordinator: opts.aiCoordinator || !!opts.goal,
        dangerouslySkipPermissions: opts.dangerouslySkipPermissions,
        workingDir: process.cwd(),
        dryRun: opts.dryRun,
      });

      // Keep process alive to maintain pollers
      if (opts.goal || opts.aiCoordinator) {
        console.log(chalk.gray("   Press Ctrl+C to stop the team.\n"));

        const cleanup = async () => {
          for (const poller of team.pollers) {
            poller.stop();
          }
          process.exit(0);
        };

        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);

        // Wait for all worker processes to finish
        await Promise.allSettled(
          team.workers.map(w => w.process),
        );
      }
    });
}
