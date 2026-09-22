import { debounce, PipelineError } from "@slideck/core";
import {
  clearAuth,
  clone as ghClone,
  getUser,
  hasLocalChanges,
  link as ghLink,
  listRepos,
  loadAuth,
  loadRemote,
  pull as ghPull,
  push as ghPush,
  saveAuth,
  unlink,
  type GithubRemote,
  type Repo,
} from "../../github";
import * as compile from "./compile.svelte";
import * as document from "./document.svelte";
import * as project from "./project.svelte";

export type SyncStatus = "none" | "syncing" | "synced" | "ahead" | "conflict" | "error";

let githubLogin = $state<string | null>(null);
let githubToken: string | null = null;
let remote = $state.raw<GithubRemote | null>(null);
let syncStatus = $state<SyncStatus>("none");
let syncWarning = $state.raw<{ title: string; files: string[] } | null>(null);
let unloadGuardInstalled = false;

export function github(): {
  login: string | null;
  remote: GithubRemote | null;
  status: SyncStatus;
  warning: { title: string; files: string[] } | null;
} {
  return { login: githubLogin, remote, status: syncStatus, warning: syncWarning };
}

export async function refreshSyncStatus(): Promise<void> {
  const vfs = project.vfs();
  if (!vfs || !remote || !githubToken) {
    syncStatus = "none";
    return;
  }
  try {
    syncStatus = (await hasLocalChanges(vfs)) ? "ahead" : "synced";
  } catch {
    // Keep the previous status when the local snapshot is transiently unavailable.
  }
}

export const scheduleStatus = debounce(() => void refreshSyncStatus(), 800);

export async function loadGithubAuth(): Promise<void> {
  const auth = await loadAuth();
  if (auth) {
    githubToken = auth.token;
    githubLogin = auth.login;
  }
}

export function installUnloadGuard(): void {
  if (unloadGuardInstalled || typeof window === "undefined") return;
  unloadGuardInstalled = true;
  window.addEventListener("beforeunload", (event) => {
    if (remote && (syncStatus === "ahead" || syncStatus === "conflict")) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

async function runPull(): Promise<void> {
  const vfs = project.vfs();
  if (!vfs || !remote || !githubToken) return;
  await document.saveCurrent();
  syncStatus = "syncing";
  try {
    const result = await ghPull(vfs, githubToken, remote);
    await compile.reloadAfterPull();
    syncWarning = result.conflicts.length
      ? {
          title: "Conflicts auto-resolved (kept the newer version)",
          files: result.conflicts.map(
            (conflict) => `${conflict.path} — kept ${conflict.resolution}`,
          ),
        }
      : null;
    await refreshSyncStatus();
  } catch (error) {
    syncStatus = "error";
    compile.reportError(new PipelineError(`GitHub pull failed: ${String(error)}`));
  }
}

export async function connectGithub(token: string): Promise<void> {
  const trimmed = token.trim();
  const user = await getUser(trimmed);
  await saveAuth({ token: trimmed, login: user.login });
  githubToken = trimmed;
  githubLogin = user.login;
  const vfs = project.vfs();
  if (vfs) {
    remote = (await loadRemote(vfs)) ?? null;
    await refreshSyncStatus();
  }
}

export async function disconnectGithub(): Promise<void> {
  await clearAuth();
  githubToken = null;
  githubLogin = null;
  remote = null;
  syncStatus = "none";
  syncWarning = null;
}

export function listGithubRepos(): Promise<Repo[]> {
  if (!githubToken) return Promise.reject(new Error("Not connected to GitHub"));
  return listRepos(githubToken);
}

export async function cloneProject(name: string, owner: string, repo: string): Promise<void> {
  if (!githubToken) throw new Error("Not connected to GitHub");
  const token = githubToken;
  await project.createProject(name, async (vfs) => {
    await ghClone(vfs, token, owner, repo);
  });
}

export async function linkRepo(owner: string, repo: string): Promise<void> {
  const vfs = project.vfs();
  if (!vfs || !githubToken) throw new Error("Connect GitHub and open a project first");
  syncStatus = "syncing";
  remote = await ghLink(vfs, githubToken, owner, repo);
  await runPull();
}

export async function unlinkRepo(): Promise<void> {
  const vfs = project.vfs();
  if (vfs) await unlink(vfs);
  remote = null;
  syncStatus = "none";
  syncWarning = null;
}

export async function pull(): Promise<void> {
  await runPull();
}

export async function push(message = "Update from slideck"): Promise<void> {
  const vfs = project.vfs();
  if (!vfs || !remote || !githubToken) return;
  await document.saveCurrent();
  syncStatus = "syncing";
  try {
    const result = await ghPush(vfs, githubToken, remote, message);
    if (result.conflicts.length > 0) {
      syncWarning = {
        title: "Push blocked: pull first to resolve conflicts",
        files: result.conflicts.map((conflict) => conflict.path),
      };
      syncStatus = "conflict";
      return;
    }
    syncWarning = null;
    await refreshSyncStatus();
  } catch (error) {
    syncStatus = "error";
    compile.reportError(new PipelineError(`GitHub push failed: ${String(error)}`));
  }
}

export function dismissSyncWarning(): void {
  syncWarning = null;
}

project.onBoot(async () => {
  await loadGithubAuth();
  installUnloadGuard();
});
project.onProjectLoaded(async (autoPull) => {
  const vfs = project.requireVfs();
  syncWarning = null;
  remote = githubToken ? ((await loadRemote(vfs)) ?? null) : null;
  if (remote && autoPull) await runPull();
  else await refreshSyncStatus();
}, true);
document.onDocumentChanged(scheduleStatus);
