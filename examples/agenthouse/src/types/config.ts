import { z } from 'zod';

// ── Blob storage config ───────────────────────────────────────────────────────

export const FlatFileBlobConfigSchema = z.object({
  type: z.literal('flatfile'),
  path: z.string().default('~/.agenthouse/blobs'),
});

export const S3BlobConfigSchema = z.object({
  type: z.literal('s3'),
  bucket: z.string(),
  region: z.string().default('us-east-1'),
  prefix: z.string().optional().default(''),
  endpoint: z.string().optional(), // for S3-compatible stores (R2, MinIO)
});

export const BlobConfigSchema = z.discriminatedUnion('type', [
  FlatFileBlobConfigSchema,
  S3BlobConfigSchema,
]);

export type BlobConfig = z.infer<typeof BlobConfigSchema>;

// ── Database storage config ───────────────────────────────────────────────────

export const SQLiteDBConfigSchema = z.object({
  type: z.literal('sqlite'),
  path: z.string().default('~/.agenthouse/warehouse.db'),
});

export const PostgresDBConfigSchema = z.object({
  type: z.literal('postgres'),
  connectionString: z.string(),
});

export const TursoDatabaseConfigSchema = z.object({
  type: z.literal('turso'),
  url: z.string(),
  authToken: z.string().optional(),
});

export const DatabaseConfigSchema = z.discriminatedUnion('type', [
  SQLiteDBConfigSchema,
  PostgresDBConfigSchema,
  TursoDatabaseConfigSchema,
]);

export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;

// ── Embedder config ───────────────────────────────────────────────────────────

export const OllamaEmbedderConfigSchema = z.object({
  type: z.literal('ollama'),
  model: z.string().default('nomic-embed-text'),
  baseUrl: z.string().default('http://localhost:11434'),
});

export const VoyageEmbedderConfigSchema = z.object({
  type: z.literal('voyage'),
  model: z.string().default('voyage-2'),
  apiKey: z.string(),
});

export const MockEmbedderConfigSchema = z.object({
  type: z.literal('mock'),
  dimensions: z.number().default(768),
});

export const EmbedderConfigSchema = z.discriminatedUnion('type', [
  OllamaEmbedderConfigSchema,
  VoyageEmbedderConfigSchema,
  MockEmbedderConfigSchema,
]);

export type EmbedderConfig = z.infer<typeof EmbedderConfigSchema>;

// ── Root config ───────────────────────────────────────────────────────────────

export const AgenhouseConfigSchema = z.object({
  storage: z.object({
    blob: BlobConfigSchema.default({ type: 'flatfile', path: '~/.agenthouse/blobs' }),
    database: DatabaseConfigSchema.default({ type: 'sqlite', path: '~/.agenthouse/warehouse.db' }),
  }).default({}),
  embedder: EmbedderConfigSchema.default({ type: 'mock', dimensions: 768 }),
  chunking: z
    .object({
      maxTokensPerChunk: z.number().default(1000),
      overlapTokens: z.number().default(100),
    })
    .default({}),
  query: z
    .object({
      defaultLimit: z.number().default(5),
      semanticWeight: z.number().min(0).max(1).default(0.7),
      fulltextWeight: z.number().min(0).max(1).default(0.3),
    })
    .default({}),
});

export type AgenhouseConfig = z.infer<typeof AgenhouseConfigSchema>;

/** Load config with defaults */
export function defaultConfig(): AgenhouseConfig {
  return AgenhouseConfigSchema.parse({});
}
