import { type WritableResolver, normalizePath } from "./assets";

// File System Access API が使えるか (Chromium 系のみ)。
export function supportsFileSystemAccess(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

// 読み書き権限を確認/取得する。
async function ensurePermission(
  handle: FileSystemHandle,
  mode: "read" | "readwrite",
): Promise<boolean> {
  if (!handle.queryPermission || !handle.requestPermission) return true;
  if ((await handle.queryPermission({ mode })) === "granted") return true;
  return (await handle.requestPermission({ mode })) === "granted";
}

// ローカルフォルダをディレクトリハンドル経由で読み書きする resolver。
export class FileSystemAssetResolver implements WritableResolver {
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  private async fileHandle(
    relativePath: string,
    create: boolean,
  ): Promise<FileSystemFileHandle> {
    const parts = normalizePath(relativePath).split("/").filter(Boolean);
    let dir = this.root;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i], { create });
    }
    return dir.getFileHandle(parts[parts.length - 1], { create });
  }

  async readText(relativePath: string): Promise<string> {
    const fh = await this.fileHandle(relativePath, false);
    return (await fh.getFile()).text();
  }

  async readBytes(relativePath: string): Promise<Uint8Array> {
    const fh = await this.fileHandle(relativePath, false);
    return new Uint8Array(await (await fh.getFile()).arrayBuffer());
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await this.fileHandle(relativePath, false);
      return true;
    } catch {
      return false;
    }
  }

  async writeText(relativePath: string, text: string): Promise<void> {
    const fh = await this.fileHandle(relativePath, true);
    const writable = await fh.createWritable();
    await writable.write(text);
    await writable.close();
  }
}

export interface OpenedDirectory {
  resolver: FileSystemAssetResolver;
  name: string;
}

// フォルダピッカーを開き、読み書き権限を取得して resolver を返す。
export async function openDirectory(): Promise<OpenedDirectory | undefined> {
  if (!window.showDirectoryPicker) return undefined;
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  const ok = await ensurePermission(handle, "readwrite");
  if (!ok) throw new Error("フォルダへの書き込み権限が拒否されました");
  return { resolver: new FileSystemAssetResolver(handle), name: handle.name };
}
