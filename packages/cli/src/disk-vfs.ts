import { readFile, writeFile, mkdir, rm, stat, readdir, cp, rename } from "node:fs/promises";
import { join as pjoin, dirname as pdirname, relative, sep } from "node:path";
import type { VFS, FileEntry, VFSListener } from "@slideck/core";
import { EventBus, normalize, mimeFromPath } from "@slideck/core";
import { createWatcher, type Watcher } from "./watch";

// ツリーに出さない/監視しないトップレベル名と内部メタディレクトリ。
const IGNORE_TOP = new Set([".git", "node_modules"]);
const META_DIR = ".slideck"; // ツリー状態などサーバ内部メタの置き場
const META_FILE = ".slideck/meta.json";

function ignored(relPosix: string): boolean {
  const top = relPosix.split("/")[0];
  return IGNORE_TOP.has(top) || relPosix === META_DIR || relPosix.startsWith(META_DIR + "/");
}

// プロジェクトディレクトリを実体とする VFS 実装。変更通知はディスク監視
// (createWatcher) を唯一の発生源とし、書き込みメソッド自身は emit しない。
export class DiskVfs implements VFS {
  private bus = new EventBus();
  private watcher: Watcher;

  constructor(private root: string) {
    this.watcher = createWatcher(root, ignored, (events) => {
      for (const e of events) this.bus.emit(e);
    });
  }

  // VFS パス ("/a/b") -> ディスク絶対パス。
  private disk(p: string): string {
    const n = normalize(p);
    return n === "/" ? this.root : pjoin(this.root, n.slice(1));
  }

  private toVfs(abs: string): string {
    const r = relative(this.root, abs).split(sep).join("/");
    return r === "" ? "/" : "/" + r;
  }

  private async ensureParent(diskPath: string): Promise<void> {
    await mkdir(pdirname(diskPath), { recursive: true });
  }

  // --- Read ---
  async list(): Promise<FileEntry[]> {
    const out: FileEntry[] = [];
    const walk = async (absDir: string): Promise<void> => {
      const entries = await readdir(absDir, { withFileTypes: true }).catch(() => null);
      if (!entries) return;
      for (const ent of entries) {
        const abs = pjoin(absDir, ent.name);
        const vfs = this.toVfs(abs);
        if (ignored(vfs.slice(1))) continue;
        const st = await stat(abs).catch(() => null);
        if (!st) continue;
        if (ent.isDirectory()) {
          out.push({ path: vfs, kind: "folder", modifiedAt: st.mtimeMs });
          await walk(abs);
        } else if (ent.isFile()) {
          out.push({
            path: vfs,
            kind: "file",
            size: st.size,
            mimeType: mimeFromPath(vfs),
            modifiedAt: st.mtimeMs,
          });
        }
      }
    };
    await walk(this.root);
    return out;
  }

  async exists(path: string): Promise<boolean> {
    return (await stat(this.disk(path)).catch(() => null)) !== null;
  }

  async stat(path: string): Promise<FileEntry | null> {
    const st = await stat(this.disk(path)).catch(() => null);
    if (!st) return null;
    const vfs = normalize(path);
    return st.isDirectory()
      ? { path: vfs, kind: "folder", modifiedAt: st.mtimeMs }
      : {
          path: vfs,
          kind: "file",
          size: st.size,
          mimeType: mimeFromPath(vfs),
          modifiedAt: st.mtimeMs,
        };
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.disk(path)));
  }

  async readText(path: string): Promise<string> {
    return readFile(this.disk(path), "utf8");
  }

  async readBlob(path: string): Promise<Blob> {
    const bytes = await this.readBytes(path);
    return new Blob([bytes as BlobPart], { type: mimeFromPath(path) });
  }

  getObjectURL(): Promise<string> {
    return Promise.reject(new Error("getObjectURL は server 側では未対応"));
  }

  // --- Write (emit はせず、watcher 経由で通知される) ---
  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    const d = this.disk(path);
    await this.ensureParent(d);
    await writeFile(d, data);
  }

  async writeBlob(path: string, blob: Blob): Promise<void> {
    await this.writeBytes(path, new Uint8Array(await blob.arrayBuffer()));
  }

  async writeText(path: string, text: string): Promise<void> {
    const d = this.disk(path);
    await this.ensureParent(d);
    await writeFile(d, text, "utf8");
  }

  async createFolder(path: string): Promise<void> {
    await mkdir(this.disk(path), { recursive: true });
  }

  async move(from: string, to: string): Promise<void> {
    const d = this.disk(to);
    await this.ensureParent(d);
    await rename(this.disk(from), d);
  }

  async copy(from: string, to: string): Promise<void> {
    const d = this.disk(to);
    await this.ensureParent(d);
    await cp(this.disk(from), d, { recursive: true });
  }

  async delete(path: string): Promise<void> {
    await rm(this.disk(path), { recursive: true, force: true });
  }

  // --- Bulk (ZIP はクライアント側で他メソッドを使い処理する) ---
  importZip(): Promise<void> {
    return Promise.reject(new Error("importZip は client 側で処理する"));
  }
  exportZip(): Promise<Blob> {
    return Promise.reject(new Error("exportZip は client 側で処理する"));
  }
  clear(): Promise<void> {
    return Promise.reject(new Error("clear はサーバ連携では未対応"));
  }

  // --- Meta (.slideck/meta.json に集約) ---
  private async readMeta(): Promise<Record<string, unknown>> {
    try {
      return JSON.parse(await readFile(pjoin(this.root, META_FILE), "utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      return {};
    }
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.readMeta())[key] as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const all = await this.readMeta();
    all[key] = value;
    await mkdir(pjoin(this.root, META_DIR), { recursive: true });
    await writeFile(pjoin(this.root, META_FILE), JSON.stringify(all, null, 2), "utf8");
  }

  // --- Subscribe / lifecycle ---
  subscribe(listener: VFSListener): () => void {
    return this.bus.subscribe(listener);
  }

  dispose(): void {
    this.watcher.close();
  }
}
