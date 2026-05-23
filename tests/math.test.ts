import { describe, it, expect } from "vitest";
import { lower } from "../src/lower";
import { renderSvgString } from "../src/render/svg";
import { ApproximateMetrics } from "../src/lower/metrics";
import {
  parseInlineMath,
  hasInlineMath,
  stripInlineMath,
} from "../src/lib/inline-math";
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
  return { slide: { width: 1000, height: 1000 }, fonts: new Map(), slides: [{ id: "s", elements: [el] }] };
}

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

describe("インライン数式テキストの lower / render", () => {
  it("数式を含むテキストは richtext プリミティブになる", () => {
    const deck = deckWithText("面積は $x^2$ です");
    const prim = lower(deck.slides[0], deck, ctx).primitives[0];
    expect(prim.kind).toBe("richtext");
    if (prim.kind === "richtext") {
      expect(prim.raw).toBe("面積は $x^2$ です");
      // PDF 用 runs は素テキスト ($ 除去)
      expect(prim.runs.map((r) => r.text).join("")).toContain("x^2");
    }
  });

  it("数式なしテキストは通常の text プリミティブ", () => {
    const deck = deckWithText("ただのテキスト");
    expect(lower(deck.slides[0], deck, ctx).primitives[0].kind).toBe("text");
  });

  it("SVG は KaTeX を foreignObject 内に出す", () => {
    const deck = deckWithText("和は $\\sum_i i$");
    const svg = renderSvgString(lower(deck.slides[0], deck, ctx));
    expect(svg).toContain("<foreignObject");
    expect(svg).toContain("katex");
    expect(svg).toContain("和は"); // 周囲のテキストも含む
  });

  it("不正な TeX でも例外を投げない", () => {
    const deck = deckWithText("x $\\frac{$ y");
    expect(() => renderSvgString(lower(deck.slides[0], deck, ctx))).not.toThrow();
  });
});
