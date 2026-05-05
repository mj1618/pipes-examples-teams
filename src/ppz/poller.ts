import { ppz } from "./client.js";

export type MessageHandler = (messages: any[]) => void | Promise<void>;

/**
 * Polls a ppz pipe for new messages at a regular interval.
 * Uses `ppz read` which advances the cursor, so each poll only returns new messages.
 */
export class InboxPoller {
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private target: string,
    private onMessages: MessageHandler,
    private pollMs: number = 2000,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;

    this.interval = setInterval(async () => {
      if (!this.running) return;
      try {
        const messages = await ppz.readMessages(this.target);
        if (messages.length > 0) {
          await this.onMessages(messages);
        }
      } catch (err) {
        // Silently skip poll errors (daemon hiccup, etc)
      }
    }, this.pollMs);

    // Also do an immediate first poll
    this.poll();
  }

  async poll(): Promise<void> {
    try {
      const messages = await ppz.readMessages(this.target);
      if (messages.length > 0) {
        await this.onMessages(messages);
      }
    } catch {
      // Skip errors
    }
  }

  stop(): void {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }
}
