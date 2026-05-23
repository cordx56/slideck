// The VFS types are defined by @slideck/core. web provides the IndexedDB impl
// (openVfs) and the HTTP impl for server-linked mode (openHttpVfs).
export type { VFS, FileEntry, VFSEvent, VFSListener } from "@slideck/core";
export { openVfs } from "./indexeddb";
export { openHttpVfs, probeServer } from "./http";
