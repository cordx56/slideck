# PLAN.md / REFACTOR-bases.md 追加指示: 仮想ファイルシステム (VFS) の導入

## 背景

現在のアプリは File System Access API (FSA) と ZIP の二系統でファイルを扱う想定だった。これを **IndexedDB ベースの仮想ファイルシステム** に統一する。

理由:
- FSA は Firefox で実装される見込みが薄く、ブラウザ間で書き味が分裂する
- 画像・フォントなどの大きなアセットをメモリ常駐させたくない
- IndexedDB なら Blob のまま保存でき、Object URL 経由で必要時のみメモリにロードできる
- 単一のバックエンドにすればコードパスがひとつになる

ZIP は **import/export 用** に残す。プロジェクトの永続化は IndexedDB が担う。

---

## 1. ストレージ層 (IndexedDB)

### 1.1 DB スキーマ

```
DB: slide-app
├── object store: files
│     keyPath: path
│     value: FileRecord
│
└── object store: meta
      keyPath: key
      value: any
```

```ts
type FileRecord = {
  path: string;            // 絶対パス。"/deck.yaml", "/img/fig1.png" など。先頭は必ず "/"
  kind: 'file' | 'folder';
  data?: Blob;             // file のときのみ
  mimeType?: string;       // file のときのみ
  size?: number;           // file のときのみ
  modifiedAt: number;      // epoch ms
};
```

- 空フォルダ表示のため、folder も明示的にレコードとして持つ
- ファイル本体は Blob のまま保存。テキスト変換はアクセス時に行う
- meta store には `currentSlideId`, `treeExpanded: string[]`, `settings` などを保持

### 1.2 推奨ライブラリ

`idb` (jakearchibald/idb) を使う。Promise API でラップされた IndexedDB。約3KB。

```bash
npm install idb
```

---

## 2. VFS API

`src/vfs/` 配下に実装。アプリ全体は IndexedDB を直接触らずこの API を経由する。

```ts
interface VFS {
  // Read
  list(): Promise<FileEntry[]>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileEntry | null>;
  readBlob(path: string): Promise<Blob>;
  readText(path: string): Promise<string>;
  getObjectURL(path: string): Promise<string>;    // キャッシュ付き

  // Write
  writeBlob(path: string, blob: Blob, mimeType?: string): Promise<void>;
  writeText(path: string, text: string): Promise<void>;
  createFolder(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  delete(path: string): Promise<void>;             // フォルダは再帰削除

  // Bulk
  importZip(blob: Blob, targetDir?: string): Promise<void>;
  exportZip(): Promise<Blob>;
  clear(): Promise<void>;                          // プロジェクト初期化

  // Subscribe
  subscribe(listener: (event: VFSEvent) => void): () => void;
}

type FileEntry = {
  path: string;
  kind: 'file' | 'folder';
  size?: number;
  mimeType?: string;
  modifiedAt: number;
};

type VFSEvent =
  | { type: 'create'; path: string }
  | { type: 'update'; path: string }
  | { type: 'delete'; path: string }
  | { type: 'move'; from: string; to: string };
```

### 2.1 Object URL キャッシュ

```ts
class ObjectURLCache {
  private cache = new Map<string, { url: string; revoked: false }>();

  async get(path: string): Promise<string> { ... }
  invalidate(path: string): void {                  // VFSEvent で呼ぶ
    const entry = this.cache.get(path);
    if (entry) { URL.revokeObjectURL(entry.url); this.cache.delete(path); }
  }
}
```

VFS イベント (update/delete/move) を購読して該当 URL を revoke。レンダラ側は path → URL を毎回 `getObjectURL` で取得する (キャッシュにヒットすれば即返る)。

### 2.2 トランザクション境界

`move` のような複合操作は IndexedDB のトランザクション内で完結させる。途中失敗で中途半端な状態にならないこと。

---

## 3. パス規約

### 3.1 内部表現

VFS が保持するパスは **常に絶対パス、`/` 区切り、末尾スラッシュなし**:
- `/deck.yaml`
- `/img/fig1.png`
- `/fonts/NotoSansJP-Regular.ttf`

ルートディレクトリは `/`。フォルダレコードのパスは末尾スラッシュなしで `/img` のように表現。

### 3.2 YAML 内での参照表記

ユーザが YAML に書くパスは以下3形式を許容:

| 表記 | 意味 | 例 |
|---|---|---|
| `name.ext` | 参照元ファイルと同じディレクトリ | `fig1.png` |
| `./...` | 参照元ファイルからの相対 | `./img/fig1.png` |
| `/...` | プロジェクトルートからの絶対 | `/img/fig1.png` |

`../` も相対形の一部として許可する。

### 3.3 解決関数

```ts
function resolvePath(reference: string, containingFile: string): string {
  if (reference.startsWith('/')) return normalize(reference);
  const baseDir = dirname(containingFile);    // "/sub/theme.yaml" → "/sub"
  return normalize(join(baseDir, reference));
}
```

`normalize` は `..` と `.` を解決し、複数スラッシュを単一化、末尾スラッシュ削除。ルートを脱出する参照 (`/../foo`) はエラー。

---

## 4. UI 構造の変更

### 4.1 左ペインの差し替え

**削除する内容**: 要素パレット (Add Text / Image / Rect / Group)、アウトラインツリー、選択中要素のインスペクタ

**新しい内容**: ファイルツリー (フル領域)

スライド編集は YAML で行うのが基本方針 (項目12) なので、パレットとインスペクタは不要。アウトラインに表示されていたスライド一覧は下部サムネイル列で代替する。

### 4.2 グリッド定義

```css
.editor {
  display: grid;
  grid-template-columns: 240px 1fr 420px;
  grid-template-rows: 48px 1fr;
  height: 100vh;
}
.left   { grid-column: 1; }  /* FileTree */
.center { grid-column: 2; }  /* Slide preview + thumbnails */
.right  { grid-column: 3; }  /* CodeMirror */
```

幅は据え置き。

### 4.3 中央ペイン

スライドプレビュー + サムネイル列の構成は維持。スライドの追加・並べ替えは YAML 直接編集で行う (項目12)。サムネイルクリックで現在スライド切替のみ。

### 4.4 右ペイン (1ファイル表示モード)

CodeMirror インスタンスは常時ひとつ。ツリーで別の YAML ファイルを開いたら、現在の編集中バッファをディスクに書き戻してから CodeMirror のドキュメントを差し替える。

```ts
type EditorState = {
  openPath: string | null;       // 現在開いているファイルのパス
  // CodeMirror インスタンスはコンポーネント内で管理
};
```

- 非 YAML ファイル (画像、フォント) を開いた場合: CodeMirror を隠してプレビューパネルに切り替え
  - 画像: `<img src={objectURL}>` を表示
  - フォント: family名・グリフサンプル ("The quick brown fox" + 日本語サンプル) を表示
  - その他: ファイル情報のみ表示 ("バイナリファイル、編集不可")
- `deck.yaml` を開いている時のみ中央ペインがそのスライドをレンダリング。他のファイルを開いている間も中央ペインは最後に開いた `deck.yaml` の内容を表示し続ける (背景で normalize 済みの結果を保持)

---

## 5. ファイルツリー仕様

### 5.1 表示

- 全拡張子を表示 (フィルタなし)
- 隠しファイル (`.` で始まる) はデフォルト非表示、ツリーヘッダにトグルボタンで切り替え
- 空フォルダも表示
- ソート: 同じ親内でフォルダ先 → ファイル、それぞれ名前の自然順 (ロケール考慮)
- 各ノードに拡張子別アイコン (`lucide-svelte` 等)
  - フォルダ: `Folder` / `FolderOpen`
  - .yaml/.yml: `FileCode`
  - 画像 (.png/.jpg/.jpeg/.svg/.webp/.gif): `Image`
  - フォント (.ttf/.otf/.woff/.woff2): `Type`
  - その他: `File`

### 5.2 状態表示

各ノードに以下のステータスアイコン/装飾:
- **エラーマーク** (赤): その YAML ファイル内に解決できないパス参照がある場合 (詳細は §7)
- **現在編集中**: 背景色でハイライト
- **未保存変更**: ●マーク (CodeMirror の dirty フラグ)

孤児ファイル (どこからも参照されていない) のマークは不要 (項目9)。

### 5.3 折り畳み状態の永続化

ツリーの expanded/collapsed 状態は meta store に `treeExpanded: string[]` (展開されているフォルダパスの配列) として保存。次回起動時に復元。

---

## 6. ファイル操作

### 6.1 右クリックメニュー

ノード種別ごとに項目を出し分ける。

**フォルダ右クリック**:
- 新規ファイル
- 新規フォルダ
- リネーム (F2)
- 削除 (Delete) — 確認ダイアログあり
- ZIP としてダウンロード

**ファイル右クリック**:
- 開く (Enter)
- リネーム (F2)
- 複製
- 削除 (Delete) — 確認ダイアログあり
- ダウンロード

**空き領域右クリック**:
- 新規ファイル (ルート直下)
- 新規フォルダ (ルート直下)
- ZIP インポート
- プロジェクト全体を ZIP エクスポート

メニュー実装は素朴に絶対配置の `<div>` で良い。`@floating-ui/dom` を入れると位置調整が楽。

### 6.2 削除の確認ダイアログ

- ファイル: 「'xxx.png' を削除しますか?」
- フォルダ: 「'img/' を中身ごと削除しますか? (N 個のファイル)」
- ボタン: [削除] [キャンセル]

Undo はない (項目6)。削除確定後はリカバリ不能であることを認識して扱う。

### 6.3 リネーム / 移動

リネームはツリー内のノード名をインライン編集 (F2 または 2回クリックで編集モード)。
移動はノードのドラッグ&ドロップ。

両者とも内部的には `vfs.move(from, to)` で実装。移動後の参照書き換えは行わない (項目2 = (a) 明示的に直させる)。代わりに移動後に参照エラーマークが点灯する。

### 6.4 ドラッグ&ドロップによるアップロード

OS のファイル/フォルダを drop:
- ドロップ対象がフォルダノード → そのフォルダ直下に追加
- ドロップ対象がファイルノード → 同じ階層 (兄弟) に追加
- ドロップ対象がツリーの空き領域 → ルート直下に追加

ディレクトリ drop は `DataTransferItem.webkitGetAsEntry()` を使って再帰的にエントリを取得。

**同名衝突** (項目7):
- 衝突が1件以上発生: ダイアログ表示
  - メッセージ: 「次のファイルが既に存在します:\n - fig1.png\n - logo.svg」
  - ボタン: [上書き (N件)] [キャンセル]
- [上書き]: 該当ファイルを置き換え、その他は新規追加
- [キャンセル]: 何もインポートしない (部分実行はしない)

### 6.5 ツリー内ドラッグ移動

- ドロップターゲット: フォルダノード または ルート空き領域
- ファイルノードへのドロップは無効 (兄弟並べ替えはサポートしない、表示順は自動ソート)
- フォルダを自身の子孫に移動しようとした場合は無効。視覚的にも × カーソル
- ドロップ予告のハイライト: フォルダノードに枠線
- 同名衝突時は §6.4 と同じダイアログ

### 6.6 ZIP インポート/エクスポート

ライブラリ: `fflate` (JSZip より軽量、約8KB)

```bash
npm install fflate
```

**インポート**:
- `.zip` を drop または「ZIP インポート」メニュー
- ZIP 内のエントリ構造をそのまま VFS に展開
- ターゲットディレクトリを指定可能 (デフォルト: ルート)
- 衝突時のダイアログは §6.4 と共通

**エクスポート**:
- 全 VFS 内容を ZIP 化してダウンロード
- ファイル名は `deck-{timestamp}.zip`

---

## 7. 参照とエラー表示

### 7.1 参照グラフ

normalize フェーズで「YAML ファイルからどのパスへの参照があるか」を収集する:

```ts
type Reference = {
  fromFile: string;       // 参照元 YAML ファイルのパス
  fromRange: [number, number];  // ファイル内の位置 (CodeMirror lint 用)
  toPath: string;         // 解決後の絶対パス
};
```

収集対象:
- `deck.yaml`: `bases[].file`, スライド要素の `image.src`
- `*.yaml` (base): `extends`, `fonts.*.path`, `layout[].image.src`

スキーマレベルで「これはパス文字列」のメタを持たせ、normalize 時に走査する。

### 7.2 エラー検出

`toPath` が VFS に存在しないものを「壊れた参照」として保持:

```ts
type BrokenReference = Reference;
const brokenRefs: BrokenReference[] = ...;
```

### 7.3 エラー表示箇所

二箇所:
1. **ファイルツリー**: 壊れた参照を「持つ」YAML ファイルに赤いドット
2. **CodeMirror**: 壊れた参照の該当行に赤線 (既存の lint 機構に乗せる)

「壊れた参照の対象ファイル側にマークを付ける」は不要 (どこから参照されているか追うのは難しい)。

### 7.4 更新タイミング

VFSEvent (create/update/delete/move) を購読して参照グラフを再計算。重い処理ではないので debounce 200ms 程度で十分。

---

## 8. キーボード操作

### 8.1 ツリーフォーカス時

| キー | 動作 |
|---|---|
| ↑ / ↓ | 前後の表示中ノードへ移動 |
| ← | フォルダ折り畳み / 親フォルダへ |
| → | フォルダ展開 / 最初の子へ |
| Enter | ファイルを開く / フォルダ展開トグル |
| F2 | リネーム開始 |
| Delete / Backspace | 削除 (確認ダイアログ) |
| Ctrl+N | 新規ファイル (選択中フォルダ直下、無選択時はルート) |
| Ctrl+Shift+N | 新規フォルダ |
| Escape | リネーム中なら確定キャンセル / 通常時はフォーカス外し |

### 8.2 スライドビューフォーカス時

中央ペインのスライドプレビューにフォーカスがある時 (`tabindex="0"` の `<div>` を用意):

| キー | 動作 |
|---|---|
| ← | 前のスライド |
| → / Space | 次のスライド |
| Home | 最初のスライド |
| End | 最後のスライド |
| F5 | プレゼンテーションモード開始 |
| F | フルスクリーントグル (プレゼンモード内) |
| Escape | プレゼンモード解除 (プレゼンモード内) |

### 8.3 グローバルショートカット

CodeMirror 内かどうかに関わらず効くもの:

| キー | 動作 |
|---|---|
| Ctrl/Cmd+S | 現在のファイルを保存 (VFS に書き込み) |
| Ctrl/Cmd+P | プレゼンテーションモード |
| Ctrl/Cmd+E | PDF エクスポート |

### 8.4 実装方針

`window.addEventListener('keydown')` でグローバル、`document.activeElement` でフォーカス位置を判定して分岐するのが素朴。Svelte のコンポーネント単位の `onkeydown` でも良いが、グローバルショートカットとの整合性を考えると一箇所集約が楽。

---

## 9. 初期状態

### 9.1 起動時の判定

```
1. IndexedDB に slide-app DB が存在し、files store が空でない
   → 既存プロジェクトを開く
2. 存在しないか空
   → ようこそ画面: [サンプルを開く] [ZIP インポート] [空のプロジェクトを作成]
```

**サンプルを開く**: `public/examples/basic/` 以下のファイルを fetch して VFS に書き込む。インストール処理。
**ZIP インポート**: §6.6
**空のプロジェクトを作成**: 最小限の `deck.yaml` と `theme-base.yaml` だけ VFS に書き込む

### 9.2 プロジェクトリセット

「設定」または右クリックメニューに「プロジェクトをリセット」を置く。確認後 `vfs.clear()` を呼んでようこそ画面に戻る。

---

## 10. 影響を受けるコード

### 10.1 新規追加

```
src/vfs/
├── index.ts              # VFS インタフェース
├── indexeddb.ts          # IndexedDB バックエンド実装 (idb 使用)
├── object-url-cache.ts   # Object URL キャッシュ
├── path.ts               # パス正規化・解決ユーティリティ
├── zip.ts                # ZIP import/export (fflate)
└── events.ts             # イベントバス (購読/発火)

src/app/editor/
├── FileTree.svelte       # 左ペイン本体
├── TreeNode.svelte       # 個別ノード (再帰)
├── ContextMenu.svelte    # 右クリックメニュー
├── ConfirmDialog.svelte  # 削除確認等の共通ダイアログ
└── FilePreview.svelte    # 非 YAML ファイルのプレビュー (画像/フォント)

src/app/keyboard/
└── shortcuts.ts          # グローバルショートカットの集約
```

### 10.2 変更

- `src/load/assets.ts` → VFS API を使うように書き換え。`AssetResolver` インタフェースは VFS の薄いラッパで残しても良い (テストで差し替え可能にするため)
- `src/load/parse.ts` → ファイル読み込みを VFS 経由に
- `src/render/svg/` → 画像参照を `getObjectURL` 経由に
- `src/render/pdf/` → 画像/フォントを `readBlob` 経由に
- `src/normalize/` → パス参照を resolved 絶対パスに統一、参照グラフ収集を追加
- `src/app/editor/LeftPane.svelte` → 中身を全部 FileTree に差し替え (旧 outline/palette/inspector は削除)
- `src/app/store.svelte.ts` → `openPath`, `brokenRefs` 等の状態を追加

### 10.3 削除

- 旧 FSA API 関連のコード (もし存在すれば)
- 要素パレット、アウトラインツリー、インスペクタのコンポーネント
- AssetResolver の FSA 版・ZIP 版実装 (VFS バックエンドに統一)

---

## 11. テスト

### 11.1 VFS 単体テスト

- `vfs.indexeddb.test.ts`: CRUD、move (フォルダの再帰移動含む)、トランザクション失敗時のロールバック
- `vfs.path.test.ts`: 正規化、解決、`..` のエスケープ防止
- `vfs.zip.test.ts`: import / export のラウンドトリップ

`fake-indexeddb` を dev dependency に追加して Node 環境でテスト可能にする。

### 11.2 統合テスト

- ファイル削除後に参照エラーマークが点灯すること
- ZIP インポート後、deck.yaml が正常にレンダリングされること
- 大きな画像 (10MB) を投入してもメモリが膨らまないこと (Object URL ベース確認)

---

## 12. 実装順序

1. **VFS コア** (§1, §2, §3): IndexedDB バックエンドと API、パス正規化
2. **ZIP import/export** (§6.6): プロジェクトを出し入れできるようにする
3. **既存パイプライン接続** (§10.2): `load`, `normalize`, `render` が VFS 経由で動くように
4. **ファイルツリー UI** (§5): 表示のみ、操作なし
5. **基本操作** (§6.1, §6.2): 右クリックメニュー、新規作成、削除、リネーム
6. **DnD** (§6.4, §6.5): 外部 drop、内部移動
7. **キーボード操作** (§8): ツリー + スライドビュー + グローバル
8. **参照エラー表示** (§7): 参照グラフ収集、ツリー/エディタへのマーク
9. **左ペイン置き換え** (§4.1): 旧コンポーネント削除、FileTree に差し替え
10. **初期状態フロー** (§9): ようこそ画面、サンプル投入

各ステップで動作確認。特に 3 の段階で既存機能が IndexedDB 上で全部動くことを確認してから UI 側を作ると安全。

---

## 13. 既知の注意点

### 13.1 IndexedDB の容量制限

ブラウザごとに違うが、おおよそ:
- Chrome: ディスクの 60% 程度まで動的割当
- Firefox: 同程度、`navigator.storage.estimate()` で確認可能
- Safari: 1GB あたりで permission prompt

起動時に `navigator.storage.persist()` を呼んで永続化要求を出すと、ブラウザのクリーンアップ対象から外れる。

### 13.2 Object URL のリーク

`URL.createObjectURL` で作ったものは明示的に `revokeObjectURL` しないと GC されない。VFS イベントでの invalidate に加え、アプリ終了時 (`beforeunload`) にも全 revoke する。

### 13.3 大量ファイルでの IndexedDB トランザクション

数百ファイルの ZIP インポートを単一トランザクションでやるとブラウザによっては timeout。バッチ (50件単位) に分けてコミットする。

### 13.4 フォントの Blob 化

PDF レンダラに渡すフォントは ArrayBuffer が必要。`blob.arrayBuffer()` で変換するが、これは Blob 全体をメモリに展開する。フォント1個 = 数 MB なのでサブセット化前に注意。

### 13.5 パス文字の制限

VFS が許可する文字は ASCII の英数字、`-`, `_`, `.`, スペース、日本語等の Unicode。禁止: `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`, NUL。ZIP エクスポート時の互換性のため。リネーム時にバリデーション。
