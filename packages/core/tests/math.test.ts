import { describe, it, expect } from "vitest";
import { lower } from "../src/lower";
import { renderSvgString } from "../src/render/svg";
import { ApproximateMetrics } from "../src/lower/metrics";
import { parseInlineMath, hasInlineMath, stripInlineMath } from "../src/lib/inline-math";
import { hasMarkdown, hasRichMarkup, parseRich } from "../src/lib/richtext";
import { renderMath } from "../src/lib/math";
import type { Primitive, TextRun } from "../src/ir/lir";
import type { LowerCtx } from "../src/lower/context";
import type { MirDeck, MirText } from "../src/ir";
import type { Dimension } from "../src/schema/position";

const pct = (v: number): Dimension => ({ kind: "percent", value: v });
const ctx: LowerCtx = {
  metrics: new ApproximateMetrics(),
  images: new Map(),
  slide: { width: 1000, height: 1000 },
};

function deckWithText(text: string): MirDeck {
  const el: MirText = {
    type: "text",
    position: { left: pct(10), top: pct(10), width: pct(80) },
    text,
    font: "body",
    size: 40,
    color: "#ffffff",
    align: "left",
    lineHeight: 1.2,
    letterSpacing: 0,
  };
  return {
    slide: { width: 1000, height: 1000 },
    fonts: new Map(),
    slides: [{ id: "s", elements: [el] }],
  };
}

const prims = (text: string): Primitive[] => lower(deckWithText(text).slides[0], deckWithText(text), ctx).primitives;
const allRuns = (ps: Primitive[]): TextRun[] =>
  ps.flatMap((p) => (p.kind === "text" ? p.runs : []));

describe("inline-math parser", () => {
  it("splits $...$ into text/math", () => {
    expect(parseInlineMath("a $x^2$ b")).toEqual([
      { math: false, value: "a " },
      { math: true, value: "x^2" },
      { math: false, value: " b" },
    ]);
  });
  it("hasInlineMath / stripInlineMath", () => {
    expect(hasInlineMath("plain")).toBe(false);
    expect(hasInlineMath("a $x$ b")).toBe(true);
    expect(stripInlineMath("a $x^2$ b")).toBe("a x^2 b");
  });
  it("does not collide with ${var}", () => {
    expect(hasInlineMath("${title} only")).toBe(false);
  });
});

describe("parseRich (segment decomposition)", () => {
  it("splits formulas into math segments", () => {
    const segs = parseRich("a $x^2$ b");
    expect(segs[0]).toMatchObject({ kind: "text", text: "a " });
    expect(segs[1]).toEqual({ kind: "math", tex: "x^2" });
  });
  it("attaches markdown style flags", () => {
    const find = (segs: ReturnType<typeof parseRich>, t: string) =>
      segs.find((s) => s.kind === "text" && s.text === t);
    const segs = parseRich("**b** `c` ~~s~~ [l](https://e.com)");
    expect(find(segs, "b")).toMatchObject({ bold: true });
    expect(find(segs, "c")).toMatchObject({ code: true });
    expect(find(segs, "s")).toMatchObject({ strike: true });
    expect(find(segs, "l")).toMatchObject({ link: true, href: "https://e.com" });
  });
});

describe("renderMath (MathJax -> paths)", () => {
  it("converts formulas to path lists (proportional to px size)", () => {
    const r = renderMath("E=mc^2", 40);
    expect(r).not.toBeNull();
    expect(r!.width).toBeGreaterThan(0);
    expect(r!.ascent).toBeGreaterThan(0);
    expect(r!.glyphs.length).toBeGreaterThan(0);
    expect(r!.glyphs[0].d).toMatch(/^M/);
  });
  it("doubling the size doubles the width", () => {
    const a = renderMath("x+1", 20)!;
    const b = renderMath("x+1", 40)!;
    expect(b.width / a.width).toBeCloseTo(2, 1);
  });
});

describe("lower of rich text (native expansion)", () => {
  it("math text becomes path(formula) + text(surrounding) with no foreignObject", () => {
    const ps = prims("area is $x^2$");
    expect(ps.some((p) => p.kind === "path")).toBe(true);
    expect(ps.some((p) => p.kind === "text")).toBe(true);
    const svg = renderSvgString({ id: "s", width: 1000, height: 1000, primitives: ps });
    expect(svg).toContain("<path");
    expect(svg).not.toContain("foreignObject");
    expect(svg).not.toContain("katex");
    expect(svg).toContain("area is");
  });

  it("text without math is a normal text primitive", () => {
    const ps = prims("just text");
    expect(ps).toHaveLength(1);
    expect(ps[0].kind).toBe("text");
  });

  it("bold is suppressed when no bold variant is loaded (matches measure)", () => {
    // With ApproximateMetrics no exact variants are loaded, so the bold run is
    // emitted without font-weight to keep the rendered glyphs in sync with the
    // measured width (otherwise the following text would mis-align).
    const run = allRuns(prims("this is **bold** text")).find((r) => r.text === "bold");
    expect(run?.font.weight).toBeUndefined();
  });

  it("code uses the surrounding text font when no mono font is declared", () => {
    const run = allRuns(prims("value is `x`")).find((r) => r.text === "x");
    expect(run?.font.family).toBe("body");
  });

  it("strikethrough produces a line primitive", () => {
    expect(prims("this is ~~struck~~ out").some((p) => p.kind === "line")).toBe(true);
  });

  it("links produce an underline (line) and a click area (link)", () => {
    const ps = prims("[L](https://e.com) see");
    expect(ps.some((p) => p.kind === "line")).toBe(true);
    const link = ps.find((p) => p.kind === "link");
    expect(link).toBeDefined();
    if (link?.kind === "link") {
      expect(link.href).toBe("https://e.com");
      expect(link.w).toBeGreaterThan(0);
    }
  });

  it("SVG emits links as <a>", () => {
    const ps = prims("[L](https://e.com) see");
    const svg = renderSvgString({ id: "s", width: 1000, height: 1000, primitives: ps });
    expect(svg).toContain('<a href="https://e.com"');
  });

  it("does not throw even on invalid TeX", () => {
    expect(() => prims("x $\\frac{$ y")).not.toThrow();
  });
});

describe("inline Markdown detection", () => {
  it("hasMarkdown / hasRichMarkup", () => {
    expect(hasMarkdown("**bold**")).toBe(true);
    expect(hasMarkdown("`code`")).toBe(true);
    expect(hasMarkdown("~~del~~")).toBe(true);
    expect(hasMarkdown("[t](u)")).toBe(true);
    expect(hasMarkdown("plain sentence")).toBe(false);
    expect(hasRichMarkup("sum is $x$")).toBe(true);
  });
});
