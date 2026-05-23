// Abstract VFS interface (implemented by consumers: web=IndexedDB, cli=disk, etc.).
// core depends only on this type and holds no concrete implementation.

export type VFSEvent =
  | { type: "create"; path: string }
  | { type: "update"; path: string }
  | { type: "delete"; path: string }
  | { type: "move"; from: string; to: string };

export type VFSListener = (event: VFSEvent) => void;

export interface FileEntry {
  path: string;
  kind: "file" | "folder";
  size?: number;
  mimeType?: string;
  modifiedAt: number;
}

export interface VFS {
  // Read
  list(): Promise<FileEntry[]>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileEntry | null>;
  readBlob(path: string): Promise<Blob>;
  readBytes(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  getObjectURL(path: string): Promise<string>;

  // Write
  writeBlob(path: string, blob: Blob, mimeType?: string): Promise<void>;
  writeText(path: string, text: string): Promise<void>;
  createFolder(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  delete(path: string): Promise<void>;

  // Bulk
  importZip(blob: Blob, targetDir?: string): Promise<void>;
  exportZip(): Promise<Blob>;
  clear(): Promise<void>;

  // Meta
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;

  // Subscribe / lifecycle
  subscribe(listener: VFSListener): () => void;
  dispose(): void;
}
