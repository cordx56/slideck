// VFS を HTTP 越しに公開するときの取り決め。web (クライアント) と
// cli (サーバ) が同じ定義を共有するため core に置く (型と文字列のみ、環境非依存)。

import type { FileEntry, VFSEvent } from "./vfs";

// API のパスプレフィックス。web の静的ファイルと衝突しない名前にする。
export const VFS_API_BASE = "/__slideck";

// エンドポイント。バイナリ read/write は file、それ以外は JSON。
export const VfsApi = {
  info: `${VFS_API_BASE}/info`,
  files: `${VFS_API_BASE}/files`,
  events: `${VFS_API_BASE}/events`,
  stat: (path: string) => `${VFS_API_BASE}/stat?path=${encodeURIComponent(path)}`,
  file: (path: string) => `${VFS_API_BASE}/file?path=${encodeURIComponent(path)}`,
  folder: (path: string) => `${VFS_API_BASE}/folder?path=${encodeURIComponent(path)}`,
  meta: (key: string) => `${VFS_API_BASE}/meta?key=${encodeURIComponent(key)}`,
  move: `${VFS_API_BASE}/move`,
  copy: `${VFS_API_BASE}/copy`,
} as const;

// 変更を起こしたクライアントを示すヘッダ。自分の書き込みに由来する SSE
// エコーを無視するために使う。
export const CLIENT_HEADER = "x-slideck-client";
// writeBlob 等で MIME を明示するためのヘッダ。
export const MIME_HEADER = "x-slideck-mime";

// /info の応答。web はこれが取れたらサーバ連携モードで起動する。
export interface ServerInfo {
  server: true;
  name: string; // プロジェクト表示名 (= ルートディレクトリ名)
  root: string; // サーバ側の絶対パス (表示用)
}

// SSE で配るペイロード。origin は変更を起こしたクライアント ID。
// 受信側は origin が自分なら無視する (ローカルで反映済みのため)。
export interface VfsEventMessage {
  event: VFSEvent;
  origin?: string;
}

// /stat の応答 (存在しなければ null)。
export type StatResponse = FileEntry | null;

// move / copy のリクエストボディ。
export interface PathPairBody {
  from: string;
  to: string;
}
