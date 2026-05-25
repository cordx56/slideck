import type { AssetResolver } from "@slideck/core";
import { OverrideResolver } from "@slideck/core";
import { VfsResolver } from "../load/vfs-resolver";
import { openVfs, openHttpVfs, probeServer, type VFS, type FileEntry } from "../vfs";
import { extname, dirname, basename, join, normalize, isDescendant } from "@slideck/core";
import { uniqueName, type UploadEntry } from "./editor/file-ops";
import {
  dbNameFor,
  registerProject,
  unregisterProject,
  projectExists,
  listProjects,
  listTemplates,
  setTemplate,
  getLastProject,
  setLastProject,
  type ProjectMeta,
} from "./projects";
import { installSample, copyProjectFiles } from "./sample";
import { compileDeck, recompileDeck, renderSlideSvg, type CompiledDeck } from "@slideck/core";
import type { LowerCtx, LoadedFont } from "@slideck/core";
import { PipelineError } from "@slideck/core";
import { debounce } from "@slideck/core";
import { registerFonts } from "../lib/fonts-register";
import { isImagePath } from "@slideck/core";
import { collectBrokenReferences, type Reference } from "@slideck/core";
import {
  loadAuth,
  saveAuth,
  clearAuth,
  getUser,
  listRepos,
  type Repo,
  loadRemote,
  unlink,
  clone as ghClone,
  link as ghLink,
  pull as ghPull,
  push as ghPush,
  hasLocalChanges,
  type GithubRemote,
} from "../github";

const ENTRY = "deck.yaml"; // /deck.yaml in the VFS

export type SyncStatus = "none" | "syncing" | "synced" | "ahead" | "conflict" | "error";

// --- Reactive state ---
// Navigation is decided by the URL hash (in App). The store only holds VFS init state.
let booting = $state(true); // true until initialization completes
let ready = $state(false); // project is loaded (editor can be shown)
let serverMode = $state(false); // running under slideck serve (disk-linked)
let currentProject = $state<string | null>(null);
let projectsVersion = $state(0); // bumped on registry change to re-evaluate projects
let openPath = $state("/deck.yaml");
let yamlText = $state("");
let dirty = $state(false);
let compiled = $state.raw<CompiledDeck | null>(null);
let errors = $state.raw<PipelineError[]>([]);
let currentSlide = $state(0);
let files = $state.raw<FileEntry[]>([]);
let brokenRefs = $state.raw<Reference[]>([]);
let expanded = $state.raw<Set<string>>(new Set());
let showHidden = $state(false);

// --- GitHub state ---
let githubLogin = $state<string | null>(null); // connected account (null = not connected)
let remote = $state.raw<GithubRemote | null>(null); // current project's linked repo
let syncStatus = $state<SyncStatus>("none");
let syncWarning = $state.raw<{ title: string; files: string[] } | null>(null); // conflict dialog

// --- Non-reactive ---
let vfs: VFS | null = null;
let githubToken: string | null = null;
let cachedCtx: LowerCtx | null = null;
let cachedFonts: Map<string, LoadedFont> | null = null;
let unsubscribe: (() => void) | null = null;

function isYaml(path: string): boolean {
  const e = extname(path);
  return e === ".yaml" || e === ".yml";
}

function compileResolver(): AssetResolver {
  if (!vfs) throw new Error("VFS not initialized");
  const base = new VfsResolver(vfs);
  if (dirty && isYaml(openPath)) {
    const key = openPath.replace(/^\//, "");
    return new OverrideResolver(base, new Map([[key, yamlText]]));
  }
  return base;
}

function clampSlide() {
  const n = compiled ? compiled.deck.slides.length : 0;
  if (currentSlide >= n) currentSlide = Math.max(0, n - 1);
}

// All update steps below are best-effort: an exception (e.g. a file removed by a
// concurrent file operation) is surfaced as an error and never left to halt the
// update loop. The next scheduled run recovers on its own.
async function fullCompile() {
  try {
    const result = await compileDeck(compileResolver(), { entry: ENTRY });
    errors = result.errors;
    if (result.compiled) {
      compiled = result.compiled;
      cachedCtx = result.compiled.ctx;
      cachedFonts = result.compiled.fonts;
      clampSlide();
      await registerFonts(result.compiled.fonts);
    }
  } catch (e) {
    errors = [new PipelineError(`compile failed: ${String(e)}`)];
  }
}

async function liveRecompile() {
  if (!cachedCtx || !cachedFonts) {
    await fullCompile();
    return;
  }
  try {
    const result = await recompileDeck(compileResolver(), ENTRY);
    errors = result.errors;
    if (result.deck) {
      compiled = { deck: result.deck, ctx: cachedCtx, fonts: cachedFonts };
      clampSlide();
    }
  } catch (e) {
    errors = [new PipelineError(`update failed: ${String(e)}`)];
  }
}

async function recomputeRefs() {
  if (!vfs) return;
  try {
    brokenRefs = await collectBrokenReferences(vfs, openPath, dirty ? yamlText : undefined);
  } catch {
    // Transient (e.g. a file removed mid-scan during a rename); keep the previous refs.
  }
}

// Write the file being edited back to the VFS. The self-saving flag keeps
// save-triggered VFS events from causing an unneeded full recompile (edits
// already did a live recompile).
let selfSaving = false;
async function saveCurrent() {
  if (!vfs || !dirty || !isYaml(openPath)) return;
  selfSaving = true;
  try {
    await vfs.writeText(openPath, yamlText);
    dirty = false;
  } catch {
    // Keep dirty so a later save retries; do not break the update loop.
  } finally {
    selfSaving = false;
  }
}

const scheduleLive = debounce(() => void liveRecompile(), 200);
const scheduleFull = debounce(() => void fullCompile(), 200);
const scheduleRefs = debounce(() => void recomputeRefs(), 200);
const scheduleSave = debounce(() => void saveCurrent(), 400);

async function refreshFiles() {
  if (vfs) files = await vfs.list();
}

function applyYaml(text: string) {
  yamlText = text;
  dirty = true;
  scheduleLive();
  scheduleRefs();
  scheduleSave(); // auto-save the change
  scheduleStatus(); // reflect unpushed changes in the sync indicator
}

// --- GitHub sync helpers ---
// Recompute the sync indicator from local-vs-baseline (cheap, no network).
async function refreshSyncStatus(): Promise<void> {
  if (!vfs || !remote || !githubToken) {
    syncStatus = "none";
    return;
  }
  try {
    syncStatus = (await hasLocalChanges(vfs)) ? "ahead" : "synced";
  } catch {
    /* keep previous status */
  }
}
const scheduleStatus = debounce(() => void refreshSyncStatus(), 800);

// After sync overwrote files on disk, reload the open file and recompile.
async function reloadOpen(): Promise<void> {
  if (!vfs) return;
  yamlText =
    isYaml(openPath) && (await vfs.exists(openPath)) ? await vfs.readText(openPath) : yamlText;
  dirty = false;
  await refreshFiles();
  cachedCtx = null;
  cachedFonts = null;
  await fullCompile();
  await recomputeRefs();
}

async function loadGithubAuth(): Promise<void> {
  const a = await loadAuth();
  if (a) {
    githubToken = a.token;
    githubLogin = a.login;
  }
}

// Warn before closing the tab if there are unpushed (or conflicting) changes.
let unloadGuardInstalled = false;
function installUnloadGuard(): void {
  if (unloadGuardInstalled || typeof window === "undefined") return;
  unloadGuardInstalled = true;
  window.addEventListener("beforeunload", (e) => {
    if (remote && (syncStatus === "ahead" || syncStatus === "conflict")) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

async function runPull(): Promise<void> {
  if (!vfs || !remote || !githubToken) return;
  await saveCurrent(); // flush unsaved edits so they participate in the diff
  syncStatus = "syncing";
  try {
    const res = await ghPull(vfs, githubToken, remote);
    await reloadOpen();
    syncWarning = res.conflicts.length
      ? {
          title: "Conflicts auto-resolved (kept the newer version)",
          files: res.conflicts.map((c) => `${c.path} — kept ${c.resolution}`),
        }
      : null;
    await refreshSyncStatus();
  } catch (e) {
    syncStatus = "error";
    errors = [new PipelineError(`GitHub pull failed: ${String(e)}`)];
  }
}

// Switch to a named project's VFS (= dedicated IndexedDB).
async function useVfs(name: string) {
  unsubscribe?.();
  unsubscribe = null;
  vfs?.dispose();
  vfs = await openVfs(dbNameFor(name));
  currentProject = name;
  setLastProject(name);
}

// Load the project from the current vfs, compile it, and become ready.
async function loadCurrentProject(autoPull = false) {
  if (!vfs) return;
  unsubscribe?.();
  unsubscribe = vfs.subscribe(() => {
    if (selfSaving) return; // skip auto-save events; already live-recompiled
    void refreshFiles();
    scheduleFull();
    scheduleRefs();
  });
  await refreshFiles();
  expanded = new Set((await vfs.getMeta<string[]>("treeExpanded")) ?? []);
  showHidden = (await vfs.getMeta<boolean>("showHidden")) ?? false;
  openPath = "/deck.yaml";
  yamlText = (await vfs.exists("/deck.yaml")) ? await vfs.readText("/deck.yaml") : "";
  dirty = false;
  cachedCtx = null;
  cachedFonts = null;
  currentSlide = 0;
  await fullCompile();
  await recomputeRefs();
  ready = true;

  // GitHub: load the linked repo for this project; auto-pull on open.
  syncWarning = null;
  remote = githubToken ? ((await loadRemote(vfs)) ?? null) : null;
  if (remote && autoPull) await runPull();
  else await refreshSyncStatus();
}

export const store = {
  get booting() {
    return booting;
  },
  get openPath() {
    return openPath;
  },
  get isYamlOpen() {
    return isYaml(openPath);
  },
  get isImageOpen() {
    return isImagePath(openPath);
  },
  get yamlText() {
    return yamlText;
  },
  get dirty() {
    return dirty;
  },
  get compiled() {
    return compiled;
  },
  get errors() {
    return errors;
  },
  get currentSlide() {
    return currentSlide;
  },
  set currentSlide(v: number) {
    currentSlide = v;
  },
  get files() {
    return files;
  },
  get brokenRefs() {
    return brokenRefs;
  },
  // Set of YAML file paths with broken references (for the tree's red dot).
  get filesWithBrokenRefs(): Set<string> {
    return new Set(brokenRefs.map((r) => r.fromFile));
  },
  // Whether a project is loaded and the editor can be shown.
  get ready() {
    return ready;
  },
  get currentProject() {
    return currentProject;
  },
  // Saved project list (for the selection screen). projectsVersion drives re-evaluation.
  get projects(): ProjectMeta[] {
    projectsVersion;
    return listProjects();
  },
  // Template projects (for "Create from template").
  get templates(): ProjectMeta[] {
    projectsVersion;
    return listTemplates();
  },
  markTemplate(name: string) {
    setTemplate(name, true);
    projectsVersion++;
  },
  unmarkTemplate(name: string) {
    setTemplate(name, false);
    projectsVersion++;
  },
  projectExists(name: string): boolean {
    return projectExists(name);
  },
  get slideCount() {
    return compiled ? compiled.deck.slides.length : 0;
  },
  // Slide aspect ratio (width/height) for thumbnail sizing.
  get slideAspect() {
    const s = compiled?.deck.slide;
    return s && s.height > 0 ? s.width / s.height : 16 / 9;
  },
  get vfs() {
    return vfs;
  },

  get serverMode() {
    return serverMode;
  },

  // --- GitHub ---
  get github() {
    return { login: githubLogin, remote, status: syncStatus, warning: syncWarning };
  },
  async connectGithub(token: string) {
    const user = await getUser(token.trim()); // validates the token
    await saveAuth({ token: token.trim(), login: user.login });
    githubToken = token.trim();
    githubLogin = user.login;
    if (vfs) {
      remote = (await loadRemote(vfs)) ?? null;
      await refreshSyncStatus();
    }
  },
  async disconnectGithub() {
    await clearAuth();
    githubToken = null;
    githubLogin = null;
    remote = null;
    syncStatus = "none";
    syncWarning = null;
  },
  listGithubRepos(): Promise<Repo[]> {
    if (!githubToken) return Promise.reject(new Error("Not connected to GitHub"));
    return listRepos(githubToken);
  },
  async cloneProject(name: string, owner: string, repo: string) {
    if (!githubToken) throw new Error("Not connected to GitHub");
    const token = githubToken;
    await this.createProject(name, async (v) => {
      await ghClone(v, token, owner, repo);
    });
  },
  async linkRepo(owner: string, repo: string) {
    if (!vfs || !githubToken) throw new Error("Connect GitHub and open a project first");
    syncStatus = "syncing";
    remote = await ghLink(vfs, githubToken, owner, repo);
    await runPull();
  },
  async unlinkRepo() {
    if (vfs) await unlink(vfs);
    remote = null;
    syncStatus = "none";
    syncWarning = null;
  },
  async pull() {
    await runPull();
  },
  async push(message = "Update from slideck") {
    if (!vfs || !remote || !githubToken) return;
    await saveCurrent();
    syncStatus = "syncing";
    try {
      const res = await ghPush(vfs, githubToken, remote, message);
      if (res.conflicts.length > 0) {
        syncWarning = {
          title: "Push blocked: pull first to resolve conflicts",
          files: res.conflicts.map((c) => c.path),
        };
        syncStatus = "conflict";
        return;
      }
      syncWarning = null;
      await refreshSyncStatus();
    } catch (e) {
      syncStatus = "error";
      errors = [new PipelineError(`GitHub push failed: ${String(e)}`)];
    }
  },
  dismissSyncWarning() {
    syncWarning = null;
  },

  // Boot: under slideck serve, open the editor immediately in disk-linked mode.
  // Otherwise, restore the last opened project if there is one
  // (to handle reloading #editor). Which screen to show is decided by the URL hash (App).
  async boot() {
    await loadGithubAuth();
    installUnloadGuard();
    const info = await probeServer();
    if (info) {
      serverMode = true;
      vfs = openHttpVfs();
      currentProject = info.name;
      await loadCurrentProject();
      booting = false;
      return;
    }
    void navigator.storage?.persist?.();
    const last = getLastProject();
    if (last && projectExists(last)) {
      await useVfs(last);
      await loadCurrentProject(true); // auto-pull on open
    }
    booting = false;
  },

  // Open an existing project (from the selection screen).
  async openProject(name: string) {
    if (!projectExists(name)) throw new Error(`Project "${name}" does not exist`);
    ready = false;
    await useVfs(name);
    await loadCurrentProject(true); // auto-pull on open
  },

  // Create a new project. init writes the initial files.
  // Error if the name is empty or duplicate.
  async createProject(name: string, init: (vfs: VFS) => Promise<void>) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Please enter a project name");
    if (projectExists(trimmed)) {
      throw new Error(`Project "${trimmed}" already exists`);
    }
    ready = false;
    await useVfs(trimmed);
    await init(vfs!);
    registerProject(trimmed);
    projectsVersion++;
    await loadCurrentProject();
  },

  // Create a project from a template. The built-in sample installs from the
  // bundled example; a project template copies its files (but not its GitHub
  // repository settings, which are stored in meta and not copied).
  async createFromTemplate(name: string, template: { sample: boolean; name?: string }) {
    await this.createProject(name, async (dest) => {
      if (template.sample) {
        await installSample(dest, `${import.meta.env.BASE_URL}examples/basic/`);
      } else if (template.name) {
        const src = await openVfs(dbNameFor(template.name));
        try {
          await copyProjectFiles(src, dest);
        } finally {
          src.dispose();
        }
      }
    });
  },

  // Delete a project (from the selection screen).
  async deleteProject(name: string) {
    if (currentProject === name) {
      unsubscribe?.();
      unsubscribe = null;
      vfs?.dispose();
      vfs = null;
      currentProject = null;
      ready = false;
    }
    unregisterProject(name);
    projectsVersion++;
    indexedDB.deleteDatabase(dbNameFor(name));
  },

  // --- Open / save files ---
  async openFile(path: string) {
    const v = vfs;
    if (!v) return;
    if (dirty && isYaml(openPath)) await this.save();
    openPath = path;
    yamlText = isYaml(path) ? await v.readText(path) : "";
    dirty = false;
  },

  // Manual save (Ctrl/Cmd+S). Normally edits are auto-saved.
  async save() {
    await saveCurrent();
  },

  setYaml(text: string) {
    applyYaml(text);
  },

  // --- ZIP ---
  async exportZip() {
    if (!vfs) return;
    const blob = await vfs.exportZip();
    const { downloadBytes } = await import("../lib/download");
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    downloadBytes(new Uint8Array(await blob.arrayBuffer()), `deck-${ts}.zip`, "application/zip");
  },
  async importZip(file: File, targetDir = "/") {
    if (!vfs) return;
    await vfs.importZip(file, targetDir);
  },

  // --- Tree state ---
  get expanded() {
    return expanded;
  },
  get showHidden() {
    return showHidden;
  },
  isExpanded(path: string): boolean {
    return expanded.has(path);
  },
  toggleExpanded(path: string) {
    const s = new Set(expanded);
    if (s.has(path)) s.delete(path);
    else s.add(path);
    expanded = s;
    void vfs?.setMeta("treeExpanded", [...s]);
  },
  setExpanded(path: string, on: boolean) {
    const s = new Set(expanded);
    if (on) s.add(path);
    else s.delete(path);
    expanded = s;
    void vfs?.setMeta("treeExpanded", [...s]);
  },
  toggleHidden() {
    showHidden = !showHidden;
    void vfs?.setMeta("showHidden", showHidden);
  },

  // --- File operations ---
  async createFile(dir: string, name: string) {
    const v = vfs;
    if (!v) return;
    const p = normalize(join(dir, name));
    await v.writeText(p, "");
    this.setExpanded(dir, true);
    await this.openFile(p);
  },
  async createFolder(dir: string, name: string) {
    if (!vfs) return;
    await vfs.createFolder(normalize(join(dir, name)));
    this.setExpanded(dir, true);
  },
  async renamePath(path: string, newName: string) {
    if (!vfs || basename(path) === newName) return;
    const to = normalize(join(dirname(path), newName));
    await vfs.move(path, to);
    await this.followMove(path, to);
  },
  async moveNode(from: string, toDir: string) {
    const v = vfs;
    if (!v) return;
    const to = normalize(join(toDir, basename(from)));
    if (from === to || to.startsWith(from + "/")) return;
    await v.move(from, to);
    await this.followMove(from, to);
  },
  // After a move, keep the open file's path in sync.
  async followMove(from: string, to: string) {
    if (openPath === from) await this.openFile(to);
    else if (isDescendant(openPath, from)) {
      await this.openFile(to + openPath.slice(from.length));
    }
  },
  async deletePath(path: string) {
    if (!vfs) return;
    const affectsOpen = openPath === path || isDescendant(openPath, path);
    await vfs.delete(path);
    if (affectsOpen) {
      if (await vfs.exists("/deck.yaml")) await this.openFile("/deck.yaml");
      else {
        openPath = "/";
        yamlText = "";
        dirty = false;
      }
    }
  },
  async duplicatePath(path: string) {
    if (!vfs) return;
    const dir = dirname(path);
    const name = await uniqueName(vfs, dir, basename(path));
    await vfs.copy(path, normalize(join(dir, name)));
  },
  async downloadFile(path: string) {
    if (!vfs) return;
    const bytes = await vfs.readBytes(path);
    const { downloadBytes } = await import("../lib/download");
    const { mimeFromPath } = await import("@slideck/core");
    downloadBytes(bytes, basename(path), mimeFromPath(path));
  },
  // Upload from the OS. With overwrite=false, conflicts are skipped.
  async uploadEntries(targetDir: string, entries: UploadEntry[], overwrite: boolean) {
    if (!vfs) return;
    for (const e of entries) {
      const p = normalize(join(targetDir, e.path));
      if (!overwrite && (await vfs.exists(p))) continue;
      await vfs.writeBlob(p, new Blob([e.data as BlobPart]));
    }
    this.setExpanded(targetDir, true);
  },

  // --- Slide operations ---
  goSlide(i: number) {
    currentSlide = Math.max(0, Math.min(this.slideCount - 1, i));
  },
  next() {
    this.goSlide(currentSlide + 1);
  },
  prev() {
    this.goSlide(currentSlide - 1);
  },
  renderSvg(index = currentSlide): string {
    if (!compiled) return "";
    return renderSlideSvg(compiled, index) ?? "";
  },
};
