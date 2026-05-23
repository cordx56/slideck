// VFS implementation that operates the cli's DiskVfs over HTTP. When slideck
// serve is running, web uses this to edit the on-disk project directly.
import type {
  VFS,
  FileEntry,
  VFSListener,
  StatResponse,
  PathPairBody,
  ServerInfo,
  VfsEventMessage,
} from "@slideck/core";
import { VfsApi, CLIENT_HEADER, MIME_HEADER, normalize, mimeFromPath, join } from "@slideck/core";
import { EventBus } from "./events";
import { readZip, writeZip, type ZipEntry } from "./zip";

const JSON_CT = { "content-type": "application/json" };

class HttpVfs implements VFS {
  private bus = new EventBus();
  // Client identifier. Used to ignore SSE echoes from our own writes.
  private clientId = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  private es: EventSource;

  constructor() {
    this.es = new EventSource(VfsApi.events);
    this.es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as VfsEventMessage;
        if (msg.origin === this.clientId) return; // already applied locally
        this.bus.emit(msg.event);
      } catch {
        // ignore malformed payloads
      }
    };
  }

  // Attach the origin client header to mutating requests.
  private h(extra?: Record<string, string>): HeadersInit {
    return { [CLIENT_HEADER]: this.clientId, ...extra };
  }

  // --- Read ---
  async list(): Promise<FileEntry[]> {
    return (await (await fetch(VfsApi.files)).json()) as FileEntry[];
  }

  async stat(path: string): Promise<FileEntry | null> {
    return (await (await fetch(VfsApi.stat(path))).json()) as StatResponse;
  }

  async exists(path: string): Promise<boolean> {
    return (await this.stat(path)) !== null;
  }

  private async fetchFile(path: string): Promise<Response> {
    const res = await fetch(VfsApi.file(path));
    if (!res.ok) throw new Error(`Read failed: ${path}`);
    return res;
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.fetchFile(path)).arrayBuffer());
  }

  async readText(path: string): Promise<string> {
    return (await this.fetchFile(path)).text();
  }

  async readBlob(path: string): Promise<Blob> {
    return (await this.fetchFile(path)).blob();
  }

  // Images etc. can use the file endpoint directly as src. Append mtime for change detection.
  async getObjectURL(path: string): Promise<string> {
    const st = await this.stat(path);
    return `${VfsApi.file(path)}&v=${st ? st.modifiedAt : Date.now()}`;
  }

  // --- Write (like the IndexedDB impl, emit events optimistically to local) ---
  async writeText(path: string, text: string): Promise<void> {
    const p = normalize(path);
    const existed = await this.exists(p);
    await fetch(VfsApi.file(p), {
      method: "PUT",
      headers: this.h({ [MIME_HEADER]: mimeFromPath(p) }),
      body: text,
    });
    this.bus.emit({ type: existed ? "update" : "create", path: p });
  }

  async writeBlob(path: string, blob: Blob, mimeType?: string): Promise<void> {
    const p = normalize(path);
    const existed = await this.exists(p);
    await fetch(VfsApi.file(p), {
      method: "PUT",
      headers: this.h({ [MIME_HEADER]: mimeType ?? blob.type ?? mimeFromPath(p) }),
      body: blob,
    });
    this.bus.emit({ type: existed ? "update" : "create", path: p });
  }

  async createFolder(path: string): Promise<void> {
    const p = normalize(path);
    await fetch(VfsApi.folder(p), { method: "POST", headers: this.h() });
    this.bus.emit({ type: "create", path: p });
  }

  async move(from: string, to: string): Promise<void> {
    const f = normalize(from);
    const t = normalize(to);
    const body: PathPairBody = { from: f, to: t };
    await fetch(VfsApi.move, {
      method: "POST",
      headers: this.h(JSON_CT),
      body: JSON.stringify(body),
    });
    this.bus.emit({ type: "move", from: f, to: t });
  }

  async copy(from: string, to: string): Promise<void> {
    const f = normalize(from);
    const t = normalize(to);
    const body: PathPairBody = { from: f, to: t };
    await fetch(VfsApi.copy, {
      method: "POST",
      headers: this.h(JSON_CT),
      body: JSON.stringify(body),
    });
    this.bus.emit({ type: "create", path: t });
  }

  async delete(path: string): Promise<void> {
    const p = normalize(path);
    await fetch(VfsApi.file(p), { method: "DELETE", headers: this.h() });
    this.bus.emit({ type: "delete", path: p });
  }

  // --- Bulk (ZIP is handled client-side using the other methods) ---
  async exportZip(): Promise<Blob> {
    const entries: ZipEntry[] = [];
    for (const f of await this.list()) {
      if (f.kind !== "file") continue;
      entries.push({ path: f.path.replace(/^\//, ""), data: await this.readBytes(f.path) });
    }
    return writeZip(entries);
  }

  async importZip(blob: Blob, targetDir = "/"): Promise<void> {
    for (const e of await readZip(blob)) {
      const p = normalize(join(targetDir, e.path));
      await this.writeBlob(
        p,
        new Blob([e.data as BlobPart], { type: mimeFromPath(p) }),
        mimeFromPath(p),
      );
    }
  }

  clear(): Promise<void> {
    return Promise.reject(new Error("clear is not supported in server-linked mode"));
  }

  // --- Meta ---
  async getMeta<T>(key: string): Promise<T | undefined> {
    const j = (await (await fetch(VfsApi.meta(key))).json()) as { value: T | undefined };
    return j.value;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await fetch(VfsApi.meta(key), {
      method: "PUT",
      headers: this.h(JSON_CT),
      body: JSON.stringify({ value }),
    });
  }

  // --- Subscribe / lifecycle ---
  subscribe(listener: VFSListener): () => void {
    return this.bus.subscribe(listener);
  }

  dispose(): void {
    this.es.close();
  }
}

// Determine whether we are in server-linked mode. Returns ServerInfo when under slideck serve.
export async function probeServer(): Promise<ServerInfo | null> {
  try {
    const res = await fetch(VfsApi.info);
    if (!res.ok) return null;
    const info = (await res.json()) as ServerInfo;
    return info.server ? info : null;
  } catch {
    return null;
  }
}

export function openHttpVfs(): VFS {
  return new HttpVfs();
}
