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
const ctx: LowerCtx = { metrics: new ApproximateMetrics(), images: new Map() };

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

describe("inline-math パーサ", () => {
  it("$...$ を text/math に分割する", () => {
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
  it("${var} とは衝突しない", () => {
    expect(hasInlineMath("${title} だけ")).toBe(false);
  });
});

describe("parseRich (セグメント分解)", () => {
  it("数式を math セグメントに分ける", () => {
    const segs = parseRich("a $x^2$ b");
    expect(segs[0]).toMatchObject({ kind: "text", text: "a " });
    expect(segs[1]).toEqual({ kind: "math", tex: "x^2" });
  });
  it("markdown のスタイルフラグを付ける", () => {
    const find = (segs: ReturnType<typeof parseRich>, t: string) =>
      segs.find((s) => s.kind === "text" && s.text === t);
    const segs = parseRich("**b** `c` ~~s~~ [l](https://e.com)");
    expect(find(segs, "b")).toMatchObject({ bold: true });
    expect(find(segs, "c")).toMatchObject({ code: true });
    expect(find(segs, "s")).toMatchObject({ strike: true });
    expect(find(segs, "l")).toMatchObject({ link: true });
  });
});

describe("renderMath (MathJax -> パス)", () => {
  it("数式をパス列に変換する (px サイズに比例)", () => {
    const r = renderMath("E=mc^2", 40);
    expect(r).not.toBeNull();
    expect(r!.width).toBeGreaterThan(0);
    expect(r!.ascent).toBeGreaterThan(0);
    expect(r!.glyphs.length).toBeGreaterThan(0);
    expect(r!.glyphs[0].d).toMatch(/^M/);
  });
  it("サイズを倍にすると幅も倍になる", () => {
    const a = renderMath("x+1", 20)!;
    const b = renderMath("x+1", 40)!;
    expect(b.width / a.width).toBeCloseTo(2, 1);
  });
});

describe("rich テキストの lower (ネイティブ展開)", () => {
  it("数式テキストは path(数式) + text(周囲) になり foreignObject は出ない", () => {
    const ps = prims("面積は $x^2$ です");
    expect(ps.some((p) => p.kind === "path")).toBe(true);
    expect(ps.some((p) => p.kind === "text")).toBe(true);
    const svg = renderSvgString({ id: "s", width: 1000, height: 1000, primitives: ps });
    expect(svg).toContain("<path");
    expect(svg).not.toContain("foreignObject");
    expect(svg).not.toContain("katex");
    expect(svg).toContain("面積は");
  });

  it("数式なしテキストは通常の text プリミティブ", () => {
    const ps = prims("ただのテキスト");
    expect(ps).toHaveLength(1);
    expect(ps[0].kind).toBe("text");
  });

  it("太字は run の font-weight になる", () => {
    const run = allRuns(prims("これは **太字** です")).find((r) => r.text === "太字");
    expect(run?.font.weight).toBe(700);
  });

  it("コードは monospace ファミリの run になる", () => {
    const run = allRuns(prims("値は `x` です")).find((r) => r.text === "x");
    expect(run?.font.family).toBe("monospace");
  });

  it("打ち消しは line プリミティブを生む", () => {
    expect(prims("これは ~~消し~~ ます").some((p) => p.kind === "line")).toBe(true);
  });

  it("リンクは下線 (line) を生む", () => {
    expect(prims("[L](https://e.com) を見て").some((p) => p.kind === "line")).toBe(true);
  });

  it("不正な TeX でも例外を投げない", () => {
    expect(() => prims("x $\\frac{$ y")).not.toThrow();
  });
});

describe("inline Markdown 検出", () => {
  it("hasMarkdown / hasRichMarkup", () => {
    expect(hasMarkdown("**bold**")).toBe(true);
    expect(hasMarkdown("`code`")).toBe(true);
    expect(hasMarkdown("~~del~~")).toBe(true);
    expect(hasMarkdown("[t](u)")).toBe(true);
    expect(hasMarkdown("ただの文")).toBe(false);
    expect(hasRichMarkup("和は $x$")).toBe(true);
  });
});
