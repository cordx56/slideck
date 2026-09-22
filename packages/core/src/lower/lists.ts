import type { Primitive } from "../ir/lir";
import type { MirElement, MirList } from "../ir/mir";
import { computeAutoLayout } from "./auto-layout";
import type { LowerCtx } from "./context";
import { applyPadding } from "./groups";
import { listContentBox, listGutter } from "./list-geometry";
import type { Box } from "./position";
import { shapeText } from "./text-shaping";

type PlaceAtBox = (
  el: MirElement,
  box: Box,
  isRow: boolean,
  ctx: LowerCtx,
  out: Primitive[],
) => void;

// Expand ul/ol vertically and draw a marker in the gutter left of each item.
export function placeList(
  el: MirList,
  box: Box,
  ctx: LowerCtx,
  out: Primitive[],
  placeAtBox: PlaceAtBox,
): void {
  const inner = applyPadding(box, el.padding, ctx);
  const gutter = listGutter(el);
  const contentBox = listContentBox(el, box, ctx);

  // Lay out items with column auto-layout.
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

  placed.forEach((p, i) => {
    // Align the marker to the item's first line.
    const itemAscent =
      p.el.type === "text"
        ? p.el.size * ctx.metrics.ascentRatio(p.el.font)
        : el.size * ctx.metrics.ascentRatio(el.font);
    const baseline = p.box.y + itemAscent;

    if (el.type === "ul") {
      // Filled circle centered in the gutter, around the line's vertical middle.
      out.push({
        kind: "circle",
        cx: inner.x + gutter / 2,
        cy: baseline - el.size * 0.3,
        r: el.size * 0.13,
        fill: el.color,
      });
    } else {
      const marker = `${el.start + i}.`;
      const shaped = shapeText(
        marker,
        {
          font: el.font,
          size: el.size,
          align: "right",
          lineHeight: 1.2,
          letterSpacing: 0,
        },
        gutter,
        ctx.metrics,
      );
      out.push({
        kind: "text",
        x: inner.x,
        y: p.box.y,
        align: "right",
        runs: [
          {
            text: marker,
            font: { family: el.font },
            size: el.size,
            color: el.color,
            x: inner.x + shaped.lines[0].x,
            y: baseline,
          },
        ],
      });
    }
    // List items are stacked in a column, so position.left/right/width on an
    // item indents/shrinks it within the list's content box.
    placeAtBox(p.el, p.box, false, ctx, out);
  });
}
