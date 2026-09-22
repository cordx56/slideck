import type { Primitive } from "../ir/lir";
import type { MirImage } from "../ir/mir";
import type { Dimension } from "../schema/position";
import type { LowerCtx } from "./context";
import { type Box, type Intrinsic, resolveBox, toPx } from "./position";

// Explicit px size of an axis (from size, or start+end), else undefined.
export function axisSize(
  start: Dimension | undefined,
  end: Dimension | undefined,
  size: Dimension | undefined,
  extent: number,
): number | undefined {
  if (size) return toPx(size, extent);
  if (start && start.kind !== "center" && end) {
    return extent - toPx(start, extent) - toPx(end, extent);
  }
  return undefined;
}

// Resolve an image's box. When only one of width/height is constrained, derive
// the other from the image's aspect ratio so it is anchored at its position
// rather than centered in the leftover space. Unknown intrinsic size (e.g. SVG)
// keeps the generic box behavior.
export function imageBox(el: MirImage, parent: Box, ctx: LowerCtx): Box {
  const img = ctx.images.get(el.src);
  const aspect = img && img.height > 0 ? img.width / img.height : undefined;
  if (aspect === undefined) return resolveBox(el.position, parent);
  const p = el.position ?? {};
  const explicitW = axisSize(p.left, p.right, p.width, parent.w);
  const explicitH = axisSize(p.top, p.bottom, p.height, parent.h);
  const intrinsic: Intrinsic = {
    w: explicitH !== undefined ? explicitH * aspect : undefined,
    h: explicitW !== undefined ? explicitW / aspect : undefined,
  };
  return resolveBox(el.position, parent, intrinsic);
}

export function emitImage(el: MirImage, box: Box, ctx: LowerCtx, out: Primitive[]): void {
  const img = ctx.images.get(el.src);
  if (!img) return;
  const fitted = fitImage(box, img.width, img.height, el.fit);
  out.push({
    kind: "image",
    x: fitted.x,
    y: fitted.y,
    w: fitted.w,
    h: fitted.h,
    data: img.data,
    mime: img.mime,
  });
}

// Fit the image draw rect inside box per fit. cover behaves like fill in Phase 1.
export function fitImage(box: Box, iw: number, ih: number, fit: "contain" | "cover" | "fill"): Box {
  if (fit === "fill" || fit === "cover" || iw <= 0 || ih <= 0) {
    return box;
  }
  const scale = Math.min(box.w / iw, box.h / ih);
  const w = iw * scale;
  const h = ih * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}
