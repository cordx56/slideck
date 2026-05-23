import type { MirDeck, MirElement } from "../ir/mir";
import type { AssetResolver } from "./assets";
import type { FontMetrics } from "../lower/metrics";
import { ApproximateMetrics } from "../lower/metrics";
import { FontkitMetrics, createFkFont } from "../lower/fontkit-metrics";
import type { LoadedImage, LoadedFont, LowerCtx } from "../lower/context";
import { isTtc, extractFontFromTtc } from "./ttc";
import { mimeFromPath } from "../lib/mime";
import { PipelineError } from "../lib/error";

// lower 用リソース一式。fonts は PDF 埋め込み/プレビュー登録にも使う。
export interface PreparedAssets {
  ctx: LowerCtx;
  fonts: Map<string, LoadedFont>;
}

// 全スライドの要素ツリーを走査して image の src を集める。
function collectImageSrcs(deck: MirDeck): Set<string> {
  const srcs = new Set<string>();
  const walk = (els: MirElement[]) => {
    for (const el of els) {
      if (el.type === "image") srcs.add(el.src);
      else if (el.type === "group") walk(el.children);
      else if (el.type === "ul" || el.type === "ol") walk(el.items);
    }
  };
  for (const s of deck.slides) walk(s.elements);
  return srcs;
}

// 画像 Blob から自然サイズを得る (ブラウザ)。Node では 0 を返す。
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

async function loadFonts(
  deck: MirDeck,
  resolver: AssetResolver,
  errors: PipelineError[],
): Promise<Map<string, LoadedFont>> {
  const fonts = new Map<string, LoadedFont>();
  for (const [family, decl] of deck.fonts) {
    if (!decl.path) continue;
    try {
      let bytes = await resolver.readBytes(decl.path);
      // .ttc は指定インデックスのフォントを単独 SFNT に展開する。
      if (isTtc(bytes)) bytes = extractFontFromTtc(bytes, decl.index ?? 0);
      fonts.set(family, {
        family,
        bytes,
        weight: decl.weight,
        style: decl.style,
      });
    } catch (e) {
      errors.push(new PipelineError(`フォント読込失敗: ${decl.path} (${String(e)})`));
    }
  }
  return fonts;
}

function buildMetrics(fonts: Map<string, LoadedFont>): FontMetrics {
  if (fonts.size === 0) return new ApproximateMetrics();
  const fk = new Map();
  for (const [family, lf] of fonts) {
    const font = createFkFont(lf.bytes);
    if (font) fk.set(family, font);
  }
  return fk.size > 0 ? new FontkitMetrics(fk) : new ApproximateMetrics();
}

// lower に渡すリソース (画像・フォント・メトリクス) を非同期に揃える。
export async function prepare(
  deck: MirDeck,
  resolver: AssetResolver,
  errors: PipelineError[] = [],
): Promise<PreparedAssets> {
  const fonts = await loadFonts(deck, resolver, errors);
  const metrics = buildMetrics(fonts);

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

  return { ctx: { metrics, images }, fonts };
}
