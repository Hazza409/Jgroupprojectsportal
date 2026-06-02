// Storage abstraction. Code never talks to disk or S3 directly — only through
// this interface, so dev runs on local disk and prod runs on any S3-compatible
// store (AWS S3, Cloudflare R2, MinIO, Supabase Storage) with no code change.

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType?: string;
}

export interface StorageDriver {
  /** Persist bytes under `key`. Returns the stored key. */
  put(input: PutObjectInput): Promise<string>;
  /** Read bytes back. Used by download routes (which enforce project scope first). */
  get(key: string): Promise<Buffer>;
  /** Remove an object. */
  delete(key: string): Promise<void>;
  /**
   * A URL the browser can use to fetch the object. For local dev this is an
   * internal app route; for S3 it's a presigned URL.
   */
  url(key: string): Promise<string>;
}

let driver: StorageDriver | null = null;

export async function storage(): Promise<StorageDriver> {
  if (driver) return driver;
  const kind = process.env.STORAGE_DRIVER ?? "local";
  if (kind === "s3") {
    const { S3Storage } = await import("./s3");
    driver = new S3Storage();
  } else {
    const { LocalStorage } = await import("./local");
    driver = new LocalStorage();
  }
  return driver;
}

/** Build a namespaced, collision-resistant storage key. */
export function buildKey(parts: {
  projectId: string;
  category: string; // "estimates" | "schedules" | "photos" | "quotes" | "docs"
  originalName: string;
}): string {
  const safe = parts.originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  // Caller supplies uniqueness via timestamp/cuid in originalName prefix when needed.
  return `projects/${parts.projectId}/${parts.category}/${safe}`;
}
