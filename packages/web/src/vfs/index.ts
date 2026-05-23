// VFS の型は @slideck/core が定義する。web は IndexedDB 実装 (openVfs) と
// サーバ連携時の HTTP 実装 (openHttpVfs) を提供する。
export type { VFS, FileEntry, VFSEvent, VFSListener } from "@slideck/core";
export { openVfs } from "./indexeddb";
export { openHttpVfs, probeServer } from "./http";
