import { describe, it, after } from "node:test";
import assert from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveSession, loadSession, clearSession, type SessionState } from "../src/core/session.js";

describe("Session management", () => {
  let testDir: string;

  after(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("should save and load a session", async () => {
    testDir = await mkdtemp(join(tmpdir(), "ct-test-"));

    const session: SessionState = {
      teamName: "test-team",
      coordinatorHandle: "test-lead",
      coordinatorPid: 12345,
      workers: [
        { handle: "dev-1", pid: 12346, startedAt: "2024-01-01T00:00:00Z" },
        { handle: "dev-2", pid: 12347, startedAt: "2024-01-01T00:00:00Z" },
      ],
      startedAt: "2024-01-01T00:00:00Z",
      workingDir: testDir,
    };

    await saveSession(session, testDir);
    const loaded = await loadSession(testDir);

    assert.ok(loaded);
    assert.strictEqual(loaded.teamName, "test-team");
    assert.strictEqual(loaded.coordinatorHandle, "test-lead");
    assert.strictEqual(loaded.workers.length, 2);
    assert.strictEqual(loaded.workers[0].handle, "dev-1");
  });

  it("should return null for non-existent session", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "ct-empty-"));
    const loaded = await loadSession(emptyDir);
    assert.strictEqual(loaded, null);
    await rm(emptyDir, { recursive: true, force: true });
  });

  it("should clear a session", async () => {
    testDir = await mkdtemp(join(tmpdir(), "ct-clear-"));

    const session: SessionState = {
      teamName: "to-clear",
      coordinatorHandle: "lead",
      workers: [],
      startedAt: "2024-01-01T00:00:00Z",
      workingDir: testDir,
    };

    await saveSession(session, testDir);
    let loaded = await loadSession(testDir);
    assert.ok(loaded);

    await clearSession(testDir);
    loaded = await loadSession(testDir);
    assert.strictEqual(loaded, null);
  });
});
