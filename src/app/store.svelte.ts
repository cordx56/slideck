import type { AssetResolver } from "../load/assets";
import { OverrideResolver } from "../load/assets";
import { VfsResolver } from "../load/vfs-resolver";
import { openVfs, type VFS, type FileEntry } from "../vfs";
import { extname } from "../vfs/path";
import { installSample, createEmptyProject } from "./sample";
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
import {
  parseDeck,
  serialize,
  listSlideElements,
  getField,
  setField,
  addElement as astAddElement,
  removeElement,
  type ElementRef,
  type Path,
} from "../edit/ast";

const ENTRY = "deck.yaml"; // VFS では /deck.yaml
export type Screen = "loading" | "welcome" | "editor";

// --- リアクティブ状態 ---
let screen = $state<Screen>("loading");
let openPath = $state("/deck.yaml");
let yamlText = $state("");
let dirty = $state(false);
let compiled = $state.raw<CompiledDeck | null>(null);
let errors = $state.raw<PipelineError[]>([]);
let currentSlide = $state(0);
let files = $state.raw<FileEntry[]>([]);
let selectedIndex = $state<number | null>(null);

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

const scheduleLive = debounce(() => void liveRecompile(), 200);
const scheduleFull = debounce(() => void fullCompile(), 200);

async function refreshFiles() {
  if (vfs) files = await vfs.list();
}

function applyYaml(text: string) {
  yamlText = text;
  dirty = true;
  scheduleLive();
}

async function openProject() {
  if (!vfs) return;
  unsubscribe?.();
  unsubscribe = vfs.subscribe(() => {
    void refreshFiles();
    scheduleFull();
  });
  await refreshFiles();
  openPath = "/deck.yaml";
  yamlText = (await vfs.exists("/deck.yaml")) ? await vfs.readText("/deck.yaml") : "";
  dirty = false;
  cachedCtx = null;
  cachedFonts = null;
  currentSlide = 0;
  await fullCompile();
  screen = "editor";
}

const selectedPath = (): Path => ["slides", currentSlide, "elements", selectedIndex ?? 0];

export const store = {
  get screen() {
    return screen;
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
  get ready() {
    return screen === "editor";
  },
  get slideCount() {
    return compiled ? compiled.deck.slides.length : 0;
  },
  get vfs() {
    return vfs;
  },

  // 起動: VFS を開き、空ならようこそ画面、そうでなければプロジェクトを開く。
  async boot() {
    vfs = await openVfs();
    void navigator.storage?.persist?.();
    const list = await vfs.list();
    if (list.length === 0) screen = "welcome";
    else await openProject();
  },

  async chooseSample(baseUrl: string) {
    if (!vfs) return;
    screen = "loading";
    await installSample(vfs, baseUrl);
    await openProject();
  },
  async chooseEmpty() {
    if (!vfs) return;
    screen = "loading";
    await createEmptyProject(vfs);
    await openProject();
  },
  async chooseImportZip(file: File) {
    if (!vfs) return;
    screen = "loading";
    await vfs.importZip(file);
    await openProject();
  },

  // --- ファイルを開く / 保存 ---
  async openFile(path: string) {
    const v = vfs;
    if (!v) return;
    if (dirty && isYaml(openPath)) await this.save();
    openPath = path;
    selectedIndex = null;
    yamlText = isYaml(path) ? await v.readText(path) : "";
    dirty = false;
  },

  async save() {
    if (!vfs || !dirty || !isYaml(openPath)) return;
    await vfs.writeText(openPath, yamlText);
    dirty = false;
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

  async resetProject() {
    if (!vfs) return;
    await vfs.clear();
    compiled = null;
    cachedCtx = null;
    cachedFonts = null;
    screen = "welcome";
  },

  // --- スライド操作 ---
  goSlide(i: number) {
    currentSlide = Math.max(0, Math.min(this.slideCount - 1, i));
    selectedIndex = null;
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

  // --- インスペクタ (deck.yaml 編集時のみ) ---
  get selectedIndex() {
    return selectedIndex;
  },
  get sourceElements(): ElementRef[] {
    if (openPath !== "/deck.yaml") return [];
    try {
      return listSlideElements(parseDeck(yamlText), currentSlide);
    } catch {
      return [];
    }
  },
  get selectedRef(): ElementRef | null {
    if (selectedIndex === null) return null;
    return this.sourceElements[selectedIndex] ?? null;
  },
  selectElement(i: number | null) {
    selectedIndex = i;
  },
  getFieldValue(field: Path): string {
    if (selectedIndex === null) return "";
    try {
      return getField(parseDeck(yamlText), selectedPath(), field);
    } catch {
      return "";
    }
  },
  updateField(field: Path, value: string) {
    if (selectedIndex === null) return;
    const doc = parseDeck(yamlText);
    setField(doc, selectedPath(), field, value);
    applyYaml(serialize(doc));
  },
  addElement(type: string) {
    const doc = parseDeck(yamlText);
    selectedIndex = astAddElement(doc, currentSlide, type);
    applyYaml(serialize(doc));
  },
  deleteSelected() {
    if (selectedIndex === null) return;
    const doc = parseDeck(yamlText);
    removeElement(doc, selectedPath());
    selectedIndex = null;
    applyYaml(serialize(doc));
  },
};
