import { describe, it } from "node:test";
import assert from "node:assert";
import { execa } from "execa";
import { resolve } from "node:path";

const PROJECT_DIR = resolve(import.meta.dirname, "..");
const CLI = resolve(PROJECT_DIR, "bin/agent-teams.ts");
const TSX = resolve(PROJECT_DIR, "node_modules/.bin/tsx");

async function run(...args: string[]) {
  return execa(TSX, [CLI, ...args], { reject: false, cwd: PROJECT_DIR });
}

async function runInDir(dir: string, ...args: string[]) {
  return execa(TSX, [CLI, ...args], { reject: false, cwd: dir });
}

describe("CLI commands", () => {
  it("should show help", async () => {
    const result = await run("--help");
    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.stdout.includes("Multi-agent Claude coordination"));
    assert.ok(result.stdout.includes("init"));
    assert.ok(result.stdout.includes("start"));
    assert.ok(result.stdout.includes("status"));
    assert.ok(result.stdout.includes("send"));
    assert.ok(result.stdout.includes("stop"));
  });

  it("should show version", async () => {
    const result = await run("--version");
    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.stdout.includes("0.1.0"));
  });

  it("init should create a config file", async () => {
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = await mkdtemp(join(tmpdir(), "ct-cli-"));
    const output = join(dir, "test-team.yaml");

    const result = await run("init", "--name", "cli-test", "--output", output);
    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.stdout.includes("Created team config"));

    const content = await readFile(output, "utf-8");
    assert.ok(content.includes("cli-test"));
    assert.ok(content.includes("workers"));

    await rm(dir, { recursive: true, force: true });
  });

  it("status should report no active session", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = await mkdtemp(join(tmpdir(), "ct-status-"));
    const result = await runInDir(dir, "status");
    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.stdout.includes("No active team session"));

    await rm(dir, { recursive: true, force: true });
  });

  it("send should fail without active session", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = await mkdtemp(join(tmpdir(), "ct-send-"));
    const result = await runInDir(dir, "send", "worker-1", "do something");
    assert.strictEqual(result.exitCode, 1);
    assert.ok(result.stdout.includes("No active team session"));

    await rm(dir, { recursive: true, force: true });
  });

  it("stop should handle no active session gracefully", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = await mkdtemp(join(tmpdir(), "ct-stop-"));
    const result = await runInDir(dir, "stop");
    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.stdout.includes("No active team session"));

    await rm(dir, { recursive: true, force: true });
  });
});
