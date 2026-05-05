import { describe, it, after } from "node:test";
import assert from "node:assert";
import { PpzClient } from "../src/ppz/client.js";
import { InboxPoller } from "../src/ppz/poller.js";
import { sendTask, sendChat } from "../src/core/coordinator.js";

describe("Integration: multi-agent messaging", () => {
  const ppz = new PpzClient();
  const leadHandle = `integ-lead-${Date.now()}`;
  const workerHandle = `integ-worker-${Date.now()}`;

  after(async () => {
    // Cleanup: destroy test sources and their pipes (ppz v0.21.0+)
    try {
      await ppz.sourceClear();
      await ppz.sourceDestroy(leadHandle);
      await ppz.sourceDestroy(workerHandle);
    } catch {}
  });

  it("should set up sources for lead and worker", async () => {
    await ppz.sourceCreate(leadHandle);
    await ppz.sourceCreate(workerHandle);

    // Verify sources exist by trying to send/read (more reliable than parsing ls)
    // Sending to a non-existent source would throw
    await ppz.send(`${leadHandle}.inbox`, { type: "chat", body: "source check", id: "check", from: "test", timestamp: new Date().toISOString() });
    await ppz.send(`${workerHandle}.inbox`, { type: "chat", body: "source check", id: "check", from: "test", timestamp: new Date().toISOString() });
    // Drain these setup messages
    await ppz.read(`${leadHandle}.inbox`);
    await ppz.read(`${workerHandle}.inbox`);
  });

  it("should send a task from lead to worker", async () => {
    const taskId = await sendTask(workerHandle, "Write a hello world script", leadHandle, {
      context: "Use Python",
      priority: "high",
    });

    assert.ok(taskId, "Should return a task ID");
    assert.ok(taskId.length > 0);
  });

  it("should receive the task in worker inbox", async () => {
    const messages = await ppz.readMessages(`${workerHandle}.inbox`);
    assert.ok(messages.length > 0, "Worker should have messages");

    const taskMsg = messages.find((m: any) => m.type === "task.assign");
    assert.ok(taskMsg, "Should find a task.assign message");
    assert.strictEqual(taskMsg.task.description, "Write a hello world script");
    assert.strictEqual(taskMsg.task.priority, "high");
    assert.strictEqual(taskMsg.from, leadHandle);
  });

  it("should send a status reply from worker to lead", async () => {
    // Worker sends completion status back to lead
    await ppz.send(leadHandle, {
      type: "task.status",
      id: `msg-${Date.now()}`,
      from: workerHandle,
      timestamp: new Date().toISOString(),
      taskId: "the-task-id",
      status: "completed",
      detail: "Created hello.py with print statement",
    });

    // Lead reads its inbox
    const messages = await ppz.readMessages(`${leadHandle}.inbox`);
    const statusMsg = messages.find((m: any) => m.type === "task.status");
    assert.ok(statusMsg, "Lead should receive task.status");
    assert.strictEqual(statusMsg.status, "completed");
    assert.strictEqual(statusMsg.from, workerHandle);
  });

  it("should support chat between workers", async () => {
    await sendChat(workerHandle, "Can you review my code?", leadHandle);

    const messages = await ppz.readMessages(`${workerHandle}.inbox`);
    const chatMsg = messages.find((m: any) => m.type === "chat");
    assert.ok(chatMsg, "Should find chat message");
    assert.strictEqual(chatMsg.body, "Can you review my code?");
  });

  it("should support inbox polling with callback", async () => {
    const received: any[] = [];
    const poller = new InboxPoller(
      `${workerHandle}.inbox`,
      async (msgs) => { received.push(...msgs); },
      500,
    );

    // Send a message after a short delay
    setTimeout(async () => {
      await ppz.send(`${workerHandle}.inbox`, {
        type: "chat",
        id: `poll-test-${Date.now()}`,
        from: leadHandle,
        timestamp: new Date().toISOString(),
        body: "polling test message",
      });
    }, 200);

    poller.start();

    // Wait for the poller to pick it up
    await new Promise((resolve) => setTimeout(resolve, 2000));
    poller.stop();

    const found = received.find((m: any) => m.body === "polling test message");
    assert.ok(found, "Poller should have received the message");
  });

  it("should support broadcast on a source", async () => {
    await ppz.sourceSwitch(workerHandle);
    await ppz.broadcast("I'm working on the task");

    // Read broadcast from worker source
    const output = await ppz.reread(`${workerHandle}.broadcast`, { limit: 5, json: true });
    assert.ok(output.includes("I'm working on the task"), "Broadcast should be visible");
  });
});
