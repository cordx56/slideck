// Text style resolution and layout for lower. The MIR carries the styles
// declared by the theme; the auto-detected role faces only become known in
// prepare, so the two are merged here instead of mutating the deck.
import type { Primitive, TextRun } from "../ir/lir";
import type { MirText, RichStyle } from "../ir/mir";
import { hasRichMarkup } from "../lib/richtext";
import type { FontRoles, LowerCtx } from "./context";
import type { Box } from "./position";
import { emitRich } from "./rich-emit";
import { shapeRich } from "./rich-shaping";
import { shapeText } from "./text-shaping";

// Fill each undeclared ("") role family with the auto-detected face for that
// role. A role that still resolves to "" makes rich-shaping fall back to the
// surrounding text font, so measured and rendered widths stay identical.
export function resolveRichStyle(rich: RichStyle, roles: Readonly<FontRoles>): RichStyle {
  return {
    ...rich,
    monoFamily: rich.monoFamily || roles.mono,
    boldFamily: rich.boldFamily || roles.bold,
    italicFamily: rich.italicFamily || roles.italic,
    boldItalicFamily: rich.boldItalicFamily || roles.boldItalic,
  };
}

export function measureTextHeight(el: MirText, width: number, ctx: LowerCtx): number {
  if (hasRichMarkup(el.text)) {
    return shapeRich(
      el.text,
      el,
      width,
      ctx.metrics,
      resolveRichStyle(el.rich, ctx.roles),
      el.color,
    ).height;
  }
  return shapeText(el.text, el, width, ctx.metrics).height;
}

export function layoutText(el: MirText, box: Box, ctx: LowerCtx): Primitive[] {
  if (hasRichMarkup(el.text)) {
    const layout = shapeRich(
      el.text,
      el,
      box.w,
      ctx.metrics,
      resolveRichStyle(el.rich, ctx.roles),
      el.color,
    );
    return emitRich(layout, box, el.color);
  }

  const shaped = shapeText(el.text, el, box.w, ctx.metrics);
  const runs: TextRun[] = shaped.lines.map((line) => ({
    text: line.text,
    font: { family: el.font },
    size: el.size,
    color: el.color,
    x: box.x + line.x,
    y: box.y + line.baseline,
  }));
  return [{ kind: "text", x: box.x, y: box.y, runs, align: el.align }];
}
