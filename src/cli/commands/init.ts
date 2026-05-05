import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import chalk from "chalk";
import type { Command } from "commander";

const EXAMPLE_CONFIG = `# Agent Teams Configuration
name: "my-team"
workingDir: "."

coordinator:
  model: "opus"
  systemPrompt: |
    You are the lead coordinator. Break down the goal into tasks,
    delegate to workers, and ensure quality.

workers:
  - handle: "dev-1"
    model: "sonnet"
    workingDir: "."
    systemPrompt: |
      You are a general-purpose developer. Complete your assigned tasks
      efficiently and report back to the coordinator.

  - handle: "dev-2"
    model: "sonnet"
    workingDir: "."
    systemPrompt: |
      You are a developer focused on testing and quality assurance.
      Write tests, review code, and ensure correctness.

settings:
  pollIntervalMs: 2000
  terminalSharing: true
`;

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Create a team configuration file")
    .option("-n, --name <name>", "Team name", "my-team")
    .option("-w, --workers <count>", "Number of workers", "2")
    .option("-o, --output <path>", "Output file path", "team.yaml")
    .action(async (opts) => {
      const outputPath = resolve(opts.output);

      let config = EXAMPLE_CONFIG;
      if (opts.name !== "my-team") {
        config = config.replace('name: "my-team"', `name: "${opts.name}"`);
      }

      await writeFile(outputPath, config);
      console.log(chalk.green(`✅ Created team config: ${outputPath}`));
      console.log(chalk.gray(`\n   Edit the file to customize your team, then run:`));
      console.log(chalk.gray(`   agent-teams start ${opts.output}\n`));
    });
}
