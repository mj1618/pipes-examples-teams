import chalk from "chalk";
import type { Command } from "commander";
import { loadSession } from "../../core/session.js";
import { sendTask, sendChat } from "../../core/coordinator.js";

export function registerSendCommand(program: Command): void {
  program
    .command("send")
    .description("Send a message or task to a worker")
    .argument("<target>", "Worker handle to send to")
    .argument("<message>", "Message or task description")
    .option("-t, --task", "Send as a formal task assignment (default)")
    .option("-c, --chat", "Send as an informal chat message")
    .option("--context <ctx>", "Additional context for the task")
    .option("--priority <level>", "Task priority: low, normal, high", "normal")
    .action(async (target, message, opts) => {
      const session = await loadSession();
      if (!session) {
        console.log(chalk.red("❌ No active team session. Run 'agent-teams start' first."));
        process.exit(1);
      }

      const fromHandle = session.coordinatorHandle;

      if (opts.chat) {
        await sendChat(target, message, fromHandle);
        console.log(chalk.green(`✓ Chat sent to ${target}: "${message}"`));
      } else {
        const taskId = await sendTask(target, message, fromHandle, {
          context: opts.context,
          priority: opts.priority,
        });
        console.log(chalk.green(`✓ Task assigned to ${target} (task-id: ${taskId})`));
        console.log(chalk.gray(`  Description: "${message}"`));
      }
    });
}
