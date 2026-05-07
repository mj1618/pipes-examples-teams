/**
 * BlobStore interface — stores raw session files verbatim.
 *
 * Implementations: FlatFileBlobStore, S3BlobStore
 */
export interface BlobStore {
  /** Write raw bytes at key */
  put(key: string, data: Buffer): Promise<void>;

  /** Read raw bytes at key; throws if not found */
  get(key: string): Promise<Buffer>;

  /** List all keys with the given prefix */
  list(prefix?: string): Promise<string[]>;

  /** Delete key; no-op if key doesn't exist */
  delete(key: string): Promise<void>;

  /** Check if a key exists */
  exists(key: string): Promise<boolean>;
}
