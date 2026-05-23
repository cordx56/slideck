import { unzipSync, zipSync } from "fflate";

export interface ZipEntry {
  path: string; // Relative path inside the ZIP (no leading slash)
  data: Uint8Array;
}

// Unpack a ZIP Blob and return its file entries (directory entries excluded).
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

// Bundle file entries into a ZIP Blob.
export function writeZip(entries: ZipEntry[]): Blob {
  const obj: Record<string, Uint8Array> = {};
  for (const e of entries) obj[e.path] = e.data;
  const zipped = zipSync(obj);
  return new Blob([zipped as BlobPart], { type: "application/zip" });
}
