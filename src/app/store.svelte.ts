import type { AssetResolver } from "../load/assets";
import {
  CachingResolver,
  OverrideResolver,
  FetchAssetResolver,
  isWritable,
  normalizePath,
} from "../load/assets";
import { openDirectory } from "../load/fs-access";
import { openZip, ZipAssetResolver } from "../load/zip";
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
import { downloadBytes } from "../lib/download";
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

export type ProjectKind = "sample" | "folder" | "zip";

// --- リアクティブ状態 (Runes) ---
let yamlText = $state("");
let compiled = $state.raw<CompiledDeck | null>(null); // 最後に成功した結果
let errors = $state.raw<PipelineError[]>([]);
let currentSlide = $state(0);
let ready = $state(false);
let entry = $state("deck.yaml");
let projectName = $state("examples/basic");
let projectKind = $state<ProjectKind>("sample");
let dirty = $state(false);
let saving = $state(false);
let selectedIndex = $state<number | null>(null);

// --- 非リアクティブな保持物 ---
let sourceResolver: AssetResolver | null = null;
let baseResolver: AssetResolver | null = null;
let zipResolver: ZipAssetResolver | null = null;
// フォント/画像は編集中に変わらない前提でキャッシュし、編集時は再ロードしない。
let cachedCtx: LowerCtx | null = null;
let cachedFonts: Map<string, LoadedFont> | null = null;

function overrideResolver(): AssetResolver {
  if (!baseResolver) throw new Error("store 未初期化");
  return new OverrideResolver(
    baseResolver,
    new Map([[normalizePath(entry), yamlText]]),
  );
}

function clampSlide() {
  const n = compiled ? compiled.deck.slides.length : 0;
  if (currentSlide >= n) currentSlide = Math.max(0, n - 1);
}

// 初回の完全コンパイル (フォント/画像ロードを含む)。
async function fullCompile() {
  const result = await compileDeck(overrideResolver(), { entry });
  errors = result.errors;
  if (result.compiled) {
    compiled = result.compiled;
    cachedCtx = result.compiled.ctx;
    cachedFonts = result.compiled.fonts;
    clampSlide();
    await registerFonts(result.compiled.fonts);
  }
}

// 編集時の軽量再コンパイル: parse + normalize のみ、ctx/fonts は再利用。
// 失敗時は前回成功した compiled を保持し、errors のみ更新する。
async function liveRecompile() {
  if (!cachedCtx || !cachedFonts) {
    await fullCompile();
    return;
  }
  const result = await recompileDeck(overrideResolver(), entry);
  errors = result.errors;
  if (result.deck) {
    compiled = { deck: result.deck, ctx: cachedCtx, fonts: cachedFonts };
    clampSlide();
  }
}

const scheduleRecompile = debounce(() => {
  void liveRecompile();
}, 200);

// テキスト更新の共通処理 (エディタ入力 / インスペクタ書き戻し 両方)。
function applyYaml(text: string) {
  yamlText = text;
  dirty = true;
  scheduleRecompile();
}

// 現在スライドのソース要素パス。
function selectedPath(): Path {
  return ["slides", currentSlide, "elements", selectedIndex ?? 0];
}

async function loadProject(
  source: AssetResolver,
  entryPath: string,
  name: string,
  kind: ProjectKind,
) {
  ready = false;
  sourceResolver = source;
  baseResolver = new CachingResolver(source);
  zipResolver = source instanceof ZipAssetResolver ? source : null;
  entry = entryPath;
  projectName = name;
  projectKind = kind;
  cachedCtx = null;
  cachedFonts = null;
  currentSlide = 0;
  yamlText = await baseResolver.readText(entryPath);
  await fullCompile();
  dirty = false;
  ready = true;
}

export const store = {
  get yamlText() {
    return yamlText;
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
  get ready() {
    return ready;
  },
  get entry() {
    return entry;
  },
  get projectName() {
    return projectName;
  },
  get projectKind() {
    return projectKind;
  },
  get dirty() {
    return dirty;
  },
  get saving() {
    return saving;
  },
  get canSave() {
    return sourceResolver !== null && isWritable(sourceResolver);
  },
  get slideCount() {
    return compiled ? compiled.deck.slides.length : 0;
  },

  // バンドルされたサンプルを開く (読み取り専用)。
  async openSample(baseUrl: string) {
    await loadProject(
      new FetchAssetResolver(baseUrl),
      "deck.yaml",
      "examples/basic",
      "sample",
    );
  },

  // ローカルフォルダを開く (File System Access API、書き込み可)。
  async openFolder(): Promise<boolean> {
    const opened = await openDirectory();
    if (!opened) return false;
    await loadProject(opened.resolver, "deck.yaml", opened.name, "folder");
    return true;
  },

  // アップロードされた ZIP を開く (メモリ上、書き込み可)。
  async openZipFile(file: File) {
    const opened = await openZip(file);
    await loadProject(opened.resolver, opened.entry, opened.name, "zip");
  },

  // 編集中の deck テキストをプロジェクトへ書き戻す。
  async save() {
    if (!sourceResolver || !isWritable(sourceResolver) || saving) return;
    saving = true;
    try {
      await sourceResolver.writeText(entry, yamlText);
      dirty = false;
    } finally {
      saving = false;
    }
  },

  // ZIP プロジェクトを保存して再ダウンロードする。
  async exportZip() {
    if (!zipResolver) return;
    await this.save();
    const blob = await zipResolver.toBlob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    downloadBytes(bytes, projectName.endsWith(".zip") ? projectName : "deck.zip", "application/zip");
  },

  // エディタからのテキスト更新。即座に状態反映し、再コンパイルはデバウンス。
  setYaml(text: string) {
    applyYaml(text);
  },

  // --- インスペクタ (AST 書き戻し) ---
  get selectedIndex() {
    return selectedIndex;
  },
  // 現在スライドのソース要素一覧 (AST ベース、編集対象)。
  get sourceElements(): ElementRef[] {
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
  // 選択要素のフィールド (ネスト可) の現在値を文字列で取得。
  getFieldValue(field: Path): string {
    if (selectedIndex === null) return "";
    try {
      return getField(parseDeck(yamlText), selectedPath(), field);
    } catch {
      return "";
    }
  },
  // 選択要素のフィールドを AST 経由で更新 (コメント・書式を保持)。
  updateField(field: Path, value: string) {
    if (selectedIndex === null) return;
    const doc = parseDeck(yamlText);
    setField(doc, selectedPath(), field, value);
    applyYaml(serialize(doc));
  },
  // 現在スライドにテンプレート要素を追加し選択する。
  addElement(type: string) {
    const doc = parseDeck(yamlText);
    const idx = astAddElement(doc, currentSlide, type);
    selectedIndex = idx;
    applyYaml(serialize(doc));
  },
  deleteSelected() {
    if (selectedIndex === null) return;
    const doc = parseDeck(yamlText);
    removeElement(doc, selectedPath());
    selectedIndex = null;
    applyYaml(serialize(doc));
  },

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

  // 現在/指定スライドの SVG 文字列。
  renderSvg(index = currentSlide): string {
    if (!compiled) return "";
    return renderSlideSvg(compiled, index) ?? "";
  },
};
