import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { VFS, FileEntry } from "./index";
import { EventBus, type VFSListener } from "./events";
import { ObjectURLCache } from "./object-url-cache";
import { readZip, writeZip, type ZipEntry } from "./zip";
import { normalize, join } from "./path";
import { mimeFromPath } from "../lib/mime";

interface FileRecord {
  path: string;
  kind: "file" | "folder";
  data?: Uint8Array; // file のみ。Blob ではなくバイト列で保存 (環境非依存)
  mimeType?: string;
  size?: number;
  modifiedAt: number;
}

interface SlideAppDB extends DBSchema {
  files: { key: string; value: FileRecord };
  meta: { key: string; value: { key: string; value: unknown } };
}

const IMPORT_BATCH = 50;

function toEntry(r: FileRecord): FileEntry {
  return {
    path: r.path,
    kind: r.kind,
    size: r.size,
    mimeType: r.mimeType,
    modifiedAt: r.modifiedAt,
  };
}

class IndexedDbVfs implements VFS {
  private bus = new EventBus();
  private urls = new ObjectURLCache((p) => this.readBlob(p));

  constructor(private db: IDBPDatabase<SlideAppDB>) {}

  // --- Read ---
  async list(): Promise<FileEntry[]> {
    const all = await this.db.getAll("files");
    return all.map(toEntry);
  }

  async exists(path: string): Promise<boolean> {
    return (await this.db.get("files", normalize(path))) !== undefined;
  }

  async stat(path: string): Promise<FileEntry | null> {
    const r = await this.db.get("files", normalize(path));
    return r ? toEntry(r) : null;
  }

  private async record(path: string): Promise<FileRecord> {
    const r = await this.db.get("files", normalize(path));
    if (!r) throw new Error(`ファイルがありません: ${path}`);
    if (r.kind !== "file" || !r.data) throw new Error(`ファイルではありません: ${path}`);
    return r;
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return (await this.record(path)).data!;
  }

  async readBlob(path: string): Promise<Blob> {
    const r = await this.record(path);
    return new Blob([r.data! as BlobPart], { type: r.mimeType });
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode((await this.record(path)).data!);
  }

  getObjectURL(path: string): Promise<string> {
    return this.urls.get(normalize(path));
  }

  // --- Write ---
  private async ensureParents(path: string): Promise<void> {
    const parts = normalize(path).split("/").filter(Boolean);
    let cur = "";
    for (let i = 0; i < parts.length - 1; i++) {
      cur += "/" + parts[i];
      if (!(await this.db.get("files", cur))) {
        await this.db.put("files", { path: cur, kind: "folder", modifiedAt: Date.now() });
        this.bus.emit({ type: "create", path: cur });
      }
    }
  }

  private async writeBytes(path: string, data: Uint8Array, mimeType: string): Promise<void> {
    const p = normalize(path);
    const existed = (await this.db.get("files", p)) !== undefined;
    await this.ensureParents(p);
    await this.db.put("files", {
      path: p,
      kind: "file",
      data,
      mimeType,
      size: data.byteLength,
      modifiedAt: Date.now(),
    });
    this.urls.invalidate(p);
    this.bus.emit({ type: existed ? "update" : "create", path: p });
  }

  async writeBlob(path: string, blob: Blob, mimeType?: string): Promise<void> {
    const data = new Uint8Array(await blob.arrayBuffer());
    await this.writeBytes(path, data, mimeType ?? blob.type ?? mimeFromPath(path));
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.writeBytes(path, new TextEncoder().encode(text), mimeFromPath(path));
  }

  async createFolder(path: string): Promise<void> {
    const p = normalize(path);
    if (await this.db.get("files", p)) return;
    await this.ensureParents(p);
    await this.db.put("files", { path: p, kind: "folder", modifiedAt: Date.now() });
    this.bus.emit({ type: "create", path: p });
  }

  async delete(path: string): Promise<void> {
    const p = normalize(path);
    const tx = this.db.transaction("files", "readwrite");
    const keys = (await tx.store.getAllKeys()) as string[];
    const targets = keys.filter((k) => k === p || k.startsWith(p + "/"));
    for (const k of targets) await tx.store.delete(k);
    await tx.done;
    for (const k of targets) {
      this.urls.invalidate(k);
      this.bus.emit({ type: "delete", path: k });
    }
  }

  async move(from: string, to: string): Promise<void> {
    const f = normalize(from);
    const t = normalize(to);
    if (f === t) return;
    if (t.startsWith(f + "/")) throw new Error("自身の子孫へは移動できません");

    const tx = this.db.transaction("files", "readwrite");
    const all = await tx.store.getAll();
    const affected = all.filter((r) => r.path === f || r.path.startsWith(f + "/"));
    if (affected.length === 0) {
      await tx.done;
      throw new Error(`移動元が存在しません: ${f}`);
    }
    for (const r of affected) {
      const np = t + r.path.slice(f.length);
      await tx.store.delete(r.path);
      await tx.store.put({ ...r, path: np, modifiedAt: Date.now() });
    }
    await tx.done;
    await this.ensureParents(t);
    for (const r of affected) this.urls.invalidate(r.path);
    this.bus.emit({ type: "move", from: f, to: t });
  }

  async copy(from: string, to: string): Promise<void> {
    const f = normalize(from);
    const t = normalize(to);
    const all = await this.db.getAll("files");
    const affected = all.filter((r) => r.path === f || r.path.startsWith(f + "/"));
    if (affected.length === 0) throw new Error(`コピー元が存在しません: ${f}`);
    for (const r of affected) {
      const np = t + r.path.slice(f.length);
      await this.ensureParents(np);
      await this.db.put("files", { ...r, path: np, modifiedAt: Date.now() });
      this.bus.emit({ type: "create", path: np });
    }
  }

  // --- Bulk ---
  async importZip(blob: Blob, targetDir = "/"): Promise<void> {
    const entries = await readZip(blob);
    for (let i = 0; i < entries.length; i += IMPORT_BATCH) {
      for (const e of entries.slice(i, i + IMPORT_BATCH)) {
        const p = normalize(join(targetDir, e.path));
        await this.writeBytes(p, e.data, mimeFromPath(p));
      }
    }
  }

  async exportZip(): Promise<Blob> {
    const all = await this.db.getAll("files");
    const entries: ZipEntry[] = [];
    for (const r of all) {
      if (r.kind !== "file" || !r.data) continue;
      entries.push({ path: r.path.replace(/^\//, ""), data: r.data });
    }
    return writeZip(entries);
  }

  async clear(): Promise<void> {
    await this.db.clear("files");
    await this.db.clear("meta");
    this.urls.invalidate();
  }

  // --- Meta ---
  async getMeta<T>(key: string): Promise<T | undefined> {
    const r = await this.db.get("meta", key);
    return r?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.put("meta", { key, value });
  }

  // --- Subscribe / lifecycle ---
  subscribe(listener: VFSListener): () => void {
    return this.bus.subscribe(listener);
  }

  dispose(): void {
    this.urls.invalidate();
    this.db.close();
  }
}

export async function openVfs(dbName = "slide-app"): Promise<VFS> {
  const db = await openDB<SlideAppDB>(dbName, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains("files")) {
        database.createObjectStore("files", { keyPath: "path" });
      }
      if (!database.objectStoreNames.contains("meta")) {
        database.createObjectStore("meta", { keyPath: "key" });
      }
    },
  });
  return new IndexedDbVfs(db);
}
