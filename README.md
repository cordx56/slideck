# Slider

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

## 開発

```bash
npm install
npm run dev      # 開発サーバ
npm test         # ユニット/統合テスト (vitest)
npm run check    # 型チェック (svelte-check)
npm run build    # 本番ビルド -> dist/
```

サンプルは `public/examples/basic/`。起動時に自動で開く。

## デプロイ

`dist/` は完全に静的。サブパス配信時は `VITE_BASE` を設定:

```bash
VITE_BASE=/slider/ npm run build
```

## プロジェクト構造

```
src/
  schema/    HIR の zod スキーマ
  ir/        HIR / MIR / LIR 型
  load/      パース, base 解決 (extends), アセット (fetch/FS/ZIP), prepare
  normalize/ HIR -> MIR (base 合成, 変数展開, schema/defaults マージ, システム変数)
  lower/     MIR -> LIR (位置解決, グループ, auto-layout, テキストシェイプ)
  render/    svg/ と pdf/ レンダラ
  edit/      YAML AST 編集 (インスペクタ書き戻し)
  app/       Svelte UI (エディタ / プレゼン / ストア)
  pipeline.ts  全体オーケストレーション
```
