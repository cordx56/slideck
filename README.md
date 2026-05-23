# slideck

YAML を宣言的に書いて、ブラウザ上でスライドを作成・編集・プレゼン・PDF 出力する
フロントエンド完結アプリ。詳細設計は [PLAN.md](./PLAN.md)。

## 特徴

- **サーバ不要**: 静的ホスティング (GitHub Pages 等) で配布可能。
- **三層 IR** (HIR → MIR → LIR): SVG レンダラと PDF レンダラが同一の LIR を消費し、
  レイアウトが一致する。フォント計測 (fontkit) も両者で共有。
- **宣言的 YAML**: Base (合成可能レイヤー)・変数・配置・グループ・auto-layout を記述。
  他ツールでいうテーマ・オーバーレイは **Base** に統合されている (`always:true` で
  全スライド適用、`use:` で選択)。`${slideNumber}` 等のシステム変数も使える。
- **PDF**: TrueType サブセット埋め込み + ToUnicode (テキスト選択/抽出可)。
- **3 ペインエディタ**: アウトライン/インスペクタ・プレビュー・CodeMirror。
  インスペクタ編集はコメントを保ったまま YAML AST を in-place 更新する。
- **ファイル入出力**: File System Access API (フォルダ読み書き) / ZIP フォールバック。

## モノレポ構成 (pnpm workspace)

```
packages/
  core/   @slideck/core — ブラウザ非依存のパイプライン (ライブラリ)
  web/    @slideck/web  — Svelte エディタ/プレゼン (ブラウザ)
  cli/    @slideck/cli  — Node CLI (YAML -> PDF/SVG)
```

- **core**: schema(zod) / ir(HIR・MIR・LIR) / load(parse・base解決・prepare) /
  normalize / lower / render(svg・pdf) / edit(YAML AST) / pipeline。`AssetResolver`
  と `VFS` を抽象として持ち、具体実装 (IndexedDB 等) には依存しない。
  PDF レンダラは重いので `@slideck/core/pdf` に分離。
- **web**: IndexedDB ベースの VFS、File ツリー UI、CodeMirror、KaTeX プレビュー等。
- **cli**: ディスクから読む `NodeAssetResolver` + `core` でヘッドレスに PDF/SVG 生成。

## 開発

```bash
pnpm install
pnpm dev          # web 開発サーバ (= pnpm --filter @slideck/web dev)
pnpm test         # 全パッケージのテスト (vitest)
pnpm check        # 全パッケージの型チェック
pnpm build        # web の本番ビルド
```

サンプルは `packages/web/public/examples/basic/`。web 起動時に選択して開く。

### CLI

```bash
# YAML プロジェクトを PDF (と任意で SVG) に変換
pnpm --filter @slideck/cli start <deck.yaml> -o out.pdf --svg ./svg-out
```

## デプロイ (web)

`packages/web/dist/` は完全に静的。サブパス配信時は `VITE_BASE` を設定:

```bash
VITE_BASE=/slideck/ pnpm --filter @slideck/web build
```
