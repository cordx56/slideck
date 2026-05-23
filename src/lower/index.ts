import type { MirDeck, MirElement, MirSlide, MirText } from "../ir/mir";
import type { Primitive, SlideLir, TextRun, Stroke } from "../ir/lir";
import { type Box, resolveAxis, resolveBox, toPx } from "./position";
import { applyPadding } from "./groups";
import { computeAutoLayout } from "./auto-layout";
import { shapeText } from "./text-shaping";
import type { LowerCtx } from "./context";

export type { LowerCtx } from "./context";
export type { LoadedImage } from "./context";

// MIR スライドを LIR (絶対座標プリミティブ列) に下ろす。同期・純粋関数。
export function lower(slide: MirSlide, deck: MirDeck, ctx: LowerCtx): SlideLir {
  const slideBox: Box = {
    x: 0,
    y: 0,
    w: deck.slide.width,
    h: deck.slide.height,
  };
  const out: Primitive[] = [];
  for (const el of slide.elements) lowerElement(el, slideBox, ctx, out);
  return {
    id: slide.id,
    width: deck.slide.width,
    height: deck.slide.height,
    background: slide.background,
    primitives: out,
  };
}

// 親ボックスに対して位置を解決し、要素を配置・描画する。
function lowerElement(
  el: MirElement,
  parentBox: Box,
  ctx: LowerCtx,
  out: Primitive[],
): void {
  if (el.type === "text") {
    placeElement(el, textBox(el, parentBox, ctx), ctx, out);
    return;
  }
  if (el.type === "line") {
    // line は from/to を親ボックス相対で解釈するため、box=親。
    placeElement(el, parentBox, ctx, out);
    return;
  }
  const box = resolveBox("position" in el ? el.position : undefined, parentBox);
  placeElement(el, box, ctx, out);
}

// テキストの位置解決: 先に幅を確定し、シェイプして高さを得てから縦を解決。
function textBox(el: MirText, parent: Box, ctx: LowerCtx): Box {
  const p = el.position ?? {};
  const hx = resolveAxis(p.left, p.right, p.width, parent.x, parent.w);
  const shaped = shapeText(
    el.text,
    el.font,
    el.size,
    hx.size,
    el.align,
    el.lineHeight,
    el.letterSpacing,
    ctx.metrics,
  );
  const vy = resolveAxis(p.top, p.bottom, p.height, parent.y, parent.h, shaped.height);
  return { x: hx.pos, y: vy.pos, w: hx.size, h: vy.size };
}

// 確定した box に要素を描画する (auto-layout からはこの box が直接渡る)。
function placeElement(
  el: MirElement,
  box: Box,
  ctx: LowerCtx,
  out: Primitive[],
): void {
  switch (el.type) {
    case "text": {
      const shaped = shapeText(
        el.text,
        el.font,
        el.size,
        box.w,
        el.align,
        el.lineHeight,
        el.letterSpacing,
        ctx.metrics,
      );
      const runs: TextRun[] = shaped.lines.map((line) => ({
        text: line.text,
        font: { family: el.font },
        size: el.size,
        color: el.color,
        x: box.x + line.x,
        y: box.y + line.baseline,
      }));
      out.push({ kind: "text", x: box.x, y: box.y, runs, align: el.align });
      break;
    }
    case "image": {
      const img = ctx.images.get(el.src);
      if (!img) break; // prepare で未解決ならスキップ
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
      break;
    }
    case "rect":
      out.push({
        kind: "rect",
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        fill: el.fill,
        stroke: makeStroke(el.stroke, el.strokeWidth),
        rx: el.rx || undefined,
      });
      break;
    case "line": {
      const x1 = box.x + toPx(el.from.x, box.w);
      const y1 = box.y + toPx(el.from.y, box.h);
      const x2 = box.x + toPx(el.to.x, box.w);
      const y2 = box.y + toPx(el.to.y, box.h);
      out.push({
        kind: "line",
        x1,
        y1,
        x2,
        y2,
        stroke: { color: el.stroke, width: el.strokeWidth },
      });
      break;
    }
    case "path":
      out.push({
        kind: "path",
        d: el.d,
        fill: el.fill,
        stroke: makeStroke(el.stroke, el.strokeWidth),
      });
      break;
    case "group": {
      const inner = applyPadding(box, el.padding);
      if (el.layout) {
        for (const placed of computeAutoLayout(el, inner, ctx)) {
          placeAtBox(placed.el, placed.box, ctx, out);
        }
      } else {
        for (const child of el.children) lowerElement(child, inner, ctx, out);
      }
      break;
    }
    case "ul":
    case "ol":
      placeList(el, box, ctx, out);
      break;
    case "math":
      out.push({
        kind: "math",
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        tex: el.tex,
        size: el.size,
        color: el.color,
        display: el.display,
      });
      break;
  }
}

// ul/ol を縦並びに展開し、各 item の左に gutter でマーカ (• / 番号) を描く。
function placeList(
  el: Extract<MirElement, { type: "ul" | "ol" }>,
  box: Box,
  ctx: LowerCtx,
  out: Primitive[],
): void {
  const inner = applyPadding(box, el.padding);
  const gutter = el.size * (el.type === "ol" ? 1.8 : 1.0);
  const markerGap = el.size * 0.4;
  const contentBox: Box = {
    x: inner.x + gutter + markerGap,
    y: inner.y,
    w: Math.max(0, inner.w - gutter - markerGap),
    h: inner.h,
  };

  // items を column auto-layout で配置する。
  const placed = computeAutoLayout(
    {
      type: "group",
      children: el.items,
      layout: "column",
      gap: el.gap,
      align: el.align,
      justify: "start",
      padding: { kind: "percent", value: 0 },
    },
    contentBox,
    ctx,
  );

  const markerAlign = el.type === "ol" ? "right" : "left";
  placed.forEach((p, i) => {
    const marker = el.type === "ul" ? "•" : `${el.start + i}.`;
    // マーカのベースラインを item の 1 行目に合わせる。
    const itemAscent =
      p.el.type === "text"
        ? p.el.size * ctx.metrics.ascentRatio(p.el.font)
        : el.size * ctx.metrics.ascentRatio(el.font);
    const shaped = shapeText(marker, el.font, el.size, gutter, markerAlign, 1.2, 0, ctx.metrics);
    const line = shaped.lines[0];
    out.push({
      kind: "text",
      x: inner.x,
      y: p.box.y,
      align: markerAlign,
      runs: [
        {
          text: marker,
          font: { family: el.font },
          size: el.size,
          color: el.color,
          x: inner.x + line.x,
          y: p.box.y + itemAscent,
        },
      ],
    });
    placeAtBox(p.el, p.box, ctx, out);
  });
}

// auto-layout が割り当てた box に子を配置する (子自身の position は無視)。
function placeAtBox(
  el: MirElement,
  box: Box,
  ctx: LowerCtx,
  out: Primitive[],
): void {
  placeElement(el, box, ctx, out);
}

function makeStroke(color: string | undefined, width: number): Stroke | undefined {
  if (!color || width <= 0) return undefined;
  return { color, width };
}

// fit に応じて画像描画矩形を box 内に収める。cover は Phase 1 では fill 相当。
function fitImage(
  box: Box,
  iw: number,
  ih: number,
  fit: "contain" | "cover" | "fill",
): Box {
  if (fit === "fill" || fit === "cover" || iw <= 0 || ih <= 0) {
    return box;
  }
  const scale = Math.min(box.w / iw, box.h / ih);
  const w = iw * scale;
  const h = ih * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}
