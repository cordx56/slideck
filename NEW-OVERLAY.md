# PLAN.md 追加指示: Theme と Overlay を Base に統合

## 背景

PLAN.md は実装済み。本ドキュメントは差分指示であり、既存実装のリファクタリング仕様として扱う。

PLAN.md では `theme` (use 指定で切替) と `overlay` (全スライド一律重畳) という2つの概念を持っていた。これらを **Base** という単一概念に統合する。Base は「合成可能なレイヤー」であり、`always: true` のものは全スライドに自動適用され、それ以外は `use:` で選択される。

これによる利点:
- フッター等のグローバル装飾も変数を受け取れる（タイトルバーの `${title}` 等）
- 概念がひとつになり仕様・実装の双方が簡素化
- セクション扉用テーマと通常テーマの併用、追加装飾レイヤーの導入などが自然に書ける

---

## 1. Base の定義

### 1.1 deck.yaml での宣言

```yaml
bases:
  - id: base
    always: true              # use 指定なしで全スライドに適用
    file: ./theme-base.yaml

  - id: title-page
    file: ./theme-title.yaml  # always 省略時は false

  - id: standard
    file: ./theme-standard.yaml

  - id: section
    file: ./theme-section.yaml
```

- `id`: 必須、一意。`use:` での参照キー
- `always`: 省略時 `false`。`true` のとき全スライドに自動適用される
- `file`: 必須、base ファイルへの相対パス

**命名上の決定**: `default: true` ではなく `always: true` を採用する。`default` は「use の既定値」と読まれる可能性があり二義的なため。

### 1.2 base ファイル本体

旧 theme.yaml と同じ構造を踏襲する。`schema.vars`, `layout`, `defaults`, `fonts`, `colors`, `slide` などのフィールドはそのまま。

```yaml
# theme-base.yaml — always: true で全スライドに乗る
schema:
  vars:
    title: { type: string, required: true }
layout:
  - type: text
    text: ${title}
    position: { left: 5%, top: 3% }
    size: 24
    color: muted
  - type: text
    text: "${slideNumber} / ${slideCount}"
    position: { right: 5%, bottom: 3% }
    size: 18
    color: muted
```

---

## 2. 適用順序と合成セマンティクス

各スライドのレンダリングにあたり、以下の順序で要素を積み重ねる（先に並ぶものが下、後に並ぶものが上）:

1. `bases` 配列の中で `always: true` のもの全部を、**配列の宣言順**に積む
2. スライドの `use:` で指定された base を、**指定順**に積む
3. スライドの `elements:` を積む

ポイント:
- 同じスライドに `always` base と `use` base が両方適用される
- z-order は配列順に従う。`base` を最初に書けば最も下に来る
- `use:` でも `always:` baseと同じidを書けば二重に適用される（仕様上許容するが、normalize で警告を出すこと）

### 2.1 use: の構文

文字列・配列の両方を受ける:

```yaml
slides:
  - use: standard                    # 単一指定
  - use: [section, standard]         # 複数指定、配列順に下から積む
```

スキーマでは `z.union([z.string(), z.array(z.string())])` で受け、normalize 時に配列に正規化する。

`use:` が省略された場合は空配列扱い（`always` base のみが適用される）。

---

## 3. 変数スコープと schema 合成

### 3.1 スコープ

スライドの `vars:` は、そのスライドに適用される **全ての base** から参照可能。

```yaml
# theme-base.yaml
schema:
  vars: { title: { type: string, required: true } }
layout:
  - text: ${title}      # ← スライドの vars.title が入る

# theme-standard.yaml
schema:
  vars:
    title: { type: string, required: true }
    subtitle: { type: string, default: "" }
layout:
  - text: ${title}      # ← 同じ値が入る
  - text: ${subtitle}

# deck.yaml
slides:
  - use: standard
    vars:
      title: "RustOwl"      # base と standard の両方の ${title} に流れる
      subtitle: "..."
```

### 3.2 schema.vars の合成ルール

スライドに適用される全 base の `schema.vars` を union でマージする。

- **同名変数が複数 base にある場合**:
  - 型が一致 → OK
  - 型不一致 → validation error（位置情報付き、競合する base ファイルと変数名を提示）
  - `required` は OR（いずれかが required ならマージ後も required）
  - `default` は配列順で**後勝ち**

- **マージ後の検証**:
  - `required` な全変数が、スライドの `vars` で指定されていること
  - スライドの `vars` の各値が、宣言型と一致すること

### 3.3 評価タイミング

変数展開とスキーマ検証は normalize フェーズで完結する（既存 PLAN.md の方針通り）。LIR には変数は残らない。

---

## 4. defaults の合成

各 base が `defaults.text`, `defaults.image` などのデフォルト値を持つ場合、適用順に深いマージで合成する。後勝ち。

```yaml
# base
defaults:
  text: { family: body, size: 36, color: fg }

# standard (use されたとき base の上に積まれる)
defaults:
  text: { size: 48 }    # family と color は base から継承される
```

合成結果: `text: { family: body, size: 48, color: fg }`

スライドの `elements` 内の各要素には、合成後の defaults が適用される。base 自身の `layout` 要素にもその base 以下の defaults が適用される（自己 base の defaults を含む、それより下のスタック）。

---

## 5. システム変数

以下のシステム変数を normalize 時に自動注入する。`base` の layout 内でも、スライドの elements 内でも参照可能。

| 変数 | 型 | 内容 |
|---|---|---|
| `${slideNumber}` | number | 1始まりのスライド番号 |
| `${slideCount}` | number | 総スライド数 |
| `${slideId}` | string | スライドの id（id がない場合は内部生成 id） |
| `${baseIds}` | string[] | 適用された base id の配列（必要なら） |

実装メモ:
- システム変数は予約名。`schema.vars` で同名宣言があれば normalize エラー
- ユーザ変数とシステム変数は同一の名前空間（プレフィックスなし）
- スライドの `vars` で同名を上書きした場合はユーザ値優先 + 警告

`schema.vars` のスキーマ検証では、システム変数は暗黙的に宣言済みとして扱う（required にカウントしない、型は固定）。

---

## 6. 影響を受けるコード

### 6.1 削除・改名

| 旧 | 新 | 備考 |
|---|---|---|
| `src/schema/theme.ts` | `src/schema/base.ts` | スキーマ自体は本体ほぼ同一、ファイル名のみ変更 |
| `Deck.theme`, `Deck.themes`, `Deck.overlays` | `Deck.bases` | deck.yaml の宣言フィールドを統合 |
| `src/normalize/theme-apply.ts` | `src/normalize/bases.ts` | base 合成ロジックに書き換え |
| `src/normalize/overlays.ts` | 削除 | bases.ts に吸収 |
| `Slide.use: string` | `Slide.use: string \| string[]` | スキーマ拡張 |

### 6.2 新規追加

- `src/normalize/system-vars.ts`: システム変数を生成・注入する関数
- `src/normalize/schema-merge.ts`: 複数 base の `schema.vars` を合成する関数
- `src/normalize/defaults-merge.ts`: 複数 base の `defaults` を深いマージする関数（既存があれば拡張）

### 6.3 修正

- `src/schema/deck.ts`: `bases: BaseRef[]` フィールドに変更。`BaseRef = { id, always?, file }`
- `src/schema/slide.ts`: `use` を `string | string[]` で受ける
- `src/load/resolve-refs.ts`: `bases[].file` の読み込みに統一。`extends:` は base ファイル内では引き続き有効
- `src/normalize/index.ts`: 合成パイプラインを再構築
  1. 全 base ファイルを読み込んでマップ化 (`Map<id, ResolvedBase>`)
  2. スライドごとに、適用される base id の配列を確定 (`always` フィルタ + `use` の正規化)
  3. その配列に従って schema, defaults を合成
  4. システム変数注入
  5. スライドの vars で値検証
  6. レイアウト要素を z-order 順に並べる: `appliedBases[0].layout + appliedBases[1].layout + ... + slide.elements`
  7. 全要素に変数展開と defaults を適用

### 6.4 normalize パイプラインの擬似コード

```ts
function normalizeSlide(slide: Slide, deck: ResolvedDeck): NormalizedSlide {
  const useIds = Array.isArray(slide.use) ? slide.use
                : slide.use ? [slide.use] : [];
  const alwaysIds = deck.bases.filter(b => b.always).map(b => b.id);
  const appliedIds = [...alwaysIds, ...useIds];
  const appliedBases = appliedIds.map(id => deck.basesById.get(id)!);

  const mergedSchema = mergeSchemas(appliedBases.map(b => b.schema));
  const mergedDefaults = mergeDefaults(appliedBases.map(b => b.defaults));
  const systemVars = buildSystemVars(slide, deck);
  const allVars = { ...systemVars, ...slide.vars };
  validateVars(allVars, mergedSchema);

  const layered: Element[] = [];
  for (const base of appliedBases) layered.push(...base.layout);
  layered.push(...(slide.elements ?? []));

  return {
    id: slide.id,
    elements: layered.map(el => applyDefaults(expandVars(el, allVars), mergedDefaults)),
  };
}
```

---

## 7. マイグレーション

### 7.1 既存サンプルプロジェクト (`public/examples/basic/`)

旧構造の `deck.yaml`:
```yaml
theme: ./theme.yaml
overlays:
  - ./overlays/footer.yaml
slides:
  - id: intro
    vars: { title: "..." }
```

新構造に書き換え:
```yaml
bases:
  - id: footer
    always: true
    file: ./overlays/footer.yaml
  - id: standard
    file: ./theme.yaml

slides:
  - id: intro
    use: standard
    vars: { title: "..." }
```

`overlays/footer.yaml` 側も `elements:` ではなく `layout:` に統一する（base ファイルの構造に揃える）。

### 7.2 既存テスト

- `tests/normalize.test.ts`: `theme` / `overlay` を扱うケースを `base` に書き換え
- 新規ケースを追加:
  - 複数 base の schema.vars マージ（型一致 / 不一致 / required 伝播）
  - 複数 base の defaults 深いマージ
  - `always: true` と `use:` の併用時の z-order
  - `use:` の配列指定
  - システム変数の注入と上書き警告

### 7.3 ドキュメント

`README.md` および将来書く `docs/` を base 概念に揃える。`theme` / `overlay` という単語は仕様上は廃止するが、ユーザマニュアル中で「他ツールでいうテーマ・オーバーレイは Base に統合されている」という注釈は入れて良い。

---

## 8. 互換性に関する注記

旧 `theme:` / `overlays:` フィールドは廃止し、移行警告も出さない（プロジェクトが個人利用段階のため）。もし後で公開して既存ユーザが付いている時期になっていれば、その時点で deprecation warning を入れる方針とする。

---

## 9. 実装順序の推奨

1. スキーマ更新 (`src/schema/`)
2. normalize の合成ロジック (`src/normalize/bases.ts`, `schema-merge.ts`, `defaults-merge.ts`, `system-vars.ts`)
3. テスト書き換え + 新規ケース追加
4. サンプルプロジェクト書き換え
5. エディタ UI の左ペインアウトラインで「適用 base」を表示する（任意、デバッグに便利）

各ステップ完了時にテストが通ること。
