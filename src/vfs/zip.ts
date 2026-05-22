import { unzipSync, zipSync } from "fflate";

export interface ZipEntry {
  path: string; // ZIP 内の相対パス (先頭スラッシュなし)
  data: Uint8Array;
}

// ZIP Blob を展開してファイルエントリ列を返す (ディレクトリエントリは除外)。
export async function readZip(blob: Blob): Promise<ZipEntry[]> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const files = unzipSync(buf);
  const entries: ZipEntry[] = [];
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith("/")) continue;
    entries.push({ path: name, data });
  }
  return entries;
}

// ファイルエントリ列を ZIP Blob にまとめる。
export function writeZip(entries: ZipEntry[]): Blob {
  const obj: Record<string, Uint8Array> = {};
  for (const e of entries) obj[e.path] = e.data;
  const zipped = zipSync(obj);
  return new Blob([zipped as BlobPart], { type: "application/zip" });
}
