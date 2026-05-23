import { describe, it, expect } from "vitest";
import { lower } from "../src/lower";
import { renderSvgString } from "../src/render/svg";
import { ApproximateMetrics } from "../src/lower/metrics";
import {
  parseInlineMath,
  hasInlineMath,
  stripInlineMath,
} from "../src/lib/inline-math";
import {
  hasMarkdown,
  hasRichMarkup,
  renderRichHtml,
  richToPlain,
} from "../src/lib/richtext";
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

describe("inline Markdown", () => {
  it("hasMarkdown は対応マーカを検出する", () => {
    expect(hasMarkdown("**bold**")).toBe(true);
    expect(hasMarkdown("`code`")).toBe(true);
    expect(hasMarkdown("~~del~~")).toBe(true);
    expect(hasMarkdown("[t](u)")).toBe(true);
    expect(hasMarkdown("ただの文")).toBe(false);
  });

  it("renderRichHtml が Markdown を HTML に変換する", () => {
    const html = renderRichHtml("**強調** と `code` と ~~消し~~ と [L](https://e.com)");
    expect(html).toContain("<strong>強調</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<s>消し</s>");
    expect(html).toContain('<a href="https://e.com"');
  });

  it("Markdown と数式を同居できる", () => {
    const html = renderRichHtml("**E** は $E=mc^2$");
    expect(html).toContain("<strong>E</strong>");
    expect(html).toContain("katex");
  });

  it("richToPlain はマークアップを外す", () => {
    expect(richToPlain("**a** `b` ~~c~~ [d](u) $x^2$")).toBe("a b c d x^2");
  });

  it("Markdown を含むテキストは richtext になり HTML を出す", () => {
    const deck = deckWithText("これは **太字** です");
    const prim = lower(deck.slides[0], deck, ctx).primitives[0];
    expect(prim.kind).toBe("richtext");
    expect(hasRichMarkup("これは **太字** です")).toBe(true);
    const svg = renderSvgString(lower(deck.slides[0], deck, ctx));
    expect(svg).toContain("<foreignObject");
    expect(svg).toContain("<strong>太字</strong>");
  });

  it("生 HTML は無効化される (html:false)", () => {
    expect(renderRichHtml("a `x` <script>bad</script>")).not.toContain("<script>");
  });

  it("RichStyle でリンク/コードにスタイルを当てる", () => {
    const html = renderRichHtml("`c` [t](http://e.com)", {
      linkColor: "#ff0000",
      linkUnderline: false,
      monoFamily: "Menlo",
      monoColor: "#00ff00",
    });
    expect(html).toContain("color:#ff0000");
    expect(html).toContain("text-decoration:none");
    expect(html).toContain("font-family:'Menlo',monospace");
    expect(html).toContain("color:#00ff00");
  });
});
