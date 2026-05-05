import { describe, it } from "node:test";
import assert from "node:assert";
import { TeamConfig } from "../src/types/config.js";
import { createQuickConfig } from "../src/core/team.js";

describe("TeamConfig", () => {
  it("should validate a minimal config", () => {
    const config = TeamConfig.parse({
      name: "test-team",
      workers: [
        { handle: "dev-1" },
      ],
    });

    assert.strictEqual(config.name, "test-team");
    assert.strictEqual(config.workers.length, 1);
    assert.strictEqual(config.workers[0].handle, "dev-1");
    assert.strictEqual(config.workers[0].model, "sonnet"); // default
    assert.strictEqual(config.settings.pollIntervalMs, 2000); // default
  });

  it("should validate a full config", () => {
    const config = TeamConfig.parse({
      name: "full-team",
      workingDir: "/tmp/test",
      coordinator: {
        model: "opus",
        systemPrompt: "You are the lead.",
      },
      workers: [
        {
          handle: "dev-frontend",
          model: "sonnet",
          workingDir: "./frontend",
          systemPrompt: "Frontend dev",
          allowedTools: "Bash,Read,Edit",
        },
        {
          handle: "dev-backend",
          model: "opus",
          workingDir: "./backend",
          systemPrompt: "Backend dev",
        },
      ],
      settings: {
        pollIntervalMs: 1000,
        terminalSharing: true,
        maxBudgetPerWorker: 5.0,
      },
    });

    assert.strictEqual(config.workers.length, 2);
    assert.strictEqual(config.coordinator.model, "opus");
    assert.strictEqual(config.settings.pollIntervalMs, 1000);
  });

  it("should reject invalid handle", () => {
    assert.throws(() => {
      TeamConfig.parse({
        name: "test",
        workers: [{ handle: "Invalid Handle!" }],
      });
    });
  });

  it("should reject empty workers", () => {
    assert.throws(() => {
      TeamConfig.parse({
        name: "test",
        workers: [],
      });
    });
  });
});

describe("createQuickConfig", () => {
  it("should create a config with N workers", () => {
    const config = createQuickConfig({
      name: "quick-team",
      workerCount: 3,
      model: "haiku",
    });

    assert.strictEqual(config.name, "quick-team");
    assert.strictEqual(config.workers.length, 3);
    assert.strictEqual(config.workers[0].handle, "worker-1");
    assert.strictEqual(config.workers[2].handle, "worker-3");
    assert.strictEqual(config.workers[0].model, "haiku");
  });
});
