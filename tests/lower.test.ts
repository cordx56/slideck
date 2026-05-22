import { describe, it, expect } from "vitest";
import { lower } from "../src/lower";
import { computeAutoLayout } from "../src/lower/auto-layout";
import { ApproximateMetrics } from "../src/lower/metrics";
import type { LowerCtx } from "../src/lower/context";
import type { MirDeck, MirGroup, MirSlide } from "../src/ir";
import type { Dimension } from "../src/schema/position";

const pct = (v: number): Dimension => ({ kind: "percent", value: v });
const ctx: LowerCtx = { metrics: new ApproximateMetrics(), images: new Map() };

function deckWith(elements: MirSlide["elements"]): MirDeck {
  return {
    slide: { width: 1000, height: 1000 },
    fonts: new Map(),
    slides: [{ id: "s", elements }],
  };
}

describe("lower", () => {
  it("rect の % を絶対 px に解決する", () => {
    const deck = deckWith([
      {
        type: "rect",
        position: { left: pct(10), top: pct(10), width: pct(50), height: pct(20) },
        fill: "#ff0000",
        strokeWidth: 0,
        rx: 0,
      },
    ]);
    const lir = lower(deck.slides[0], deck, ctx);
    expect(lir.primitives).toHaveLength(1);
    expect(lir.primitives[0]).toMatchObject({
      kind: "rect",
      x: 100,
      y: 100,
      w: 500,
      h: 200,
      fill: "#ff0000",
    });
  });

  it("text を行ごとの run に分解する", () => {
    const deck = deckWith([
      {
        type: "text",
        position: { left: pct(0), top: pct(0), width: pct(100) },
        text: "a\nb",
        font: "body",
        size: 40,
        color: "#000000",
        align: "left",
        lineHeight: 1.2,
        letterSpacing: 0,
      },
    ]);
    const lir = lower(deck.slides[0], deck, ctx);
    const prim = lir.primitives[0];
    expect(prim.kind).toBe("text");
    if (prim.kind === "text") {
      expect(prim.runs).toHaveLength(2);
      expect(prim.runs[0].text).toBe("a");
      expect(prim.runs[1].y).toBeGreaterThan(prim.runs[0].y);
    }
  });

  it("ネストグループは座標を相対展開する", () => {
    const inner: MirGroup = {
      type: "group",
      position: { left: pct(50), top: pct(50), width: pct(50), height: pct(50) },
      children: [
        {
          type: "rect",
          position: { left: pct(0), top: pct(0), width: pct(100), height: pct(100) },
          strokeWidth: 0,
          rx: 0,
          fill: "#fff",
        },
      ],
      gap: pct(0),
      align: "stretch",
      justify: "start",
      padding: pct(0),
    };
    const outer: MirGroup = {
      type: "group",
      position: { left: pct(20), top: pct(20), width: pct(60), height: pct(60) },
      children: [inner],
      gap: pct(0),
      align: "stretch",
      justify: "start",
      padding: pct(0),
    };
    const deck = deckWith([outer]);
    const lir = lower(deck.slides[0], deck, ctx);
    // outer: x200..800 (w600). inner: 左上 +50% => x200+300=500, w 300.
    // 子 rect: inner いっぱい => x500,w300
    expect(lir.primitives[0]).toMatchObject({ kind: "rect", x: 500, w: 300 });
  });
});

describe("computeAutoLayout", () => {
  const text = (t: string) => ({
    type: "text" as const,
    text: t,
    font: "body",
    size: 40,
    color: "#000",
    align: "left" as const,
    lineHeight: 1.2,
    letterSpacing: 0,
  });

  it("column は子を縦に gap を挟んで積む", () => {
    const group: MirGroup = {
      type: "group",
      children: [text("一"), text("二")],
      layout: "column",
      gap: pct(10), // inner.h=200 -> 20px gap
      align: "stretch",
      justify: "start",
      padding: pct(0),
    };
    const inner = { x: 0, y: 0, w: 400, h: 200 };
    const placed = computeAutoLayout(group, inner, ctx);
    expect(placed).toHaveLength(2);
    expect(placed[0].box.y).toBe(0);
    // stretch なので幅は inner いっぱい
    expect(placed[0].box.w).toBe(400);
    // 2番目は1番目の高さ + gap(20) ぶん下
    const expectedY = placed[0].box.h + 20;
    expect(placed[1].box.y).toBeCloseTo(expectedY);
  });

  it("justify: center は両端に等しい余白を残す", () => {
    const r = (h: number) => ({
      type: "rect" as const,
      position: { height: pct(h) },
      strokeWidth: 0,
      rx: 0,
    });
    const group: MirGroup = {
      type: "group",
      children: [r(20), r(20)], // inner.h=200 -> 各 40px, 計 80
      layout: "column",
      gap: pct(0),
      align: "stretch",
      justify: "center",
      padding: pct(0),
    };
    const inner = { x: 0, y: 0, w: 100, h: 200 };
    const placed = computeAutoLayout(group, inner, ctx);
    // 余白 (200-80)/2 = 60 が先頭オフセット
    expect(placed[0].box.y).toBeCloseTo(60);
  });

  it("justify: space-between は要素間に余白を分配する", () => {
    const r = () => ({
      type: "rect" as const,
      position: { width: pct(10) }, // inner.w=400 -> 40px
      strokeWidth: 0,
      rx: 0,
    });
    const group: MirGroup = {
      type: "group",
      children: [r(), r(), r()],
      layout: "row",
      gap: pct(0),
      align: "stretch",
      justify: "space-between",
      padding: pct(0),
    };
    const inner = { x: 0, y: 0, w: 400, h: 100 };
    const placed = computeAutoLayout(group, inner, ctx);
    expect(placed[0].box.x).toBeCloseTo(0);
    expect(placed[2].box.x).toBeCloseTo(360); // 末尾は右端
  });

  it("padding は内側ボックスを縮める", () => {
    const group: MirGroup = {
      type: "group",
      position: { left: pct(0), top: pct(0), width: pct(100), height: pct(100) },
      children: [
        {
          type: "rect",
          position: { left: pct(0), top: pct(0), width: pct(100), height: pct(100) },
          strokeWidth: 0,
          rx: 0,
          fill: "#fff",
        },
      ],
      gap: pct(0),
      align: "stretch",
      justify: "start",
      padding: pct(10), // 1000*10% = 100
    };
    const deck = deckWith([group]);
    const lir = lower(deck.slides[0], deck, ctx);
    // 子 rect は inner (100,100,800,800)
    expect(lir.primitives[0]).toMatchObject({ kind: "rect", x: 100, y: 100, w: 800, h: 800 });
  });

  it("flex は main 軸の残余を比率配分する", () => {
    const rect = (flex: number) => ({
      type: "rect" as const,
      flex,
      strokeWidth: 0,
      rx: 0,
    });
    const group: MirGroup = {
      type: "group",
      children: [rect(1), rect(3)],
      layout: "row",
      gap: pct(0),
      align: "stretch",
      justify: "start",
      padding: pct(0),
    };
    const inner = { x: 0, y: 0, w: 400, h: 100 };
    const placed = computeAutoLayout(group, inner, ctx);
    expect(placed[0].box.w).toBeCloseTo(100); // 1/4
    expect(placed[1].box.w).toBeCloseTo(300); // 3/4
  });
});
