import type { VFS } from "../vfs";
import { mimeFromPath } from "@slideck/core";
import { gitBlobSha } from "./blob-sha";
import {
  getRepo,
  listTree,
  getBlob,
  lastCommitDate,
  getHeadCommit,
  createBlob,
  createTree,
  createCommit,
  updateBranch,
  type TreeChange,
  type TreeEntry,
} from "./client";

// Guardrails against hostile/huge repositories: clone/pull stream every blob
// into IndexedDB, so cap the file count and bytes before downloading anything.
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file
const MAX_TOTAL_BYTES = 100 * 1024 * 1024; // 100 MB total

function enforceLimits(tree: TreeEntry[]): void {
  if (tree.length > MAX_FILES) {
    throw new Error(`repository has too many files (${tree.length} > ${MAX_FILES})`);
  }
  let total = 0;
  for (const e of tree) {
    const size = e.size ?? 0;
    if (size > MAX_FILE_BYTES) {
      throw new Error(`file ${e.path} is too large (${Math.round(size / 1e6)} MB > 25 MB)`);
    }
    total += size;
  }
  if (total > MAX_TOTAL_BYTES) {
    throw new Error(`repository is too large (${Math.round(total / 1e6)} MB > 100 MB)`);
  }
}

export interface GithubRemote {
  owner: string;
  repo: string;
  branch: string;
}

// path (VFS, leading slash) -> git blob sha at last sync (the agreed common version).
export type Baseline = Record<string, string>;

export type FileStatus =
  | "same"
  | "remoteNew"
  | "localNew"
  | "remoteModified"
  | "localModified"
  | "remoteDeleted"
  | "localDeleted"
  | "bothDeleted"
  | "bothModified"
  | "remoteDeletedLocalModified"
  | "localDeletedRemoteModified";

const CONFLICTS: ReadonlySet<FileStatus> = new Set([
  "bothModified",
  "remoteDeletedLocalModified",
  "localDeletedRemoteModified",
]);
export const isConflict = (s: FileStatus): boolean => CONFLICTS.has(s);

// Pure three-way classification of every path across local/remote/baseline shas.
export function classify(
  local: Map<string, string>,
  remote: Map<string, string>,
  baseline: Baseline,
): Map<string, FileStatus> {
  const paths = new Set([...local.keys(), ...remote.keys(), ...Object.keys(baseline)]);
  const out = new Map<string, FileStatus>();
  for (const p of paths) {
    const l = local.get(p);
    const r = remote.get(p);
    const b = baseline[p];
    let s: FileStatus;
    if (l !== undefined && r !== undefined) {
      s =
        l === r ? "same" : b === l ? "remoteModified" : b === r ? "localModified" : "bothModified";
    } else if (l !== undefined) {
      s = b === undefined ? "localNew" : b === l ? "remoteDeleted" : "remoteDeletedLocalModified";
    } else if (r !== undefined) {
      s = b === undefined ? "remoteNew" : b === r ? "localDeleted" : "localDeletedRemoteModified";
    } else {
      s = "bothDeleted";
    }
    out.set(p, s);
  }
  return out;
}

// --- per-project remote + baseline (stored in the project's IndexedDB meta) ---
const REMOTE_KEY = "github:remote";
const BASELINE_KEY = "github:baseline";

export const loadRemote = (vfs: VFS): Promise<GithubRemote | undefined> =>
  vfs.getMeta<GithubRemote>(REMOTE_KEY);
const saveRemote = (vfs: VFS, r: GithubRemote): Promise<void> => vfs.setMeta(REMOTE_KEY, r);
const loadBaseline = async (vfs: VFS): Promise<Baseline> =>
  (await vfs.getMeta<Baseline>(BASELINE_KEY)) ?? {};
const saveBaseline = (vfs: VFS, b: Baseline): Promise<void> => vfs.setMeta(BASELINE_KEY, b);

export async function unlink(vfs: VFS): Promise<void> {
  await vfs.setMeta(REMOTE_KEY, undefined);
  await vfs.setMeta(BASELINE_KEY, undefined);
}

// --- local snapshot ---
async function localShas(vfs: VFS): Promise<Map<string, { sha: string; mtime: number }>> {
  const files = (await vfs.list()).filter((f) => f.kind === "file");
  const out = new Map<string, { sha: string; mtime: number }>();
  for (const f of files) {
    out.set(f.path, { sha: await gitBlobSha(await vfs.readBytes(f.path)), mtime: f.modifiedAt });
  }
  return out;
}

const shaMap = (local: Map<string, { sha: string; mtime: number }>): Map<string, string> =>
  new Map([...local].map(([p, v]) => [p, v.sha]));

async function download(
  vfs: VFS,
  r: GithubRemote,
  token: string,
  p: string,
  sha: string,
): Promise<void> {
  const bytes = await getBlob(token, r.owner, r.repo, sha);
  await vfs.writeBlob(p, new Blob([bytes as BlobPart]), mimeFromPath(p));
}

// --- public operations ---

export interface ConflictReport {
  path: string;
  status: FileStatus;
  resolution: "remote" | "local";
}
export interface PullResult {
  downloaded: string[];
  deleted: string[];
  conflicts: ConflictReport[];
}

export async function clone(
  vfs: VFS,
  token: string,
  owner: string,
  repo: string,
): Promise<GithubRemote> {
  const info = await getRepo(token, owner, repo);
  const remote: GithubRemote = { owner, repo, branch: info.default_branch };
  const tree = await listTree(token, owner, repo, remote.branch);
  enforceLimits(tree);
  const baseline: Baseline = {};
  for (const e of tree) {
    const p = "/" + e.path;
    await download(vfs, remote, token, p, e.sha);
    baseline[p] = e.sha;
  }
  await saveRemote(vfs, remote);
  await saveBaseline(vfs, baseline);
  return remote;
}

// Associate an existing project with a repo (no download). The next pull/push
// reconciles overlapping files (empty baseline -> overlaps surface as conflicts).
export async function link(
  vfs: VFS,
  token: string,
  owner: string,
  repo: string,
): Promise<GithubRemote> {
  const info = await getRepo(token, owner, repo);
  const remote: GithubRemote = { owner, repo, branch: info.default_branch };
  await saveRemote(vfs, remote);
  await saveBaseline(vfs, {});
  return remote;
}

// Pull remote into the local VFS. Non-conflicting remote changes are applied
// automatically; conflicts are resolved by "newer wins" and reported.
export async function pull(vfs: VFS, token: string, remote: GithubRemote): Promise<PullResult> {
  const tree = await listTree(token, remote.owner, remote.repo, remote.branch);
  enforceLimits(tree);
  const remoteMap = new Map(tree.map((e) => ["/" + e.path, e.sha] as const));
  const local = await localShas(vfs);
  const status = classify(shaMap(local), remoteMap, await loadBaseline(vfs));
  const baseline = await loadBaseline(vfs);

  const downloaded: string[] = [];
  const deleted: string[] = [];
  const conflicts: ConflictReport[] = [];

  const remoteNewer = async (p: string): Promise<boolean> => {
    const rd = await lastCommitDate(token, remote.owner, remote.repo, remote.branch, p.slice(1));
    const ld = local.get(p)?.mtime ?? 0;
    return rd !== undefined ? rd > ld : false;
  };

  for (const [p, s] of status) {
    const rSha = remoteMap.get(p);
    if (s === "remoteNew" || s === "remoteModified") {
      await download(vfs, remote, token, p, rSha!);
      baseline[p] = rSha!;
      downloaded.push(p);
    } else if (s === "remoteDeleted") {
      await vfs.delete(p);
      delete baseline[p];
      deleted.push(p);
    } else if (s === "same") {
      baseline[p] = rSha!;
    } else if (s === "bothModified") {
      const remote_ = await remoteNewer(p);
      if (remote_) {
        await download(vfs, remote, token, p, rSha!);
        downloaded.push(p);
      }
      baseline[p] = rSha!; // if local kept, it becomes localModified vs remote (pushable)
      conflicts.push({ path: p, status: s, resolution: remote_ ? "remote" : "local" });
    } else if (s === "remoteDeletedLocalModified") {
      if (await remoteNewer(p)) {
        await vfs.delete(p);
        deleted.push(p);
        conflicts.push({ path: p, status: s, resolution: "remote" });
      } else {
        conflicts.push({ path: p, status: s, resolution: "local" }); // keep local -> re-added on push
      }
      delete baseline[p];
    } else if (s === "localDeletedRemoteModified") {
      // No local-deletion timestamp; restore remote to avoid losing remote changes.
      await download(vfs, remote, token, p, rSha!);
      baseline[p] = rSha!;
      downloaded.push(p);
      conflicts.push({ path: p, status: s, resolution: "remote" });
    }
    // localNew / localModified / localDeleted / bothDeleted: left for push.
  }
  await saveBaseline(vfs, baseline);
  return { downloaded, deleted, conflicts };
}

export interface PushResult {
  pushed: string[];
  deleted: string[];
  conflicts: { path: string; status: FileStatus }[];
}

// Push local changes as a single commit. If both sides changed a file, returns
// the conflicts without pushing (the caller should pull/resolve first).
export async function push(
  vfs: VFS,
  token: string,
  remote: GithubRemote,
  message: string,
): Promise<PushResult> {
  const { owner, repo, branch } = remote;
  const tree = await listTree(token, owner, repo, branch);
  const remoteMap = new Map(tree.map((e) => ["/" + e.path, e.sha] as const));
  const local = await localShas(vfs);
  const status = classify(shaMap(local), remoteMap, await loadBaseline(vfs));

  const conflicts = [...status]
    .filter(([, s]) => isConflict(s))
    .map(([path, s]) => ({ path, status: s }));
  if (conflicts.length) return { pushed: [], deleted: [], conflicts };

  const baseline = await loadBaseline(vfs);
  const changes: TreeChange[] = [];
  const pushed: string[] = [];
  const deleted: string[] = [];
  for (const [p, s] of status) {
    if (s === "localNew" || s === "localModified") {
      const sha = await createBlob(token, owner, repo, await vfs.readBytes(p));
      changes.push({ path: p.slice(1), sha });
      baseline[p] = sha;
      pushed.push(p);
    } else if (s === "localDeleted") {
      changes.push({ path: p.slice(1), sha: null });
      delete baseline[p];
      deleted.push(p);
    }
    // remote*/same: leave baseline untouched (remote-only changes stay "behind").
  }
  if (changes.length === 0) return { pushed, deleted, conflicts: [] };

  const head = await getHeadCommit(token, owner, repo, branch);
  const treeSha = await createTree(token, owner, repo, head.tree, changes);
  const commit = await createCommit(token, owner, repo, message, treeSha, head.commit);
  await updateBranch(token, owner, repo, branch, commit);
  await saveBaseline(vfs, baseline);
  return { pushed, deleted, conflicts: [] };
}

// Are there local changes not yet pushed? (drives the "ahead" status / unload warning)
export async function hasLocalChanges(vfs: VFS): Promise<boolean> {
  const baseline = await loadBaseline(vfs);
  const local = shaMap(await localShas(vfs));
  for (const [p, sha] of local) if (baseline[p] !== sha) return true;
  for (const p of Object.keys(baseline)) if (!local.has(p)) return true;
  return false;
}
