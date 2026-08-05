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

const prims = (text: string): Primitive[] =>
  lower(deckWithText(text).slides[0], deckWithText(text), ctx).primitives;
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

describe("renderMath (KaTeX -> native primitives)", () => {
  it("converts formula glyphs to positioned text", () => {
    const r = renderMath("E=mc^2", 40);
    expect(r).not.toBeNull();
    expect(r!.width).toBeGreaterThan(0);
    expect(r!.ascent).toBeGreaterThan(0);
    const texts = r!.items.filter((item) => item.kind === "text");
    expect(texts.map((item) => item.text).join("")).toBe("E=mc2");
    expect(texts.every((item) => item.family.startsWith("slideck-katex-"))).toBe(true);
  });
  it("doubling the size doubles the width", () => {
    const a = renderMath("x+1", 20)!;
    const b = renderMath("x+1", 40)!;
    expect(b.width / a.width).toBeCloseTo(2, 1);
  });
});

describe("lower of rich text (native expansion)", () => {
  it("math glyphs and surrounding content are emitted as selectable text", () => {
    const ps = prims("area is $x^2$");
    expect(ps.some((p) => p.kind === "text")).toBe(true);
    const mathRuns = allRuns(ps).filter((run) => run.font.family.startsWith("slideck-katex-"));
    expect(mathRuns.map((run) => run.text).join("")).toBe("x2");
    const svg = renderSvgString({ id: "s", width: 1000, height: 1000, primitives: ps });
    expect(svg).toContain("slideck-katex-Math-Italic");
    expect(svg).not.toContain("foreignObject");
    expect(svg).toContain("area is");
  });

  it("text without math is a normal text primitive", () => {
    const ps = prims("just text");
    expect(ps).toHaveLength(1);
    expect(ps[0].kind).toBe("text");
  });

  it("bold falls back to the surrounding font when no bold face is declared", () => {
    // No defaults.text.bold and no auto-detect candidate, so the bold run uses
    // the element's own family (baseFont). The family alone encodes the role.
    const run = allRuns(prims("this is **bold** text")).find((r) => r.text === "bold");
    expect(run?.font.family).toBe("body");
  });

  it("code uses the surrounding text font when no mono font is declared", () => {
    const run = allRuns(prims("value is `x`")).find((r) => r.text === "x");
    expect(run?.font.family).toBe("body");
  });

  it("italic with no italic face falls back to base font + synthetic-italic flag", () => {
    const run = allRuns(prims("read *quickly* now")).find((r) => r.text === "quickly");
    expect(run?.font.family).toBe("body");
    expect(run?.font.italic).toBe(true);
  });

  it("keeps only stretchy radical geometry as a clipped SVG path", () => {
    // The x glyph remains text; only the shape KaTeX itself defines as SVG is a path.
    const ps = prims("$\\sqrt{x}$");
    expect(allRuns(ps).some((run) => run.text === "x")).toBe(true);
    const radical = ps.find((p) => p.kind === "svgPath");
    expect(radical?.kind).toBe("svgPath");
    if (radical?.kind === "svgPath") {
      expect(radical.w).toBeGreaterThan(0);
      expect(radical.h).toBeGreaterThan(0);
      expect(radical.viewBox.width).toBe(400000);
    }
  });

  it("aligns a wide accent with the expression it covers", () => {
    const rendered = renderMath("\\widehat{xyz}", 40);
    const accent = rendered?.items.find((item) => item.kind === "svgPath");
    expect(accent?.kind).toBe("svgPath");
    if (accent?.kind === "svgPath") {
      // KaTeX stretches the accent to the full expression width from x=0.
      expect(accent.x).toBeCloseTo(0, 4);
      expect(accent.width).toBeCloseTo(rendered!.width, 4);
    }
  });

  it("renders a fraction bar as a native rectangle", () => {
    const ps = prims("$\\frac{a}{b}$");
    const runs = allRuns(ps);
    expect(runs.map((run) => run.text).join("")).toBe("ba");
    const bar = ps.find((p) => p.kind === "rect" && p.w > 0 && p.h > 0);
    const numerator = runs.find((run) => run.text === "a");
    expect(bar?.kind).toBe("rect");
    expect(numerator).toBeDefined();
    if (bar?.kind === "rect" && numerator) {
      // The numerator and full-width fraction rule share the same left edge.
      expect(bar.x).toBeCloseTo(numerator.x, 4);
    }
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
