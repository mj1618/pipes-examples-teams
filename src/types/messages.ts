import { z } from "zod";

// Base message envelope
export const MessageEnvelope = z.object({
  type: z.string(),
  id: z.string(),
  from: z.string(),
  timestamp: z.string(),
  correlationId: z.string().optional(),
});

// Task assignment (coordinator -> worker)
export const TaskAssignMessage = MessageEnvelope.extend({
  type: z.literal("task.assign"),
  task: z.object({
    id: z.string(),
    description: z.string(),
    context: z.string().optional(),
    workingDir: z.string().optional(),
    priority: z.enum(["low", "normal", "high"]).default("normal"),
    dependsOn: z.array(z.string()).optional(),
  }),
});

// Task status (worker -> coordinator)
export const TaskStatusMessage = MessageEnvelope.extend({
  type: z.literal("task.status"),
  taskId: z.string(),
  status: z.enum(["accepted", "in_progress", "blocked", "completed", "failed"]),
  detail: z.string().optional(),
});

// Worker ready (worker -> coordinator)
export const WorkerReadyMessage = MessageEnvelope.extend({
  type: z.literal("worker.ready"),
  capabilities: z.array(z.string()).optional(),
});

// Chat message (any -> any)
export const ChatMessage = MessageEnvelope.extend({
  type: z.literal("chat"),
  body: z.string(),
});

// Terminal access request
export const TerminalRequestMessage = MessageEnvelope.extend({
  type: z.literal("terminal.request"),
  target: z.string(),
  reason: z.string(),
});

// Union of all message types
export const AnyMessage = z.discriminatedUnion("type", [
  TaskAssignMessage,
  TaskStatusMessage,
  WorkerReadyMessage,
  ChatMessage,
  TerminalRequestMessage,
]);

export type Message = z.infer<typeof MessageEnvelope>;
export type TaskAssign = z.infer<typeof TaskAssignMessage>;
export type TaskStatus = z.infer<typeof TaskStatusMessage>;
export type WorkerReady = z.infer<typeof WorkerReadyMessage>;
export type Chat = z.infer<typeof ChatMessage>;
export type TerminalRequest = z.infer<typeof TerminalRequestMessage>;
export type AnyMessageType = z.infer<typeof AnyMessage>;
