import chalk from "chalk";
import type { Command } from "commander";
import { loadSession } from "../../core/session.js";
import { ppz } from "../../ppz/client.js";

export function registerBroadcastCommand(program: Command): void {
  program
    .command("broadcast")
    .description("Broadcast a message to the whole team")
    .argument("<message>", "Message to broadcast")
    .action(async (message) => {
      const session = await loadSession();
      if (!session) {
        console.log(chalk.red("❌ No active team session. Run 'agent-teams start' first."));
        process.exit(1);
      }

      // Switch to coordinator source and broadcast
      await ppz.sourceSwitch(session.coordinatorHandle);
      await ppz.broadcast(message);
      console.log(chalk.green(`✓ Broadcast sent from ${session.coordinatorHandle}: "${message}"`));
    });
}
