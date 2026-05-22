export type { VFSEvent, VFSListener } from "./events";

export interface FileEntry {
  path: string;
  kind: "file" | "folder";
  size?: number;
  mimeType?: string;
  modifiedAt: number;
}

// アプリ全体は IndexedDB を直接触らずこの API を経由する。
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

  // Meta (currentSlideId, treeExpanded, settings...)
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;

  // Subscribe / lifecycle
  subscribe(listener: import("./events").VFSListener): () => void;
  dispose(): void;
}

export { openVfs } from "./indexeddb";
