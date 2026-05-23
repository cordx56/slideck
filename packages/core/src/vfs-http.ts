// Conventions for exposing the VFS over HTTP. web (client) and
// cli (server) share the same definitions, so they live in core (types and strings only, environment-independent).

import type { FileEntry, VFSEvent } from "./vfs";

// API path prefix. Named so it does not collide with web's static files.
export const VFS_API_BASE = "/__slideck";

// Endpoints. Binary read/write use file, everything else is JSON.
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

// Header identifying the client that made the change. Used to ignore SSE
// echoes originating from one's own writes.
export const CLIENT_HEADER = "x-slideck-client";
// Header to make the MIME explicit for writeBlob etc.
export const MIME_HEADER = "x-slideck-mime";

// /info response. If web can fetch this, it starts in server-linked mode.
export interface ServerInfo {
  server: true;
  name: string; // project display name (= root directory name)
  root: string; // absolute path on the server (for display)
}

// Payload delivered over SSE. origin is the ID of the client that made the change.
// The receiver ignores it if origin is itself (already applied locally).
export interface VfsEventMessage {
  event: VFSEvent;
  origin?: string;
}

// /stat response (null if it does not exist).
export type StatResponse = FileEntry | null;

// Request body for move / copy.
export interface PathPairBody {
  from: string;
  to: string;
}
