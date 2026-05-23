import { describe, it, expect } from "vitest";
import { lower } from "../src/lower";
import { renderSvgString } from "../src/render/svg";
import { ApproximateMetrics } from "../src/lower/metrics";
import type { LowerCtx } from "../src/lower/context";
import type { MirDeck } from "../src/ir";
import type { Dimension } from "../src/schema/position";

const pct = (v: number): Dimension => ({ kind: "percent", value: v });
const ctx: LowerCtx = { metrics: new ApproximateMetrics(), images: new Map() };

function deckWithMath(tex: string): MirDeck {
  return {
    slide: { width: 1000, height: 1000 },
    fonts: new Map(),
    slides: [
      {
        id: "s",
        elements: [
          {
            type: "math",
            position: { left: pct(10), top: pct(10), width: pct(80), height: pct(20) },
            tex,
            size: 40,
            color: "#ffffff",
            display: true,
          },
        ],
      },
    ],
  };
}

describe("math (KaTeX)", () => {
  it("lower が math プリミティブを生成する", () => {
    const lir = lower(deckWithMath("x^2").slides[0], deckWithMath("x^2"), ctx);
    expect(lir.primitives[0]).toMatchObject({
      kind: "math",
      tex: "x^2",
      size: 40,
      color: "#ffffff",
    });
  });

  it("SVG は KaTeX を foreignObject 内にレンダリングする", () => {
    const deck = deckWithMath("\\frac{a}{b}");
    const svg = renderSvgString(lower(deck.slides[0], deck, ctx));
    expect(svg).toContain("<foreignObject");
    expect(svg).toContain("katex"); // KaTeX 出力のクラス
    expect(svg).toContain("xmlns=\"http://www.w3.org/1999/xhtml\"");
  });

  it("不正な TeX でも例外を投げない (throwOnError:false)", () => {
    const deck = deckWithMath("\\frac{");
    expect(() => renderSvgString(lower(deck.slides[0], deck, ctx))).not.toThrow();
  });
});
