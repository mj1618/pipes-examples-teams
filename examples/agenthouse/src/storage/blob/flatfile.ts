import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { BlobStore } from './interface.js';

/**
 * FlatFileBlobStore — stores blobs as files on the local filesystem.
 *
 * Directory layout:
 *   <root>/<key>
 *
 * Keys are URL-safe-encoded so any path separator in the key
 * creates subdirectories, e.g. "sessions/abc-123" → root/sessions/abc-123
 */
export class FlatFileBlobStore implements BlobStore {
  private readonly root: string;

  constructor(rootPath: string = '~/.agenthouse/blobs') {
    this.root = rootPath.startsWith('~')
      ? path.join(os.homedir(), rootPath.slice(1))
      : rootPath;
  }

  private resolvePath(key: string): string {
    // Sanitise key — prevent path traversal
    const safe = key.replace(/\.\./g, '_');
    return path.join(this.root, safe);
  }

  private async ensureDir(filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  }

  async put(key: string, data: Buffer): Promise<void> {
    const dest = this.resolvePath(key);
    await this.ensureDir(dest);
    await fs.writeFile(dest, data);
  }

  async get(key: string): Promise<Buffer> {
    const src = this.resolvePath(key);
    try {
      return await fs.readFile(src);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        throw new Error(`BlobStore: key not found: ${key}`);
      }
      throw err;
    }
  }

  async list(prefix = ''): Promise<string[]> {
    const prefixDir = this.resolvePath(prefix || '');

    const results: string[] = [];
    await this.walkDir(prefixDir, this.root, results);
    return results.filter((k) => k.startsWith(prefix));
  }

  private async walkDir(dir: string, root: string, results: string[]): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // directory doesn't exist yet
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walkDir(full, root, results);
      } else {
        // Convert absolute path back to key
        results.push(path.relative(root, full));
      }
    }
  }

  async delete(key: string): Promise<void> {
    const target = this.resolvePath(key);
    try {
      await fs.unlink(target);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    const target = this.resolvePath(key);
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }
}
