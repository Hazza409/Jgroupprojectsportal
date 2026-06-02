import { promises as fs } from "fs";
import path from "path";
import type { PutObjectInput, StorageDriver } from "./index";

// Dev driver: writes under LOCAL_STORAGE_DIR (default ./storage-data).
// Files are served back through the scoped /api/files route — never directly,
// so project access is always enforced before bytes leave the server.
export class LocalStorage implements StorageDriver {
  private root = path.resolve(process.env.LOCAL_STORAGE_DIR ?? "./storage-data");

  private full(key: string): string {
    // Prevent path traversal out of the storage root.
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(this.root)) throw new Error("Invalid storage key");
    return resolved;
  }

  async put({ key, body }: PutObjectInput): Promise<string> {
    const dest = this.full(key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, body);
    return key;
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.full(key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.full(key), { force: true });
  }

  async url(key: string): Promise<string> {
    // Served by a scoped route handler (see app/api/files/[...key]/route.ts).
    return `/api/files/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
}
