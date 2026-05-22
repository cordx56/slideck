import type { MirDeck, MirElement } from "../ir/mir";
import type { AssetResolver } from "./assets";
import type { FontMetrics } from "../lower/metrics";
import type { LoadedImage, LowerCtx } from "../lower/context";
import { PipelineError } from "../lib/error";

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

export function mimeFromPath(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

// 全スライドの要素ツリーを走査して image の src を集める。
function collectImageSrcs(deck: MirDeck): Set<string> {
  const srcs = new Set<string>();
  const walk = (els: MirElement[]) => {
    for (const el of els) {
      if (el.type === "image") srcs.add(el.src);
      else if (el.type === "group") walk(el.children);
    }
  };
  for (const s of deck.slides) walk(s.elements);
  return srcs;
}

// 画像 Blob から自然サイズを得る (ブラウザ)。
async function decodeSize(
  data: Uint8Array,
  mime: string,
): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap !== "function") {
    return { width: 0, height: 0 };
  }
  const blob = new Blob([data as BlobPart], { type: mime });
  const bmp = await createImageBitmap(blob);
  const size = { width: bmp.width, height: bmp.height };
  bmp.close();
  return size;
}

// lower に渡すリソース (画像バイト + メトリクス) を非同期に揃える。
export async function prepare(
  deck: MirDeck,
  resolver: AssetResolver,
  metrics: FontMetrics,
  errors: PipelineError[] = [],
): Promise<LowerCtx> {
  const images = new Map<string, LoadedImage>();
  for (const src of collectImageSrcs(deck)) {
    try {
      const data = await resolver.readBytes(src);
      const mime = mimeFromPath(src);
      const { width, height } = await decodeSize(data, mime);
      images.set(src, { data, mime, width, height });
    } catch (e) {
      errors.push(new PipelineError(`画像読込失敗: ${src} (${String(e)})`));
    }
  }
  return { metrics, images };
}
