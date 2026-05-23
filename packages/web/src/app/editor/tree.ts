import type { FileEntry } from "../../vfs";
import { dirname, basename } from "@slideck/core";

export interface TreeNode {
  path: string;
  name: string;
  kind: "file" | "folder";
  children: TreeNode[];
}

// Controller shared between FileTree and TreeNode (via Svelte context).
export interface TreeCtx {
  selected(): string | null;
  select(node: TreeNode): void;
  renaming(): string | null;
  startRename(path: string): void;
  submitRename(path: string, name: string): void;
  cancelRename(): void;
  openMenu(node: TreeNode, x: number, y: number): void;
  dropMove(from: string, toDir: string): void;
  dropUpload(items: DataTransferItemList, toDir: string): void;
}

export const TREE_CTX = Symbol("tree-ctx");

function isHidden(path: string): boolean {
  return basename(path).startsWith(".");
}

// Within the same parent: folders first -> files, each in natural name order (locale-aware).
function sortNodes(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
  for (const n of nodes) if (n.children.length) sortNodes(n.children);
}

// Convert a flat FileEntry[] into a nested tree.
export function buildTree(files: FileEntry[], showHidden: boolean): TreeNode[] {
  const root: TreeNode = { path: "/", name: "", kind: "folder", children: [] };
  const folders = new Map<string, TreeNode>([["/", root]]);

  const getFolder = (path: string): TreeNode => {
    const cached = folders.get(path);
    if (cached) return cached;
    const node: TreeNode = {
      path,
      name: basename(path),
      kind: "folder",
      children: [],
    };
    folders.set(path, node);
    getFolder(dirname(path)).children.push(node);
    return node;
  };

  const visible = files.filter((f) => showHidden || !isHidden(f.path));
  // Process shallower paths first so parent folders are established first.
  const sorted = [...visible].sort((a, b) => a.path.length - b.path.length);
  for (const f of sorted) {
    if (f.kind === "folder") {
      getFolder(f.path);
    } else {
      getFolder(dirname(f.path)).children.push({
        path: f.path,
        name: basename(f.path),
        kind: "file",
        children: [],
      });
    }
  }

  sortNodes(root.children);
  return root.children;
}

// Flatten the tree in display order (expanded only). For keyboard navigation.
export function flattenVisible(
  nodes: TreeNode[],
  expanded: Set<string>,
  out: TreeNode[] = [],
): TreeNode[] {
  for (const n of nodes) {
    out.push(n);
    if (n.kind === "folder" && expanded.has(n.path)) {
      flattenVisible(n.children, expanded, out);
    }
  }
  return out;
}
