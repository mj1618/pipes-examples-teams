import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { PpzClient } from "../src/ppz/client.js";

describe("PpzClient", () => {
  const ppz = new PpzClient();
  const testHandle = `test-ct-${Date.now()}`;

  before(async () => {
    // Ensure daemon is running
    const status = await ppz.status();
    assert.ok(status.includes("logged in"), "ppz daemon must be running and logged in");
  });

  after(async () => {
    // Cleanup: switch away and leave the source
    try {
      await ppz.sourceClear();
    } catch {}
  });

  it("should report daemon status", async () => {
    const status = await ppz.status();
    assert.ok(status.includes("daemon"));
  });

  it("should list existing pipes", async () => {
    const pipes = await ppz.ls();
    assert.ok(Array.isArray(pipes));
  });

  it("should create a source", async () => {
    await ppz.sourceCreate(testHandle);
    // Verify by listing
    const pipes = await ppz.ls();
    const found = pipes.some((p) => p.pipe.startsWith(testHandle));
    assert.ok(found, `Source ${testHandle} should appear in ls`);
  });

  it("should send and read messages", async () => {
    // Send a test message to a fresh pipe to avoid cursor issues
    const payload = { type: "chat", body: "hello from test", id: "test-1", from: "test", timestamp: new Date().toISOString() };
    await ppz.send(`${testHandle}.inbox`, payload);

    // Use readMessages which now unwraps the ppz envelope
    const messages = await ppz.readMessages(`${testHandle}.inbox`);
    assert.ok(messages.length > 0, "Should have received at least one message");

    // Find our message (there may be others if test ran before)
    const found = messages.find((m: any) => m.body === "hello from test");
    assert.ok(found, "Should find our test message");
    assert.strictEqual(found.type, "chat");
    assert.strictEqual(found.body, "hello from test");
  });

  it("should broadcast messages", async () => {
    await ppz.sourceSwitch(testHandle);
    await ppz.broadcast("test broadcast message");

    // Reread to verify
    const output = await ppz.reread(`${testHandle}.broadcast`, { limit: 1, json: true });
    assert.ok(output.includes("test broadcast message"), "Broadcast should be retrievable");
  });

  it("should reread with limit", async () => {
    // Send multiple messages
    await ppz.send(`${testHandle}.inbox`, { type: "chat", body: "msg1", id: "m1", from: "test", timestamp: new Date().toISOString() });
    await ppz.send(`${testHandle}.inbox`, { type: "chat", body: "msg2", id: "m2", from: "test", timestamp: new Date().toISOString() });

    // Reread with limit
    const output = await ppz.reread(`${testHandle}.inbox`, { limit: 1, json: true });
    const lines = output.trim().split("\n").filter(Boolean);
    assert.strictEqual(lines.length, 1, "Should only get 1 message with limit=1");
  });
});
