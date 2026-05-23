# YAML スライド作成 Web アプリケーション — 実装計画

## 0. プロジェクト概要

YAML を宣言的記述として受け取り、ブラウザ上でスライドを作成・編集・プレゼンテーション・PDF出力できるアプリケーション。

### ゴール
- **すべてフロントエンド完結**: デプロイ時にサーバ不要。静的ホスティング（GitHub Pages 等）で配布可能。
- **宣言的記述**: スライドのフォント、テキスト、画像、位置、テーマを YAML で記述。
- **二つのレンダリングターゲット**: プレゼンタ用の SVG レンダラと、フォント埋め込み対応の PDF レンダラが同一 IR を消費。
- **再利用可能なテーマ**: テーマがスキーマ付き変数を定義し、スライドが値を流し込む（タイトルテンプレート等）。
- **エディタ UI**: 左に要素パレット/アウトライン、中央にスライドプレビュー、右に YAML エディタの3ペイン構成。

### 非ゴール（初期版）
- 共同編集 / クラウド保存
- アニメーション・トランジション
- 双方向の WYSIWYG 編集（インスペクタからの書き戻しはフェーズ2）

---

## 1. 技術スタック

### コア
- **Vite** + **TypeScript** (strict mode)
- **Svelte 5 (Runes)** — UI フレームワーク。状態が薄く描画主体のドメインのため、React より軽量で適合。
- **CSS Grid** — 3ペインレイアウト。リサイズは後付けで `svelte-splitpanes` を導入。

### ライブラリ
| 用途 | ライブラリ | 備考 |
|---|---|---|
| YAML パース | `yaml` (eemeli/yaml) | 位置情報保持、Document API で AST 編集可能 |
| スキーマ検証 | `zod` | TS 型の自動導出、エラーパス情報 |
| PDF 生成 | `pdf-lib` + `@pdf-lib/fontkit` | カスタムフォント埋め込み + サブセット化 |
| コードエディタ | CodeMirror 6 (`@codemirror/state`, `@codemirror/view`, `@codemirror/lang-yaml`, `@codemirror/lint`) | Monaco より軽量、リンター差し込みが容易 |
| アイコン | `lucide-svelte` 等の軽量セット | 任意 |

### 開発ツール
- ESLint + Prettier
- Vitest (ユニット), Playwright (E2E、フェーズ後半)

---

## 2. アーキテクチャ — 三層 IR

コンパイラスタイルの IR 階層で、レンダラ間の一貫性を担保する。

```
YAML (テキスト)
   │ parse + validate (zod)
   ▼
HIR : ユーザ宣言そのまま（変数展開前、テーマ未適用、% 単位）
   │ normalize: テーマ継承解決, 変数展開, デフォルト適用, オーバーレイ合成
   ▼
MIR : 正規化されたスライドモデル（依然として % 単位、グループ階層保持）
   │ lower: % → px 解決, グループ座標展開, テキストシェイピング, auto-layout 展開
   ▼
LIR : レンダリングプリミティブ列（絶対座標, グループなし, シェイプ済みテキスト）
   │
   ├── SVG renderer (presenter / preview)
   └── PDF renderer (pdf-lib)
```

### 各層の責務

**HIR**: zod で検証した YAML そのもの。`Deck`, `Slide`, `Element`, `Theme`, `Position` 等の型がここに住む。`${var}` 文字列はまだ未解決。

**MIR**: HIR からの正規化結果。
- テーマの `layout` を下敷きにし、スライドの `elements` を重畳
- 全ての `${var}` を解決済み（型チェック後）
- デフォルト値（`defaults.text` 等）を適用済み
- グループ階層は保持（座標は親グループ相対のまま）
- `position` は依然として % 表現

**LIR**: レンダリングプリミティブの平坦リスト。
- グループは展開され、絶対座標（スライド左上原点、px 単位）に解決
- `auto-layout` は通常配置に展開
- テキストは行単位・文字単位に分解（PDF と SVG で同一の折り返し結果を得るため）
- `Primitive` の union 型: `text`, `image`, `rect`, `path`, `line`

```ts
type Primitive =
  | { kind: "text"; x: number; y: number; runs: TextRun[]; align: Align }
  | { kind: "image"; x: number; y: number; w: number; h: number; data: Uint8Array; mime: string }
  | { kind: "rect"; x: number; y: number; w: number; h: number; fill?: string; stroke?: Stroke; rx?: number }
  | { kind: "path"; d: string; fill?: string; stroke?: Stroke }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; stroke: Stroke };

type TextRun = { text: string; font: FontRef; size: number; color: string; x: number; y: number };
type FontRef = { family: string; weight?: number; style?: "normal" | "italic" };
```

LIR まで来た時点で、SVG レンダラと PDF レンダラはそれぞれプリミティブを 1:1 でレンダリング API に流すだけになる。

---

## 3. YAML スキーマ詳細

### 3.1 プロジェクト構造

ユーザのプロジェクトは以下のような構成を想定:

```
my-deck/
├── deck.yaml           # エントリ。スライド本体
├── theme.yaml          # テーマ定義（複数可）
├── overlays/
│   └── footer.yaml
├── fonts/
│   ├── NotoSansJP-Regular.ttf
│   └── NotoSansJP-Bold.ttf
└── img/
    ├── fig1.png
    └── cover.png
```

エントリは `deck.yaml`。相対パスは `deck.yaml` からの相対で解決。

### 3.2 テーマ定義

```yaml
# theme.yaml
name: standard
extends: ./base-theme.yaml    # 任意。テーマ継承

fonts:
  heading: { path: ./fonts/NotoSansJP-Bold.ttf, family: heading }
  body:    { path: ./fonts/NotoSansJP-Regular.ttf, family: body }

colors:
  bg: "#0e0e10"
  fg: "#f5f5f5"
  accent: "#7aa2f7"
  muted: "#9c9a92"

slide:
  width: 1920
  height: 1080

defaults:
  text: { family: body, size: 36, color: fg }

# 変数スキーマ（このテーマを use するスライドが流し込む値の型定義）
schema:
  vars:
    title:    { type: string, required: true }
    subtitle: { type: string, default: "" }
    accent:   { type: color, default: "#7aa2f7" }

# レイアウト（変数を ${...} で参照可能）
layout:
  - type: text
    position: { left: center, top: 15%, width: 90% }
    font: heading
    size: 96
    color: fg
    align: center
    text: ${title}

  - type: text
    position: { left: center, top: 32%, width: 90% }
    font: body
    size: 36
    color: ${accent}
    align: center
    text: ${subtitle}
```

`schema.vars` の `type` は以下をサポート:
- `string` / `number` / `boolean`
- `color` — `#rrggbb` または theme.colors のキー
- `image` — パス文字列（実在チェックは normalize 時）
- `enum` — `values: [...]` を併記

### 3.3 deck.yaml

```yaml
theme: ./theme.yaml           # メインテーマ
themes:                       # 追加テーマ（任意）
  - ./theme-section.yaml
  - ./theme-blank.yaml

overlays:                     # 全スライドに適用される要素
  - ./overlays/footer.yaml

slides:
  - id: intro
    use: standard             # 使うテーマ名（省略時はメインテーマ）
    vars:
      title: "Rust 型システムの探検"
      subtitle: "negative bounds と decidability"
    elements:                 # テーマレイアウトに追加で重ねる要素
      - type: image
        src: ./img/cover.png
        position: { right: 5%, bottom: 5%, width: 20% }

  - id: agenda
    use: standard
    vars:
      title: "目次"
    elements:
      - type: group
        position: { left: 10%, right: 10%, top: 40%, bottom: 15% }
        layout: column
        gap: 4%
        children:
          - { type: text, text: "1. 背景", size: 48 }
          - { type: text, text: "2. 関連研究", size: 48 }
          - { type: text, text: "3. 提案手法", size: 48 }
```

### 3.4 配置システム

`position` は CSS の absolute positioning と同じセマンティクス。

#### 基本

```yaml
position: { left: 10%, top: 20%, width: 80%, height: 60% }
position: { left: 10%, right: 10%, top: 20%, height: 60% }   # 幅は自動
position: { left: 10%, right: 10%, top: 10%, bottom: 10% }   # 矩形が決まる
```

許容される指定パターン（each axis 独立）:
- `left + width` / `right + width` / `left + right`
- `top + height` / `bottom + height` / `top + bottom`

それ以外（`left + right + width` のような過剰指定、`width` のみのような不足）は validation エラー。

#### 中央配置

`left` および `top` には特殊値 `center` を許可する:

```yaml
position: { left: center, top: 20%, width: 60% }
position: { left: center, top: center, width: 60%, height: 40% }
```

`center` は normalize 時に `(parent_extent - own_size) / 2` に展開される。

#### 単位

- `%` — 親（スライドまたは親グループ）に対する比率
- `px` — 絶対ピクセル（スライドの論理座標系。`slide.width/height` 基準）
- 数値のみ — `px` として解釈

初期実装では `%` のみ完全サポート。`px` は後付けで OK。

### 3.5 グループ

グループは子要素にとって新しい座標系を提供する。

```yaml
- type: group
  id: figure-block
  position: { left: 10%, right: 10%, top: 30%, bottom: 10% }
  children:
    - type: rect
      position: { left: 0%, top: 0%, width: 100%, height: 100% }
      fill: bg-secondary
    - type: text
      position: { left: center, top: 40%, width: 80% }
      text: "結果"
```

`children` 内の `%` は親グループのボックスに対する相対値。

#### auto-layout（任意）

Figma の auto-layout 相当の機能。`layout: row | column` を指定すると、子要素が gap を挟んで並ぶ。

```yaml
- type: group
  position: { left: 10%, right: 10%, bottom: 20%, height: 30% }
  layout: row              # row | column
  gap: 2%                  # 子要素間のギャップ（親グループ基準の %）
  align: center            # cross-axis: start | center | end | stretch
  justify: space-between   # main-axis: start | center | end | space-between | space-around
  padding: 2%              # 任意。グループ内パディング
  children:
    - { type: image, src: ./a.png, flex: 1 }   # main-axis での比率
    - { type: image, src: ./b.png, flex: 1 }
    - { type: image, src: ./c.png, flex: 1 }
```

`flex` を指定した子要素は main-axis の残余空間を比率配分される。`flex` がない場合は自身のサイズに従う。

auto-layout は **lower フェーズで通常配置に完全展開** されるため、LIR には残らない。

### 3.6 要素タイプ

| type | 必須フィールド | 任意フィールド |
|---|---|---|
| `text` | `text`, `position` | `font`, `size`, `color`, `align`, `lineHeight`, `letterSpacing` |
| `image` | `src`, `position` | `fit`: `contain` / `cover` / `fill` |
| `rect` | `position` | `fill`, `stroke`, `strokeWidth`, `rx` |
| `line` | `from`, `to` | `stroke`, `strokeWidth` |
| `path` | `d` | `fill`, `stroke`, `strokeWidth` |
| `group` | `position`, `children` | `layout`, `gap`, `align`, `justify`, `padding` |

### 3.7 変数展開

`${name}` 構文。展開コンテキストはスコープ階層で resolve:

```
theme.schema.vars defaults
    ← deck-level vars (optional, 全スライド共通変数)
    ← slide.vars
    ← group.vars (任意、将来拡張)
```

- 展開は **HIR → MIR の normalize フェーズ** で完了する
- 型は theme.schema.vars で宣言された型で検証される
- `color: ${accent}` のような構造化埋め込みもサポート（文字列でない場合は丸ごと置換）
- 文字列内埋め込み: `text: "Hello ${name}!"` のような部分置換も可能
- 未定義変数の参照、型不一致は validation エラー（位置情報付き）

---

## 4. レンダラ

### 4.1 SVG レンダラ

プレゼンタ UI と中央プレビューで使用。

- `<svg viewBox="0 0 ${slide.width} ${slide.height}">` を出力
- LIR の各 Primitive を SVG 要素にマップ
- フォントは `<defs>` 内に `@font-face` を埋め込むか、グローバルな `document.fonts.add()` で登録
- 画像は base64 化して `<image href="data:...">` に埋める（後でファイル参照に最適化可能）
- テキストは LIR の段階で行・文字単位に分解済みなので、`<text><tspan>` で配置するだけ

レンダラ自体は純粋関数: `(lir: SlideIR) => SVGElement`。

### 4.2 PDF レンダラ

pdf-lib + fontkit を使用。

```ts
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

async function renderPdf(deck: NormalizedDeck): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const fontCache = new Map<string, PDFFont>();
  for (const [key, font] of deck.fonts) {
    const bytes = await loadFontBytes(font.path);
    fontCache.set(key, await pdf.embedFont(bytes, { subset: true }));
  }

  for (const slide of deck.slides) {
    const lir = lower(slide, deck);
    const page = pdf.addPage([deck.slide.width, deck.slide.height]);
    for (const prim of lir.primitives) {
      drawPrimitive(page, prim, fontCache);
    }
  }
  return pdf.save();
}
```

#### 注意点

- **座標系の変換**: pdf-lib は左下原点・Y軸上向き。SVG / LIR は左上原点・Y軸下向き。`y_pdf = slide.height - y_lir - element_height` の変換が必要。テキストはベースライン基準なので別途オフセット。
- **フォントサブセット化**: `embedFont(bytes, { subset: true })` を必ず使用。日本語フォントは数MB単位になる。
- **OTF (CFF) サブセット化のバグ**: pdf-lib の一部バージョンで CFF フォントのサブセット化に問題がある。**初期版では TTF 推奨**。
- **テキスト配置**: 折り返しは LIR の段階で `font.widthOfTextAtSize()` ベースで解決済み。`page.drawText` を行ごとに呼ぶ。
- **シェイピング**: 日本語の単純な配置は `widthOfTextAtSize` で十分。将来的に高品質シェイピングが必要なら `harfbuzzjs` を検討（初期版では不要）。

---

## 5. テキストレイアウト

LIR を生成する `lower` フェーズで、テキストを行単位・文字単位に分解する。

```ts
function shapeText(
  text: string,
  font: PDFFont | OpenTypeFont,    // 幅計算可能なフォントオブジェクト
  size: number,
  maxWidth: number,
  align: "left" | "center" | "right",
  lineHeight: number,
): TextRun[] {
  // 1. テキストを単語/文字単位に分割（日本語は文字単位、英語は単語単位）
  // 2. greedy line breaking で行に分配
  // 3. 各行を align に応じて x オフセット
  // 4. y 座標を lineHeight に従って積み上げる
  // 5. TextRun[] を返す
}
```

SVG と PDF で同じ `shapeText` の結果を使うことが、レンダリング一貫性の鍵。

### 折り返しの方針
- 英数字: 単語境界（スペース、ハイフン）で改行
- 日本語: 文字単位で改行（簡易版。禁則処理は将来）
- 明示改行: `\n` を尊重

---

## 6. エディタ UI

### 6.1 レイアウト

```css
.editor {
  display: grid;
  grid-template-columns: 240px 1fr 420px;
  grid-template-rows: 48px 1fr;
  height: 100vh;
}
.topbar  { grid-column: 1 / -1; }
.left    { grid-column: 1; overflow-y: auto; }
.center  { grid-column: 2; display: flex; flex-direction: column; }
.right   { grid-column: 3; }
```

- **トップバー**: ファイル名、Present ボタン、Export PDF ボタン、エラー表示
- **左ペイン**: 要素パレット（Add Text / Image / Rect / Group）、アウトラインツリー、選択中要素のインスペクタ（フェーズ1は read-only）
- **中央ペイン**: 現在のスライドの SVG プレビュー、下部にサムネイル一覧
- **右ペイン**: CodeMirror 6 による YAML エディタ

### 6.2 データフロー

```
YAML text (CodeMirror)
   │ debounce 200ms
   ▼
yaml.parseDocument()  → AST + 位置情報
   │
   ▼
zod.parse()           → HIR or error
   │           ↓ error: lint marker を CodeMirror に表示、前回成功した LIR を残す
   ▼ success
normalize()           → MIR
   │
   ▼
lower(currentSlideId) → LIR
   │
   ▼
SVG renderer          → 中央プレビュー更新
```

エラー時の挙動: **古いプレビューを残したまま、エディタにのみエラーマーカーを出す**。プレビューが消えると編集中の体験が著しく悪化するため。

### 6.3 CodeMirror リンター

```ts
import { linter, Diagnostic } from "@codemirror/lint";
import { parseDocument } from "yaml";

const deckLinter = linter((view): Diagnostic[] => {
  const text = view.state.doc.toString();
  const doc = parseDocument(text, { keepSourceTokens: true });
  if (doc.errors.length > 0) {
    return doc.errors.map((e) => ({
      from: e.pos[0], to: e.pos[1],
      severity: "error", message: e.message,
    }));
  }
  const result = DeckSchema.safeParse(doc.toJSON());
  if (result.success) return [];
  return result.error.issues.map((iss) => {
    const node = doc.getIn(iss.path, true);
    const range = node?.range ?? [0, 0];
    return {
      from: range[0], to: range[1],
      severity: "error",
      message: iss.message,
    };
  });
});
```

### 6.4 サムネイル

各スライドを小さく SVG レンダリングして並べる。クリックで現在スライド切り替え。再レンダリングのコストが気になればキャッシュ。

### 6.5 プレゼンテーションモード

別ルート（`/present`）で全画面表示。
- ← → キーでスライド遷移
- Esc で復帰
- 数字キー + Enter でジャンプ
- F でフルスクリーン
- 現在は SVG をそのまま全画面拡大

---

## 7. ファイル・アセット管理

### 7.1 プロジェクトの開き方

**プライマリ**: File System Access API (`window.showDirectoryPicker()`)
- Chromium 系（Chrome, Edge）でサポート
- ローカルフォルダへの読み書きが可能
- ファイル監視は手動 polling か `FileSystemHandle` の比較で実装

**フォールバック**: ZIP アップロード
- Safari, Firefox 向け
- JSZip でメモリ上に展開
- 編集後は ZIP として再ダウンロード

### 7.2 アセット解決

`deck.yaml` 内のパスは `deck.yaml` からの相対。

```ts
interface AssetResolver {
  read(relativePath: string): Promise<Uint8Array>;
  exists(relativePath: string): Promise<boolean>;
}
```

実装は File System Access API 版と ZIP 版の2つ。

### 7.3 サンプルプロジェクト

`public/examples/` にサンプルを置き、初回起動時に「サンプルを開く」を提供する。File System Access API も ZIP もない環境（モバイル等）でも閲覧可能にする。

---

## 8. プロジェクト構造

```
slide-app/
├── PLAN.md
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
├── src/
│   ├── main.ts
│   ├── app/
│   │   ├── App.svelte
│   │   ├── editor/
│   │   │   ├── EditorView.svelte
│   │   │   ├── LeftPane.svelte
│   │   │   ├── CenterPane.svelte
│   │   │   ├── RightPane.svelte
│   │   │   └── codemirror-setup.ts
│   │   ├── present/
│   │   │   └── PresentView.svelte
│   │   └── store.svelte.ts        # Svelte 5 Runes ベースのグローバル状態
│   │
│   ├── schema/                     # HIR の型と zod スキーマ
│   │   ├── deck.ts
│   │   ├── slide.ts
│   │   ├── element.ts
│   │   ├── theme.ts
│   │   ├── position.ts
│   │   └── index.ts
│   │
│   ├── load/                       # YAML 読込・パース・$ref 解決
│   │   ├── parse.ts                # yaml.parseDocument ラッパ
│   │   ├── resolve-refs.ts         # extends, overlays, theme パス解決
│   │   └── assets.ts               # AssetResolver 実装
│   │
│   ├── normalize/                  # HIR → MIR
│   │   ├── index.ts
│   │   ├── variables.ts            # ${var} 展開と型検証
│   │   ├── theme-apply.ts          # use: <theme> の合成
│   │   ├── defaults.ts             # defaults の適用
│   │   └── overlays.ts             # オーバーレイ重畳
│   │
│   ├── lower/                      # MIR → LIR
│   │   ├── index.ts
│   │   ├── position.ts             # % → px、center 解決
│   │   ├── groups.ts               # グループ展開、座標相対化
│   │   ├── auto-layout.ts          # row/column の通常配置への展開
│   │   └── text-shaping.ts         # 折り返しと文字配置
│   │
│   ├── render/
│   │   ├── svg/
│   │   │   ├── index.ts            # renderSlide(lir): SVGElement
│   │   │   └── primitives.ts
│   │   └── pdf/
│   │       ├── index.ts            # renderPdf(deck): Promise<Uint8Array>
│   │       ├── primitives.ts
│   │       ├── fonts.ts            # フォント埋め込み・サブセット化
│   │       └── coords.ts           # 座標系変換ユーティリティ
│   │
│   ├── ir/                         # 共通型定義
│   │   ├── hir.ts
│   │   ├── mir.ts
│   │   └── lir.ts
│   │
│   └── lib/
│       ├── color.ts
│       ├── debounce.ts
│       └── error.ts                # 構造化エラー型
│
├── public/
│   └── examples/
│       └── basic/
│           ├── deck.yaml
│           ├── theme.yaml
│           └── fonts/
│
└── tests/
    ├── normalize.test.ts
    ├── lower.test.ts
    ├── position.test.ts
    └── fixtures/
```

---

## 9. 実装フェーズ

各フェーズは独立して動くものを出すことを目標とする。

### Phase 1: コアパイプライン（サーバなし、CLI 風に動くプロトタイプ）
**目標**: YAML → SVG レンダリングまで通す。エディタなし。

1. `src/ir/`, `src/schema/` の型定義
2. `src/load/parse.ts` で yaml パース + zod 検証
3. `src/normalize/` の最小実装（変数展開、テーマ継承、デフォルト適用）
4. `src/lower/` の最小実装（% → px、グループ展開、テキスト折り返し）
5. `src/render/svg/` で SVG 出力
6. Vite 上に最小 UI: ファイル選択 → SVG 表示

**動作確認**: サンプル `examples/basic/deck.yaml` が SVG で表示されること。

### Phase 2: PDF レンダラ
**目標**: 同一の LIR から PDF が出力できること。SVG と視覚的に一致する。

1. `src/render/pdf/fonts.ts` でフォント埋め込み（TTF, サブセット化）
2. `src/render/pdf/coords.ts` で座標変換
3. `src/render/pdf/primitives.ts` で各 Primitive の描画
4. UI に "Export PDF" ボタンを追加し、ダウンロードを実装

**動作確認**: 同じ deck が SVG と PDF で同じレイアウトに見えること。日本語テキストが PDF で正しく埋め込まれていること（PDF ビューアでフォント情報を確認）。

### Phase 3: エディタ UI
**目標**: 3ペインのエディタで YAML を編集しながらリアルタイムプレビュー。

1. CSS Grid による 3ペインレイアウト
2. CodeMirror 6 のセットアップ（YAML 言語、リンター連携）
3. デバウンス付きの YAML → プレビュー反映
4. 左ペイン: アウトラインツリー（read-only）
5. 中央ペイン下部: サムネイル一覧、クリックでスライド切替
6. プレゼンテーションモード（別ルート、キーバインド）

**動作確認**: YAML を編集すると 200ms 以内に中央プレビューが更新される。エラー時は赤線が出るがプレビューは古いまま保たれる。

### Phase 4: ファイルシステム統合
**目標**: ローカルプロジェクトを開いて編集・保存。

1. File System Access API による DirectoryHandle 管理
2. AssetResolver の実装（File System Access 版）
3. 保存（ファイル書き戻し）
4. ZIP アップロード版のフォールバック
5. サンプルプロジェクトの埋め込み

**動作確認**: ローカルの `deck.yaml` を開き、編集して保存できる。Chrome/Edge と Safari 両方で動く（後者は ZIP）。

### Phase 5: 拡張機能
**目標**: 高度な機能を追加。

1. 左ペインのインスペクタからの YAML 書き戻し（AST 編集による in-place 更新）
2. auto-layout の完全サポート
3. オーバーレイの完全サポート
4. PDF のテキスト選択可能化の検証（pdf-lib のドキュメント参照）
5. テーマプリセット集

---

## 10. 既知の落とし穴と対策

### pdf-lib 関連
- **CFF (OTF) サブセット化のバグ**: 初期版では TTF のみ対応する。OTF サポートは `embedFont(bytes, { subset: false })` で全埋め込みするフォールバックを持つ。
- **日本語フォントサイズ**: サブセット化必須。NotoSansJP 全埋め込みは 10MB+ になる。
- **座標系反転**: テキストはベースライン基準、画像は左下基準。LIR の y を `slide.height - y` で変換するが、要素タイプごとに追加オフセットが必要。

### YAML
- **コメントとフォーマット保持**: AST 編集（フェーズ5）では `yaml` パッケージの Document API を使い、`toString()` でシリアライズする。`JSON.stringify` 経由は禁止。
- **位置情報**: zod の `safeParse` はパス情報のみ返すので、`Document.getIn(path, true)` でノードに変換して `range` を取得する必要がある。

### Svelte 5 Runes
- `$state` でリアクティブ状態を作るが、深いオブジェクト（LIR 全体等）は `$state.frozen` の方が再評価コストが安いことがある。
- ストアの代替: グローバル状態は `store.svelte.ts` に `$state` 変数として置き、import して使う。

### File System Access API
- Chromium 系のみ。Safari/Firefox では `window.showDirectoryPicker is undefined`。
- ユーザに権限プロンプトが出る。再読込時は permission を再取得する必要があり、`requestPermission()` の呼び方に注意。

### CodeMirror 6
- バンドルが小さいとはいえ、複数パッケージに分割されている。`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/lang-yaml`, `@codemirror/lint`, `@codemirror/search` あたりを明示的に入れる必要がある。
- Svelte 5 との統合: `onMount` で EditorView を生成し、`onDestroy` で `destroy()` を呼ぶ。

### CSP / 静的ホスティング
- フォントやプロジェクトファイルをクライアントだけで扱うので、CSP は緩めに保つ。
- GitHub Pages にデプロイする場合、`base` パスを `vite.config.ts` に設定する。

---

## 11. テスト戦略

### ユニットテスト (Vitest)
- `normalize/`: 変数展開、テーマ継承、デフォルト適用、エラーケース
- `lower/position.ts`: 各 position 指定パターンの px 解決
- `lower/groups.ts`: ネストグループの座標変換
- `lower/auto-layout.ts`: row/column での子要素配置
- `lower/text-shaping.ts`: 折り返し境界、align、改行

### スナップショットテスト
- 代表的な deck.yaml のセットを `tests/fixtures/` に置き、SVG 出力をスナップショット
- LIR のスナップショットも取る（レンダラより上流のリグレッション検知）

### 視覚的回帰テスト（フェーズ後半）
- Playwright で SVG レンダリング結果のスクショ
- 同じ deck の SVG と PDF のレンダリング比較（PDF をラスタライズして diff）

---

## 12. デプロイ

```bash
# 開発
npm run dev

# 本番ビルド
npm run build       # → dist/

# GitHub Pages にデプロイ（例）
# vite.config.ts に base: '/slide-app/' を設定
# dist/ を gh-pages ブランチにプッシュ
```

`dist/` は完全に静的なので、Cloudflare Pages, Netlify, Vercel, S3 等どこでも置ける。

---

## 13. 用語集

| 用語 | 意味 |
|---|---|
| HIR | High-level IR。YAML をそのまま型付けしたもの。変数未展開、% 単位。 |
| MIR | Mid-level IR。テーマ・変数解決済み。グループ階層保持、% 単位。 |
| LIR | Low-level IR。レンダリングプリミティブ列。絶対座標、シェイプ済みテキスト。 |
| Primitive | LIR の最小描画単位（text / image / rect / line / path）。 |
| TextRun | シェイピング済みのテキスト断片。フォント、サイズ、色、座標を持つ。 |
| Auto-layout | row/column での自動配置機能。lower フェーズで通常配置に展開される。 |
| Variable | テーマで宣言され、スライドで値が流し込まれる名前付き値。`${name}` で参照。 |

---

## 14. 次のアクション（Claude Code 向け）

1. `npm create vite@latest slide-app -- --template svelte-ts` でプロジェクト初期化
2. 依存ライブラリのインストール: `yaml zod pdf-lib @pdf-lib/fontkit @codemirror/state @codemirror/view @codemirror/lang-yaml @codemirror/lint @codemirror/commands`
3. `src/ir/`, `src/schema/` を最初に書く（型ファースト）
4. **Phase 1 から順に実装**。各フェーズで動くものを残す。
5. Phase 1 完了後にこのドキュメントを再読し、Phase 2 へ進む前に仕様の齟齬を点検する。

---

## 15. 実装ステータス（2026-05-22 時点）

Phase 1〜5 すべて実装済み。テスト 49 件 (vitest)、`npm run build` / `npm run check` 通過。

### 当初計画からの差分（実装上の判断）

- **フォント**: サンプルは NotoSansJP の代わりに **IPAex Gothic/Mincho** (TrueType
  glyf) を使用。NotoSansCJK は `.ttc` かつ CFF で、PLAN 10章の指摘どおり pdf-lib の
  サブセット化に難があるため。IPAex は単一 TTF (glyf) でサブセット化が安定する。
  - サブセット化は実際に効いている (4-5 スライドで PDF 約 30KB)。ただし pdf-lib は
    標準のサブセット接頭辞を付けないため `pdffonts` の `sub` 列は `no` 表示になる。
  - `uni=yes` (ToUnicode あり) なので **PDF テキスト選択/抽出が可能** (Phase 5 項目4)。
- **TTC 対応**: `.ttc` (TrueType Collection) もフォントに使える。`load/ttc.ts` が
  読み込み時に指定インデックス (`fonts.<key>.index`, 既定 0) のフォントを単独 SFNT に
  展開するため、メトリクス計算・PDF 埋め込み・FontFace 登録は通常フォントと同じ経路で
  動く。NotoSansCJK (CFF/複数フォント) で end-to-end の埋め込みを確認済み。
- **フォント計測**: `lower/fontkit-metrics.ts` を追加。SVG と PDF が同じ `FontMetrics`
  を使うことで折り返しを一致させる (実フォント未ロード時は近似メトリクスに自動降格)。
  プレビューは FontFace API で実フォントを登録し見た目も一致させる。
- **追加モジュール** (当初構造になし):
  - `src/pipeline.ts`: parse→normalize→prepare→lower→render の全体束ね。
  - `src/load/prepare.ts`: 画像/フォントの非同期ロードと ctx 構築 (lower を同期純粋に保つ)。
  - `src/edit/ast.ts`: インスペクタ書き戻し用の YAML AST 編集 (コメント保持)。
  - `src/load/{fs-access,zip}.ts`: File System Access / ZIP の WritableResolver。
- **エディタのライブ編集**: フォント/画像は初回 prepare 結果をキャッシュし、編集時は
  `recompileDeck` (parse+normalize のみ) で高速反映 (`CachingResolver`/`OverrideResolver`)。
- **インスペクタ書き戻し**: deck.yaml の `slides[i].elements` (ソース要素) を対象に実装。
  テーマ layout/overlay 由来の要素は読み取り専用 (deck.yaml に実体が無いため)。
- **画像 fit**: `contain`/`fill` を実装。`cover` はクリップ未対応のため当面 `fill` 相当。
- **px 単位**: position の `px`/数値は実装済み (% と同等に解決)。

### 追加リファクタ: Theme/Overlay の Base 統合 (NEW-OVERLAY.md)

`theme` (use 切替) と `overlay` (全スライド重畳) を単一の **Base** 概念に統合済み。

- deck.yaml は `bases: [{ id, always?, file }]` で宣言。`always:true` が旧 overlay、
  `use:` 選択が旧 theme。`use` は文字列/配列の両対応。
- 適用順 (z 下->上): always 群 (宣言順) -> use 群 (指定順) -> slide.elements。
- 複数 base の `schema.vars` を union マージ (型不一致はエラー、required は OR、
  default 後勝ち)。`defaults` は深いマージ (後勝ち)。`colors`/`fonts` も合成。
- **色は変数**: base の `colors` は変数として変数スコープへ注入され (`${bg}` 等で参照)、
  slide の `vars` で上書き可能。`color`/`fill`/`stroke`/`background` フィールドは
  `${変数}` か hex/CSS のリテラル文字列を受ける (旧来のパレットキー直接指定は廃止)。
- システム変数 `${slideNumber}` `${slideCount}` `${slideId}` `${baseIds}` を
  normalize で自動注入。予約名で schema 宣言不可、slide.vars 上書きは警告。
- 関連ファイル: `schema/base.ts` (旧 theme.ts), `normalize/bases.ts` (旧 theme-apply.ts),
  `normalize/{schema-merge,defaults-merge,system-vars}.ts`。`overlays.ts` は廃止。
- 旧 `theme:`/`themes:`/`overlays:` フィールドは廃止 (移行警告なし、個人利用段階のため)。

### 追加リファクタ: 仮想ファイルシステム (PLAN-vfs.md)

ファイル管理を IndexedDB ベースの VFS に統一。FSA/ZIP の二系統 resolver は廃止。

- `src/vfs/`: `idb` バックエンド (files/meta store)、絶対パス正規化、イベントバス、
  Object URL キャッシュ、`fflate` による ZIP import/export。
- `VfsResolver` が `AssetResolver` を実装しパイプラインを VFS で駆動。編集中ファイルは
  `OverrideResolver` で未保存テキストを反映。
- 起動フロー: 空なら welcome (サンプル/ZIP/空)、既存なら自動オープン。サンプルは
  `examples/basic/manifest.json` を fetch して投入。
- ファイルツリー UI (FileTree/TreeNode/ContextMenu/ConfirmDialog/FilePreview):
  右クリックメニュー、インライン rename、削除確認、D&D (外部アップロード/内部移動、
  衝突ダイアログ)、キーボード操作、隠しファイルトグル、展開状態の meta 永続化。
  選択カーソルは open ファイルと別にハイライト (outline)。
- 参照グラフ (`load/references.ts`): bases[].file / extends / fonts.path / image.src を
  収集し、壊れた参照を CodeMirror 下線 + ツリー赤ドットで表示。
- 旧 LeftPane (palette/outline/inspector) は削除し FileTree に置換。非 YAML ファイルは
  右ペインを FilePreview (画像/フォント/バイナリ) に切替。

実装上の判断 (PLAN-vfs からの差分):
- **SVG は自己完結 data URI を維持** (§10.2 の getObjectURL 化は UI プレビュー/ツリーの
  `<img>` にのみ適用)。エクスポート用に SVG 単体で完結させるため、かつ Node テスト維持のため。
- フォルダ単位の ZIP ダウンロードは未実装 (プロジェクト全体エクスポートのみ)。
- §11.2 のメモリテスト (10MB 画像) はブラウザ前提のため自動検証外。

### 追加: 複数プロジェクト対応

プロジェクトを名前別に保存・切替できるようにした。

- プロジェクトのファイル実体は **名前ごとの IndexedDB データベース** (`slideck-proj:<name>`)
  に保存。名前一覧と最後に開いた名前は `src/app/projects.ts` (localStorage) で管理。
- ようこそ画面の遷移: メニュー -> 「プロジェクトを開く」で選択画面、空/サンプル/ZIP の
  作成は **プロジェクト名入力** を経てからエディタへ。名前が空または重複ならエラー表示。
- リロード時は最後のプロジェクトを復元 (`#editor` が生きる)。選択画面から削除可能
  (`indexedDB.deleteDatabase`)。
- ルーティングは従来どおり: ハッシュなし=トップ(ようこそ/選択/名前入力)、`#editor`、`#present`。

### 追加要素タイプ

- **ul / ol**: group 同様の縦並びコンテナ。子は `items`。各 item の前にマーカ
  (`•` / `1.`、`start` で開始番号変更) を gutter に描く。`gap`/`align`/`padding` と
  マーカ用の `font`/`size`/`color`。
- **インライン Markdown + 数式**: text 中にインライン記法を書ける。
  - Markdown (インラインのみ): 太字 `**`、強調 `*`/`_`、コード `` ` ``、打ち消し `~~`、
    リンク `[t](u)`。`markdown-it` の `renderInline` (html:false) を使用。
  - 数式: `$...$` を KaTeX で。変数 `${...}` とは非衝突。
  - これらを含むテキストは `richtext` プリミティブになり、SVG は `<foreignObject>` 内に
    HTML (md + KaTeX) を出す (プレビューに `katex` CSS/フォントが必要、main.ts で import)。
    PDF は HTML を組版できないため **素テキスト (runs) で代替描画**。
    `lib/richtext.ts` (renderRichHtml / richToPlain / hasRichMarkup)。ブロック要素は非対応。
  - リンク/コードのスタイルは `defaults.link` ({color, underline}) と `defaults.mono`
    ({family, color}) で指定。normalize で `RichStyle` に解決し richtext プリミティブへ。
    SVG では `<a>`/`<code>` にインライン style として注入する。

### 既知の残課題（将来）

- `cover` の正確なクリッピング、letterSpacing の描画反映、禁則処理。
- インスペクタからのテーマ/overlay 編集、グループ children の D&D 並べ替え。
- 大規模デッキでのサムネイル再レンダリングのキャッシュ。
