import type { AssetResolver } from "../load/assets";
import { OverrideResolver } from "../load/assets";
import { VfsResolver } from "../load/vfs-resolver";
import { openVfs, type VFS, type FileEntry } from "../vfs";
import { extname, dirname, basename, join, normalize, isDescendant } from "../vfs/path";
import { uniqueName, type UploadEntry } from "./editor/file-ops";
import {
  dbNameFor,
  registerProject,
  unregisterProject,
  projectExists,
  listProjects,
  getLastProject,
  setLastProject,
  type ProjectMeta,
} from "./projects";
import {
  compileDeck,
  recompileDeck,
  renderSlideSvg,
  type CompiledDeck,
} from "../pipeline";
import type { LowerCtx, LoadedFont } from "../lower/context";
import type { PipelineError } from "../lib/error";
import { debounce } from "../lib/debounce";
import { registerFonts } from "../lib/fonts-register";
import { isImagePath } from "../lib/mime";
import { collectBrokenReferences, type Reference } from "../load/references";

const ENTRY = "deck.yaml"; // VFS では /deck.yaml

// --- リアクティブ状態 ---
// 画面遷移は URL ハッシュで決める (App 側)。store は VFS 初期化状態のみ持つ。
let booting = $state(true); // 初期化完了まで true
let ready = $state(false); // プロジェクトがロード済み (エディタ表示可能)
let currentProject = $state<string | null>(null);
let projectsVersion = $state(0); // レジストリ変更時に増やして projects を再評価
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

// --- 非リアクティブ ---
let vfs: VFS | null = null;
let cachedCtx: LowerCtx | null = null;
let cachedFonts: Map<string, LoadedFont> | null = null;
let unsubscribe: (() => void) | null = null;

function isYaml(path: string): boolean {
  const e = extname(path);
  return e === ".yaml" || e === ".yml";
}

function compileResolver(): AssetResolver {
  if (!vfs) throw new Error("VFS 未初期化");
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

async function fullCompile() {
  const result = await compileDeck(compileResolver(), { entry: ENTRY });
  errors = result.errors;
  if (result.compiled) {
    compiled = result.compiled;
    cachedCtx = result.compiled.ctx;
    cachedFonts = result.compiled.fonts;
    clampSlide();
    await registerFonts(result.compiled.fonts);
  }
}

async function liveRecompile() {
  if (!cachedCtx || !cachedFonts) {
    await fullCompile();
    return;
  }
  const result = await recompileDeck(compileResolver(), ENTRY);
  errors = result.errors;
  if (result.deck) {
    compiled = { deck: result.deck, ctx: cachedCtx, fonts: cachedFonts };
    clampSlide();
  }
}

async function recomputeRefs() {
  if (vfs) {
    brokenRefs = await collectBrokenReferences(
      vfs,
      openPath,
      dirty ? yamlText : undefined,
    );
  }
}

// 編集中ファイルを VFS に書き戻す。自己保存中フラグで、保存由来の VFS イベントが
// 不要な full recompile を起こさないようにする (編集は live recompile 済み)。
let selfSaving = false;
async function saveCurrent() {
  if (!vfs || !dirty || !isYaml(openPath)) return;
  selfSaving = true;
  try {
    await vfs.writeText(openPath, yamlText);
    dirty = false;
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
  scheduleSave(); // 変更を自動保存
}

// 名前付きプロジェクトの VFS (= 専用 IndexedDB) に切り替える。
async function useVfs(name: string) {
  unsubscribe?.();
  unsubscribe = null;
  vfs?.dispose();
  vfs = await openVfs(dbNameFor(name));
  currentProject = name;
  setLastProject(name);
}

// 現在の vfs からプロジェクトを読み込み、コンパイルして ready にする。
async function loadCurrentProject() {
  if (!vfs) return;
  unsubscribe?.();
  unsubscribe = vfs.subscribe(() => {
    if (selfSaving) return; // 自動保存由来は live recompile 済みなのでスキップ
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
  // 壊れた参照を持つ YAML ファイルパスの集合 (ツリーの赤ドット用)。
  get filesWithBrokenRefs(): Set<string> {
    return new Set(brokenRefs.map((r) => r.fromFile));
  },
  // プロジェクトがロード済みでエディタ表示可能か。
  get ready() {
    return ready;
  },
  get currentProject() {
    return currentProject;
  },
  // 保存済みプロジェクト一覧 (選択画面用)。projectsVersion で再評価を駆動。
  get projects(): ProjectMeta[] {
    projectsVersion;
    return listProjects();
  },
  projectExists(name: string): boolean {
    return projectExists(name);
  },
  get slideCount() {
    return compiled ? compiled.deck.slides.length : 0;
  },
  get vfs() {
    return vfs;
  },

  // 起動: 最後に開いたプロジェクトがあれば復元しておく (#editor のリロード対応)。
  // どの画面を出すかは URL ハッシュで決める (App)。
  async boot() {
    void navigator.storage?.persist?.();
    const last = getLastProject();
    if (last && projectExists(last)) {
      await useVfs(last);
      await loadCurrentProject();
    }
    booting = false;
  },

  // 既存プロジェクトを開く (選択画面から)。
  async openProject(name: string) {
    if (!projectExists(name)) throw new Error(`プロジェクト "${name}" がありません`);
    ready = false;
    await useVfs(name);
    await loadCurrentProject();
  },

  // 新規プロジェクトを作成する。init で初期ファイルを書き込む。
  // 名前が空 / 重複ならエラー。
  async createProject(name: string, init: (vfs: VFS) => Promise<void>) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("プロジェクト名を入力してください");
    if (projectExists(trimmed)) {
      throw new Error(`プロジェクト "${trimmed}" は既に存在します`);
    }
    ready = false;
    await useVfs(trimmed);
    await init(vfs!);
    registerProject(trimmed);
    projectsVersion++;
    await loadCurrentProject();
  },

  // プロジェクトを削除する (選択画面から)。
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

  // --- ファイルを開く / 保存 ---
  async openFile(path: string) {
    const v = vfs;
    if (!v) return;
    if (dirty && isYaml(openPath)) await this.save();
    openPath = path;
    yamlText = isYaml(path) ? await v.readText(path) : "";
    dirty = false;
  },

  // 手動保存 (Ctrl/Cmd+S)。通常は編集時に自動保存される。
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
    downloadBytes(
      new Uint8Array(await blob.arrayBuffer()),
      `deck-${ts}.zip`,
      "application/zip",
    );
  },
  async importZip(file: File, targetDir = "/") {
    if (!vfs) return;
    await vfs.importZip(file, targetDir);
  },

  // --- ツリー状態 ---
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

  // --- ファイル操作 ---
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
  // 移動後、開いているファイルのパスを追従させる。
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
    const { mimeFromPath } = await import("../lib/mime");
    downloadBytes(bytes, basename(path), mimeFromPath(path));
  },
  // OS からのアップロード。overwrite=false なら衝突分はスキップ。
  async uploadEntries(targetDir: string, entries: UploadEntry[], overwrite: boolean) {
    if (!vfs) return;
    for (const e of entries) {
      const p = normalize(join(targetDir, e.path));
      if (!overwrite && (await vfs.exists(p))) continue;
      await vfs.writeBlob(p, new Blob([e.data as BlobPart]));
    }
    this.setExpanded(targetDir, true);
  },

  // --- スライド操作 ---
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
