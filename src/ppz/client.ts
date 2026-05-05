import { execa, type ResultPromise } from "execa";

export interface PipeInfo {
  pipe: string;
  unread: number;
  buffered: number;
  last: string;
  payload: string;
}

export interface ReadOptions {
  json?: boolean;
  tail?: boolean;
  raw?: boolean;
  tty?: boolean;
}

export interface RereadOptions {
  limit?: number;
  skip?: number;
  since?: string;
  json?: boolean;
  raw?: boolean;
  tty?: boolean;
}

export interface PipeCreateOptions {
  ttl?: string;
  maxMsgs?: number;
  maxBytes?: number;
}

/**
 * Typed wrapper around the ppz CLI tool.
 * All agent communication flows through this client.
 */
export class PpzClient {
  /**
   * Create a new ppz source (addressable entity)
   */
  async sourceCreate(handle: string): Promise<void> {
    try {
      await execa("ppz", ["source", "create", handle]);
    } catch (err: any) {
      // Source might already exist - try switching instead
      if (err.stderr?.includes("already exists") || err.exitCode === 1) {
        await this.sourceSwitch(handle);
      } else {
        throw err;
      }
    }
  }

  /**
   * Switch the current source context
   */
  async sourceSwitch(handle: string): Promise<void> {
    await execa("ppz", ["source", "switch", handle]);
  }

  /**
   * Clear the current source selection
   */
  async sourceClear(): Promise<void> {
    await execa("ppz", ["source", "clear"]);
  }

  /**
   * Create a pipe on a source
   */
  async pipeCreate(name: string, opts?: PipeCreateOptions): Promise<void> {
    const args = ["pipe", "create", name];
    if (opts?.ttl) args.push(`--ttl=${opts.ttl}`);
    if (opts?.maxMsgs) args.push(`--max-msgs=${opts.maxMsgs}`);
    if (opts?.maxBytes) args.push(`--max-bytes=${opts.maxBytes}`);
    try {
      await execa("ppz", args);
    } catch (err: any) {
      // Pipe might already exist
      if (!err.stderr?.includes("already exists")) {
        throw err;
      }
    }
  }

  /**
   * Destroy a pipe
   */
  async pipeDestroy(name: string): Promise<void> {
    try {
      await execa("ppz", ["pipe", "destroy", name]);
    } catch {
      // Ignore if pipe doesn't exist
    }
  }

  /**
   * Send a message to a target (handle.pipe or just handle for .inbox)
   */
  async send(target: string, payload: string | object): Promise<void> {
    const data = typeof payload === "string" ? payload : JSON.stringify(payload);
    await execa("ppz", ["send", target, data]);
  }

  /**
   * Read new messages from a pipe (advances cursor)
   */
  async read(target: string, opts?: ReadOptions): Promise<string> {
    const args = ["read", target];
    if (opts?.json) args.push("--json");
    if (opts?.raw) args.push("--raw");
    if (opts?.tty) args.push("--tty");
    try {
      const result = await execa("ppz", args);
      return result.stdout;
    } catch {
      return "";
    }
  }

  /**
   * Read messages as parsed JSON objects.
   * ppz returns messages wrapped in an envelope: { id, handle, payload (string), created_at }
   * This method unwraps the payload for you.
   */
  async readMessages(target: string): Promise<any[]> {
    const output = await this.read(target, { json: true });
    if (!output.trim()) return [];
    return output.trim().split("\n").map((line) => {
      try {
        const envelope = JSON.parse(line);
        // ppz wraps the payload as a JSON string inside an envelope
        if (envelope.payload && typeof envelope.payload === "string") {
          try {
            return JSON.parse(envelope.payload);
          } catch {
            return { type: "raw", body: envelope.payload, _envelope: envelope };
          }
        }
        return envelope;
      } catch {
        return { type: "raw", body: line };
      }
    });
  }

  /**
   * Reread messages (forensic replay, doesn't advance cursor)
   */
  async reread(target: string, opts?: RereadOptions): Promise<string> {
    const args = ["reread", target];
    if (opts?.limit) args.push("-l", String(opts.limit));
    if (opts?.skip) args.push("--skip", String(opts.skip));
    if (opts?.since) args.push("--since", opts.since);
    if (opts?.json) args.push("--json");
    if (opts?.raw) args.push("--raw");
    if (opts?.tty) args.push("--tty");
    try {
      const result = await execa("ppz", args);
      return result.stdout;
    } catch {
      return "";
    }
  }

  /**
   * Broadcast a message on the current source
   */
  async broadcast(message: string): Promise<void> {
    await execa("ppz", ["broadcast", "-m", message]);
  }

  /**
   * Start a terminal share session (returns the child process)
   */
  terminalShare(handle: string, cmd?: string[]): ResultPromise {
    const args = ["terminal", "share", handle];
    if (cmd && cmd.length > 0) {
      args.push("--", ...cmd);
    }
    return execa("ppz", args, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  }

  /**
   * Read the current terminal screen state for a source
   */
  async terminalRead(handle: string, opts?: { raw?: boolean }): Promise<string> {
    const args = ["terminal", "read", handle];
    if (opts?.raw) args.push("--raw");
    try {
      const result = await execa("ppz", args);
      return result.stdout;
    } catch {
      return "";
    }
  }

  /**
   * List all sources and pipes
   */
  async ls(): Promise<PipeInfo[]> {
    try {
      const result = await execa("ppz", ["ls"]);
      const lines = result.stdout.trim().split("\n");
      // Skip header line
      return lines.slice(1).map((line) => {
        const parts = line.trim().split(/\s{2,}/);
        return {
          pipe: parts[0] || "",
          unread: parseInt(parts[1] || "0"),
          buffered: parseInt(parts[2] || "0"),
          last: parts[3] || "-",
          payload: parts[4] || "-",
        };
      }).filter(p => p.pipe);
    } catch {
      return [];
    }
  }

  /**
   * Get daemon status
   */
  async status(): Promise<string> {
    try {
      const result = await execa("ppz", ["status"]);
      return result.stdout;
    } catch (err: any) {
      return err.stderr || "ppz daemon not running";
    }
  }
}

// Singleton instance
export const ppz = new PpzClient();
