import type { Primitive, TextRun } from "../ir/lir";
import type { Box } from "./position";
import type { RichLayout, RichRun } from "./rich-shaping";

// Expand the shapeRich result into native text and vector primitives.
export function emitRich(layout: RichLayout, box: Box, mathColor: string): Primitive[] {
  const out: Primitive[] = [];
  const runs: TextRun[] = layout.runs.map((r) => ({
    text: r.text,
    font: r.font,
    size: r.size,
    color: r.color,
    x: box.x + r.x,
    y: box.y + r.baseline,
  }));

  for (const math of layout.maths) {
    for (const item of math.items) {
      if (item.kind !== "text") continue;
      runs.push({
        text: item.text,
        font: { family: item.family },
        size: item.size,
        color: item.color ?? mathColor,
        x: box.x + math.x + item.x,
        y: box.y + math.baseline + item.baseline,
      });
    }
  }

  for (const math of layout.maths) {
    for (const item of math.items) {
      if (item.kind !== "rect" || !item.background) continue;
      out.push({
        kind: "rect",
        x: box.x + math.x + item.x,
        y: box.y + math.baseline + item.y,
        w: item.width,
        h: item.height,
        fill: item.color ?? mathColor,
      });
    }
  }
  if (runs.length) out.push({ kind: "text", x: box.x, y: box.y, runs, align: "left" });

  for (const r of layout.runs) {
    if (r.underline) out.push(decoLine(box, r, r.baseline + r.size * 0.12));
    if (r.strike) out.push(decoLine(box, r, r.baseline - r.size * 0.28));
    if (r.href) {
      // Use the run's box as the click region (top edge to below baseline).
      out.push({
        kind: "link",
        x: box.x + r.x,
        y: box.y + r.baseline - r.size * 0.8,
        w: r.width,
        h: r.size,
        href: r.href,
      });
    }
  }

  for (const math of layout.maths) {
    for (const item of math.items) {
      const color = item.color ?? mathColor;
      if (item.kind === "rect" && !item.background) {
        out.push({
          kind: "rect",
          x: box.x + math.x + item.x,
          y: box.y + math.baseline + item.y,
          w: item.width,
          h: item.height,
          fill: item.strokeWidth ? undefined : color,
          stroke: item.strokeWidth ? { color, width: item.strokeWidth } : undefined,
        });
      } else if (item.kind === "line") {
        out.push({
          kind: "line",
          x1: box.x + math.x + item.x1,
          y1: box.y + math.baseline + item.y1,
          x2: box.x + math.x + item.x2,
          y2: box.y + math.baseline + item.y2,
          stroke: { color, width: item.width },
        });
      } else if (item.kind === "svgPath") {
        out.push({
          kind: "svgPath",
          d: item.d,
          x: box.x + math.x + item.x,
          y: box.y + math.baseline + item.y,
          w: item.width,
          h: item.height,
          viewBox: item.viewBox,
          preserveAlign: item.align,
          fill: color,
        });
      }
    }
  }

  return out;
}

// Turn a run's underline/strike into a single line primitive.
export function decoLine(box: Box, r: RichRun, yRel: number): Primitive {
  const y = box.y + yRel;
  return {
    kind: "line",
    x1: box.x + r.x,
    y1: y,
    x2: box.x + r.x + r.width,
    y2: y,
    stroke: { color: r.color, width: Math.max(1, r.size * 0.05) },
  };
}
