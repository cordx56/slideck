import type { VFS } from "../../vfs";
import { join, normalize, extname } from "../../vfs/path";

export interface UploadEntry {
  path: string; // ターゲットからの相対パス (ディレクトリ drop で階層を含む)
  data: Uint8Array;
}

function stem(name: string): [string, string] {
  const ext = extname(name);
  return ext ? [name.slice(0, name.length - ext.length), ext] : [name, ""];
}

// dir 内で name が衝突しない一意な名前を返す ("x.png" -> "x copy.png" ...)。
export async function uniqueName(
  vfs: VFS,
  dir: string,
  name: string,
): Promise<string> {
  if (!(await vfs.exists(normalize(join(dir, name))))) return name;
  const [base, ext] = stem(name);
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? `${base} copy${ext}` : `${base} copy ${i}${ext}`;
    if (!(await vfs.exists(normalize(join(dir, candidate))))) return candidate;
  }
}

// targetDir 配下で既に存在する相対パス (衝突) を列挙する。
export async function detectConflicts(
  vfs: VFS,
  targetDir: string,
  relPaths: string[],
): Promise<string[]> {
  const conflicts: string[] = [];
  for (const rel of relPaths) {
    if (await vfs.exists(normalize(join(targetDir, rel)))) conflicts.push(rel);
  }
  return conflicts;
}

// OS ファイル drop の DataTransferItemList を再帰展開する (ディレクトリ対応)。
export async function readDataTransferEntries(
  items: DataTransferItemList,
): Promise<UploadEntry[]> {
  const out: UploadEntry[] = [];
  const roots: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) roots.push(entry);
  }
  await Promise.all(roots.map((e) => walkEntry(e, "", out)));
  return out;
}

async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: UploadEntry[],
): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) =>
      (entry as FileSystemFileEntry).file(res, rej),
    );
    out.push({
      path: prefix + entry.name,
      data: new Uint8Array(await file.arrayBuffer()),
    });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children = await new Promise<FileSystemEntry[]>((res, rej) =>
      reader.readEntries(res, rej),
    );
    await Promise.all(children.map((c) => walkEntry(c, prefix + entry.name + "/", out)));
  }
}
