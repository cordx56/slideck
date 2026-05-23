// VFS の型は @slider/core が定義する。web は IndexedDB 実装 (openVfs) を提供。
export type { VFS, FileEntry, VFSEvent, VFSListener } from "@slider/core";
export { openVfs } from "./indexeddb";
