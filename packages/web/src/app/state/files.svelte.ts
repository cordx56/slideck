import { basename, dirname, joinPath, normalizePath } from "@slideck/core";
import type { FileEntry } from "../../vfs";
import { uniqueName, type UploadEntry } from "../editor/file-ops";
import * as project from "./project.svelte";

export type OpenPathInvalidation =
  | { type: "open"; path: string }
  | { type: "move"; from: string; to: string }
  | { type: "delete"; path: string };

type OpenPathInvalidatedListener = (event: OpenPathInvalidation) => Promise<void> | void;

let files = $state.raw<FileEntry[]>([]);
let expanded = $state.raw<Set<string>>(new Set());
let showHidden = $state(false);
const openPathInvalidatedListeners = new Set<OpenPathInvalidatedListener>();

export function fileEntries(): FileEntry[] {
  return files;
}

export function expandedPaths(): Set<string> {
  return expanded;
}

export function hiddenFilesShown(): boolean {
  return showHidden;
}

export function onOpenPathInvalidated(listener: OpenPathInvalidatedListener): () => void {
  openPathInvalidatedListeners.add(listener);
  return () => openPathInvalidatedListeners.delete(listener);
}

async function notifyOpenPathInvalidated(event: OpenPathInvalidation): Promise<void> {
  for (const listener of openPathInvalidatedListeners) await listener(event);
}

export function isExpanded(path: string): boolean {
  return expanded.has(path);
}

export function toggleExpanded(path: string): void {
  const next = new Set(expanded);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  expanded = next;
  void project.vfs()?.setMeta("treeExpanded", [...next]);
}

export function setExpanded(path: string, on: boolean): void {
  const next = new Set(expanded);
  if (on) next.add(path);
  else next.delete(path);
  expanded = next;
  void project.vfs()?.setMeta("treeExpanded", [...next]);
}

export function toggleHidden(): void {
  showHidden = !showHidden;
  void project.vfs()?.setMeta("showHidden", showHidden);
}

export async function refreshFiles(): Promise<void> {
  const vfs = project.vfs();
  if (vfs) files = await vfs.list();
}

export async function createFile(dir: string, name: string): Promise<void> {
  const vfs = project.vfs();
  if (!vfs) return;
  const path = normalizePath(joinPath(dir, name));
  await vfs.writeText(path, "");
  setExpanded(dir, true);
  await notifyOpenPathInvalidated({ type: "open", path });
}

export async function createFolder(dir: string, name: string): Promise<void> {
  const vfs = project.vfs();
  if (!vfs) return;
  await vfs.createFolder(normalizePath(joinPath(dir, name)));
  setExpanded(dir, true);
}

export async function renamePath(path: string, newName: string): Promise<void> {
  const vfs = project.vfs();
  if (!vfs || basename(path) === newName) return;
  const to = normalizePath(joinPath(dirname(path), newName));
  await vfs.move(path, to);
  await followMove(path, to);
}

export async function moveNode(from: string, toDir: string): Promise<void> {
  const vfs = project.vfs();
  if (!vfs) return;
  const to = normalizePath(joinPath(toDir, basename(from)));
  if (from === to || to.startsWith(from + "/")) return;
  await vfs.move(from, to);
  await followMove(from, to);
}

export async function followMove(from: string, to: string): Promise<void> {
  await notifyOpenPathInvalidated({ type: "move", from, to });
}

export async function deletePath(path: string): Promise<void> {
  const vfs = project.vfs();
  if (!vfs) return;
  await vfs.delete(path);
  await notifyOpenPathInvalidated({ type: "delete", path });
}

export async function duplicatePath(path: string): Promise<void> {
  const vfs = project.vfs();
  if (!vfs) return;
  const dir = dirname(path);
  const name = await uniqueName(vfs, dir, basename(path));
  await vfs.copy(path, normalizePath(joinPath(dir, name)));
}

export async function downloadFile(path: string): Promise<void> {
  const vfs = project.vfs();
  if (!vfs) return;
  const bytes = await vfs.readBytes(path);
  const { downloadBytes } = await import("../../lib/download");
  const { mimeFromPath } = await import("@slideck/core");
  downloadBytes(bytes, basename(path), mimeFromPath(path));
}

export async function uploadEntries(
  targetDir: string,
  entries: UploadEntry[],
  overwrite: boolean,
): Promise<void> {
  const vfs = project.vfs();
  if (!vfs) return;
  for (const entry of entries) {
    const path = normalizePath(joinPath(targetDir, entry.path));
    if (!overwrite && (await vfs.exists(path))) continue;
    await vfs.writeBlob(path, new Blob([entry.data as BlobPart]));
  }
  setExpanded(targetDir, true);
}

export async function exportZip(): Promise<void> {
  const vfs = project.vfs();
  if (!vfs) return;
  const blob = await vfs.exportZip();
  const { downloadBytes } = await import("../../lib/download");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  downloadBytes(
    new Uint8Array(await blob.arrayBuffer()),
    `deck-${timestamp}.zip`,
    "application/zip",
  );
}

export async function importZip(file: File, targetDir = "/"): Promise<void> {
  const vfs = project.vfs();
  if (vfs) await vfs.importZip(file, targetDir);
}

project.onProjectLoaded(async () => {
  const vfs = project.requireVfs();
  await refreshFiles();
  expanded = new Set((await vfs.getMeta<string[]>("treeExpanded")) ?? []);
  showHidden = (await vfs.getMeta<boolean>("showHidden")) ?? false;
});
