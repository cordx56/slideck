import type { VFS } from "../../vfs";
import { join, normalize, extname } from "@slideck/core";

export interface UploadEntry {
  path: string; // path relative to the target (includes hierarchy for directory drops)
  data: Uint8Array;
}

function stem(name: string): [string, string] {
  const ext = extname(name);
  return ext ? [name.slice(0, name.length - ext.length), ext] : [name, ""];
}

// Return a unique name within dir that does not collide ("x.png" -> "x copy.png" ...).
export async function uniqueName(vfs: VFS, dir: string, name: string): Promise<string> {
  if (!(await vfs.exists(normalize(join(dir, name))))) return name;
  const [base, ext] = stem(name);
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? `${base} copy${ext}` : `${base} copy ${i}${ext}`;
    if (!(await vfs.exists(normalize(join(dir, candidate))))) return candidate;
  }
}

// List relative paths that already exist (collisions) under targetDir.
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

// Recursively expand the DataTransferItemList of an OS file drop (supports directories).
export async function readDataTransferEntries(items: DataTransferItemList): Promise<UploadEntry[]> {
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
