const MIME_BY_EXT: Record<string, string> = {
  yaml: "text/yaml",
  yml: "text/yaml",
  json: "application/json",
  txt: "text/plain",
  md: "text/markdown",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};

export function mimeFromPath(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

const TEXT_EXTS = new Set(["yaml", "yml", "json", "txt", "md", "svg", "csv"]);
export function isTextPath(path: string): boolean {
  return TEXT_EXTS.has(path.slice(path.lastIndexOf(".") + 1).toLowerCase());
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);
export function isImagePath(path: string): boolean {
  return IMAGE_EXTS.has(path.slice(path.lastIndexOf(".") + 1).toLowerCase());
}

const FONT_EXTS = new Set(["ttf", "otf", "woff", "woff2"]);
export function isFontPath(path: string): boolean {
  return FONT_EXTS.has(path.slice(path.lastIndexOf(".") + 1).toLowerCase());
}
