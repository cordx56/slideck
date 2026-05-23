// VFS の型は @slideck/core が定義する。web は IndexedDB 実装 (openVfs) を提供。
export type { VFS, FileEntry, VFSEvent, VFSListener } from "@slideck/core";
export { openVfs } from "./indexeddb";
