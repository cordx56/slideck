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
  cli/    @slideck/cli  — Node CLI (編集サーバ / YAML -> PDF/SVG)
```

- **core**: schema(zod) / ir(HIR・MIR・LIR) / load(parse・base解決・prepare) /
  normalize / lower / render(svg・pdf) / edit(YAML AST) / pipeline。`AssetResolver`
  と `VFS` を抽象として持ち、具体実装 (IndexedDB 等) には依存しない。
  PDF レンダラは重いので `@slideck/core/pdf` に分離。
- **web**: IndexedDB ベースの VFS、File ツリー UI、CodeMirror、KaTeX プレビュー等。
  サーバ連携時は IndexedDB の代わりに HTTP 経由の VFS (`HttpVfs`) を使う。
- **cli**: ディスク上のプロジェクトを実体とする `DiskVfs`。同梱した web を配信し、
  HTTP VFS API + SSE でブラウザのエディタとディスクを双方向に繋ぐ編集サーバ
  (`serve`) と、`core` でヘッドレスに PDF/SVG を生成するビルド (`export`)。

## 開発

```bash
pnpm install
pnpm dev          # web 開発サーバ (= pnpm --filter @slideck/web dev)
pnpm test         # 全パッケージのテスト (vitest)
pnpm check        # 全パッケージの型チェック
pnpm build        # web + cli の本番ビルド (cli は web を同梱)
pnpm build:web    # web のみ (静的サイト配信用)
```

サンプルは `packages/web/public/examples/basic/`。web 起動時に選択して開く。

## CLI (`@slideck/cli`)

グローバルインストールして使う:

```bash
npm install -g @slideck/cli
```

```bash
# サンプルプロジェクトを新規作成 (省略時は my-deck/)
slideck new my-deck

# ディスク上のプロジェクトを編集サーバで開く (ブラウザが自動で開く)
slideck serve ./my-deck          # 省略時はカレントディレクトリ
slideck serve ./my-deck --port 4321 --no-open

# YAML プロジェクトを PDF (と任意で SVG) に変換
slideck export ./my-deck/deck.yaml -o out.pdf --svg ./svg-out
```

`serve` は同梱した web エディタを配信し、ブラウザ上の編集がそのままディスクへ
保存される (HTTP VFS API + SSE)。エディタ外でファイルを編集してもブラウザへ
反映される。`.slideck/` にツリー展開状態などの内部メタを保存する。

リポジトリ内では `pnpm cli` (= `pnpm --filter @slideck/cli start`) で実行できる。
ただし pnpm はスクリプトを `packages/cli` で実行するため、相対パスはそこ起点になる
(絶対パスを渡すか、対象ディレクトリに `cd` してから実行するのが確実):

```bash
pnpm cli serve "$PWD/packages/web/public/examples/basic"
```

### 公開 (npm)

`@slideck/cli` は単一ファイル (cli + core を esbuild でバンドル) と同梱 web を
`dist/` に持つ。`prepublishOnly` でビルドされるため、`packages/cli` で
`npm publish` するだけでよい (`publishConfig.access: public`)。

## デプロイ (web)

`packages/web/dist/` は完全に静的。サブパス配信時は `VITE_BASE` を設定:

```bash
VITE_BASE=/slideck/ pnpm --filter @slideck/web build
```
