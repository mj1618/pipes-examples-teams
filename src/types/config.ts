import { z } from "zod";

export const WorkerConfig = z.object({
  handle: z.string().regex(/^[a-z0-9-]+$/, "Handle must be lowercase alphanumeric with dashes"),
  model: z.enum(["opus", "sonnet", "haiku"]).default("sonnet"),
  workingDir: z.string().default("."),
  systemPrompt: z.string().optional(),
  allowedTools: z.string().optional(),
  maxBudget: z.number().optional(),
});

export const TeamConfig = z.object({
  name: z.string(),
  workingDir: z.string().default("."),
  coordinator: z.object({
    model: z.enum(["opus", "sonnet", "haiku"]).default("opus"),
    systemPrompt: z.string().optional(),
  }).default({}),
  workers: z.array(WorkerConfig).min(1),
  settings: z.object({
    pollIntervalMs: z.number().default(2000),
    maxBudgetPerWorker: z.number().optional(),
    terminalSharing: z.boolean().default(true),
  }).default({}),
});

export type WorkerConfigType = z.infer<typeof WorkerConfig>;
export type TeamConfigType = z.infer<typeof TeamConfig>;
