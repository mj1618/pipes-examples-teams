import { Command } from "commander";
import { registerInitCommand } from "./commands/init.js";
import { registerStartCommand } from "./commands/start.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerSendCommand } from "./commands/send.js";
import { registerStopCommand } from "./commands/stop.js";
import { registerLogsCommand } from "./commands/logs.js";
import { registerTerminalCommand } from "./commands/terminal.js";
import { registerBroadcastCommand } from "./commands/broadcast.js";
import { registerValidateCommand } from "./commands/validate.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("agent-teams")
    .description("Multi-agent Claude coordination using ppz for messaging")
    .version("0.1.0");

  registerInitCommand(program);
  registerStartCommand(program);
  registerStatusCommand(program);
  registerSendCommand(program);
  registerStopCommand(program);
  registerLogsCommand(program);
  registerTerminalCommand(program);
  registerBroadcastCommand(program);
  registerValidateCommand(program);

  return program;
}
