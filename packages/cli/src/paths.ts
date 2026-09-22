import { relative, sep } from "node:path";

export function toVfsPath(root: string, abs: string): string {
  const path = relative(root, abs).split(sep).join("/");
  return path === "" ? "/" : "/" + path;
}
