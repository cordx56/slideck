// VFS のパスは常に絶対・"/" 区切り・末尾スラッシュなし。ルートは "/"。

// "/a/../b//c/." -> "/b/c"。ルートを脱出する参照はエラー。
export function normalize(p: string): string {
  const parts = p.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) throw new Error(`ルートを超えるパス: ${p}`);
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

// 拡張子 (ドット込み、小文字)。ドットファイル (.gitignore) は "" 扱い。
export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i <= 0 ? "" : b.slice(i).toLowerCase();
}

// YAML 内の参照を絶対パスに解決する。
// "/..." は絶対、"./..." や "name.ext" や "../..." は参照元ファイル基準。
export function resolvePath(reference: string, containingFile: string): string {
  if (reference.startsWith("/")) return normalize(reference);
  return normalize(join(dirname(containingFile), reference));
}

// ある絶対パスが別のディレクトリの子孫か (自身は除く)。
export function isDescendant(path: string, ancestorDir: string): boolean {
  const a = normalize(ancestorDir);
  const p = normalize(path);
  if (a === "/") return p !== "/";
  return p.startsWith(a + "/");
}

// ZIP 互換性とファイル名健全性のためのバリデーション (§13.5)。
const INVALID_NAME = /[\\:*?"<>|\x00/]/;
export function isValidName(name: string): boolean {
  return name.length > 0 && name !== "." && name !== ".." && !INVALID_NAME.test(name);
}
