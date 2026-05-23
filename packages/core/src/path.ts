// VFS paths are always absolute, "/"-separated, with no trailing slash. Root is "/".

// "/a/../b//c/." -> "/b/c". A reference that escapes root is an error.
export function normalize(p: string): string {
  const parts = p.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) throw new Error(`path escapes root: ${p}`);
      out.pop();
    } else {
      out.push(part);
    }
  }
  return "/" + out.join("/");
}

export function dirname(p: string): string {
  const n = normalize(p);
  if (n === "/") return "/";
  const i = n.lastIndexOf("/");
  return i <= 0 ? "/" : n.slice(0, i);
}

export function basename(p: string): string {
  const n = normalize(p);
  return n === "/" ? "" : n.slice(n.lastIndexOf("/") + 1);
}

export function join(...parts: string[]): string {
  return parts.filter((s) => s !== "").join("/");
}

// Extension (including the dot, lowercased). Dotfiles (.gitignore) are treated as "".
export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i <= 0 ? "" : b.slice(i).toLowerCase();
}

// Resolve a reference inside YAML to an absolute path.
// "/..." is absolute; "./...", "name.ext", and "../..." are relative to the containing file.
export function resolvePath(reference: string, containingFile: string): string {
  if (reference.startsWith("/")) return normalize(reference);
  return normalize(join(dirname(containingFile), reference));
}

// Whether an absolute path is a descendant of another directory (excluding itself).
export function isDescendant(path: string, ancestorDir: string): boolean {
  const a = normalize(ancestorDir);
  const p = normalize(path);
  if (a === "/") return p !== "/";
  return p.startsWith(a + "/");
}

// Validation for ZIP compatibility and filename sanity (§13.5).
const INVALID_NAME = /[\\:*?"<>|\x00/]/;
export function isValidName(name: string): boolean {
  return name.length > 0 && name !== "." && name !== ".." && !INVALID_NAME.test(name);
}
