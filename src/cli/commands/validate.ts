import chalk from "chalk";
import type { Command } from "commander";
import { loadTeamConfig } from "../../core/team.js";
import { ppz } from "../../ppz/client.js";

export function registerValidateCommand(program: Command): void {
  program
    .command("validate")
    .description("Validate a team config and check ppz connectivity")
    .argument("<config>", "Path to team config file")
    .action(async (configPath) => {
      console.log(chalk.blue("\n🔍 Validating team configuration...\n"));

      // 1. Validate config
      try {
        const config = await loadTeamConfig(configPath);
        console.log(chalk.green(`  ✓ Config is valid`));
        console.log(chalk.gray(`    Name: ${config.name}`));
        console.log(chalk.gray(`    Workers: ${config.workers.length}`));
        for (const w of config.workers) {
          console.log(chalk.gray(`      - ${w.handle} (model: ${w.model})`));
        }
      } catch (err: any) {
        console.log(chalk.red(`  ✗ Config validation failed: ${err.message}`));
        process.exit(1);
      }

      // 2. Check ppz daemon
      console.log("");
      try {
        const status = await ppz.status();
        if (status.includes("logged in")) {
          console.log(chalk.green(`  ✓ ppz daemon is running and logged in`));
        } else {
          console.log(chalk.yellow(`  ⚠ ppz daemon status: ${status}`));
        }
      } catch {
        console.log(chalk.red(`  ✗ ppz daemon is not reachable`));
        process.exit(1);
      }

      // 3. Check claude CLI is available
      try {
        const { execa } = await import("execa");
        const result = await execa("claude", ["--version"]);
        console.log(chalk.green(`  ✓ claude CLI available: ${result.stdout.trim()}`));
      } catch {
        console.log(chalk.red(`  ✗ claude CLI not found in PATH`));
        process.exit(1);
      }

      console.log(chalk.green(`\n✅ All checks passed. Ready to start!\n`));
    });
}
