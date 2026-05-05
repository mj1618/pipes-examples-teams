import { describe, it } from "node:test";
import assert from "node:assert";
import {
  TaskAssignMessage,
  TaskStatusMessage,
  WorkerReadyMessage,
  ChatMessage,
  AnyMessage,
} from "../src/types/messages.js";

describe("Message schemas", () => {
  it("should validate a TaskAssign message", () => {
    const msg = TaskAssignMessage.parse({
      type: "task.assign",
      id: "msg-1",
      from: "lead",
      timestamp: "2024-01-01T00:00:00Z",
      task: {
        id: "task-1",
        description: "Build the login page",
        priority: "high",
      },
    });

    assert.strictEqual(msg.type, "task.assign");
    assert.strictEqual(msg.task.id, "task-1");
    assert.strictEqual(msg.task.priority, "high");
  });

  it("should validate a TaskStatus message", () => {
    const msg = TaskStatusMessage.parse({
      type: "task.status",
      id: "msg-2",
      from: "dev-1",
      timestamp: "2024-01-01T00:00:00Z",
      taskId: "task-1",
      status: "completed",
      detail: "Login page is done",
    });

    assert.strictEqual(msg.status, "completed");
    assert.strictEqual(msg.detail, "Login page is done");
  });

  it("should validate a WorkerReady message", () => {
    const msg = WorkerReadyMessage.parse({
      type: "worker.ready",
      id: "msg-3",
      from: "dev-1",
      timestamp: "2024-01-01T00:00:00Z",
      capabilities: ["typescript", "react"],
    });

    assert.deepStrictEqual(msg.capabilities, ["typescript", "react"]);
  });

  it("should validate a Chat message", () => {
    const msg = ChatMessage.parse({
      type: "chat",
      id: "msg-4",
      from: "dev-1",
      timestamp: "2024-01-01T00:00:00Z",
      body: "Hey, can you review my PR?",
    });

    assert.strictEqual(msg.body, "Hey, can you review my PR?");
  });

  it("should discriminate message types", () => {
    const taskAssign = AnyMessage.parse({
      type: "task.assign",
      id: "msg-1",
      from: "lead",
      timestamp: "2024-01-01T00:00:00Z",
      task: { id: "t1", description: "do thing", priority: "normal" },
    });
    assert.strictEqual(taskAssign.type, "task.assign");

    const chat = AnyMessage.parse({
      type: "chat",
      id: "msg-2",
      from: "dev-1",
      timestamp: "2024-01-01T00:00:00Z",
      body: "hello",
    });
    assert.strictEqual(chat.type, "chat");
  });

  it("should reject invalid message type", () => {
    assert.throws(() => {
      AnyMessage.parse({
        type: "unknown.type",
        id: "msg-x",
        from: "who",
        timestamp: "2024-01-01T00:00:00Z",
      });
    });
  });
});
