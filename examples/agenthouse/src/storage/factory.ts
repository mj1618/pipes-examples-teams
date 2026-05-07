import type { BlobStore } from './blob/interface.js';
import type { DatabaseStore } from './database/interface.js';
import type { BlobConfig, DatabaseConfig } from '../types/config.js';
import { FlatFileBlobStore } from './blob/flatfile.js';
import { SQLiteDatabaseStore } from './database/sqlite.js';
import { InMemoryDatabaseStore } from './database/memory.js';

/**
 * Factory: create a BlobStore from config
 */
export function createBlobStore(config: BlobConfig): BlobStore {
  switch (config.type) {
    case 'flatfile':
      return new FlatFileBlobStore(config.path);

    case 's3':
      // S3 implementation is deferred (Phase 3).
      // Import dynamically so the dependency is optional.
      throw new Error(
        'S3BlobStore is not yet implemented. Use flatfile for local development.'
      );

    default: {
      const _exhaustive: never = config;
      throw new Error(`Unknown blob store type: ${(_exhaustive as { type: string }).type}`);
    }
  }
}

/**
 * Factory: create a DatabaseStore from config
 */
export function createDatabaseStore(config: DatabaseConfig): DatabaseStore {
  switch (config.type) {
    case 'sqlite':
      return new SQLiteDatabaseStore(config.path);

    case 'postgres':
      throw new Error(
        'PostgresDatabaseStore is not yet implemented. Use sqlite for local development.'
      );

    case 'turso':
      throw new Error(
        'TursoDatabaseStore is not yet implemented. Use sqlite for local development.'
      );

    default: {
      const _exhaustive: never = config;
      throw new Error(`Unknown database store type: ${(_exhaustive as { type: string }).type}`);
    }
  }
}

/**
 * Create a lightweight in-memory store — useful for tests and ephemeral pipelines
 */
export function createInMemoryStore(): DatabaseStore {
  return new InMemoryDatabaseStore();
}
