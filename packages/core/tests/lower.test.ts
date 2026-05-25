import { describe, it, expect } from "vitest";
import { lower } from "../src/lower";
import { computeAutoLayout } from "../src/lower/auto-layout";
import { ApproximateMetrics } from "../src/lower/metrics";
import type { LowerCtx } from "../src/lower/context";
import type { MirDeck, MirGroup, MirList, MirSlide, MirText } from "../src/ir";
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
  it("resolves rect % to absolute px", () => {
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

  it("decomposes text into per-line runs", () => {
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

  it("nested groups expand coordinates relatively", () => {
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
    // outer: x200..800 (w600). inner: top-left +50% => x200+300=500, w 300.
    // child rect: fills inner => x500,w300
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

  it("column stacks children vertically with gaps between", () => {
    const group: MirGroup = {
      type: "group",
      children: [text("one"), text("two")],
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
    // stretch, so width fills inner
    expect(placed[0].box.w).toBe(400);
    // second is below the first by its height + gap(20)
    const expectedY = placed[0].box.h + 20;
    expect(placed[1].box.y).toBeCloseTo(expectedY);
  });

  it("justify: center leaves equal margins on both ends", () => {
    const r = (h: number) => ({
      type: "rect" as const,
      position: { height: pct(h) },
      strokeWidth: 0,
      rx: 0,
    });
    const group: MirGroup = {
      type: "group",
      children: [r(20), r(20)], // inner.h=200 -> 40px each, 80 total
      layout: "column",
      gap: pct(0),
      align: "stretch",
      justify: "center",
      padding: pct(0),
    };
    const inner = { x: 0, y: 0, w: 100, h: 200 };
    const placed = computeAutoLayout(group, inner, ctx);
    // margin (200-80)/2 = 60 is the leading offset
    expect(placed[0].box.y).toBeCloseTo(60);
  });

  it("justify: space-between distributes margin between elements", () => {
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
    expect(placed[2].box.x).toBeCloseTo(360); // last is at the right edge
  });

  it("padding shrinks the inner box", () => {
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
    // child rect is inner (100,100,800,800)
    expect(lir.primitives[0]).toMatchObject({ kind: "rect", x: 100, y: 100, w: 800, h: 800 });
  });

  it("flex distributes the main-axis remainder by ratio", () => {
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

describe("lower lists (ul/ol)", () => {
  const textItem = (t: string): MirText => ({
    type: "text",
    text: t,
    font: "body",
    size: 40,
    color: "#000",
    align: "left",
    lineHeight: 1.2,
    letterSpacing: 0,
  });

  function list(type: "ul" | "ol", start = 1): MirList {
    return {
      type,
      position: { left: pct(0), top: pct(0), width: pct(100), height: pct(100) },
      items: [textItem("A"), textItem("B")],
      gap: pct(0),
      align: "stretch",
      padding: pct(0),
      font: "body",
      size: 40,
      color: "#000",
      start,
    };
  }

  const runTexts = (deck: MirDeck) =>
    lower(deck.slides[0], deck, ctx)
      .primitives.filter((p) => p.kind === "text")
      .map((p) => (p.kind === "text" ? p.runs.map((r) => r.text).join("") : ""));

  it("ol draws number markers and items", () => {
    const texts = runTexts(deckWith([list("ol")]));
    expect(texts).toContain("1.");
    expect(texts).toContain("2.");
    expect(texts).toContain("A");
    expect(texts).toContain("B");
  });

  it("ol start can change the starting number", () => {
    const texts = runTexts(deckWith([list("ol", 3)]));
    expect(texts).toContain("3.");
    expect(texts).toContain("4.");
  });

  it("ul draws circle bullet markers left of each item", () => {
    const d = deckWith([list("ul")]);
    const lir = lower(d.slides[0], d, ctx);
    const circles = lir.primitives.filter((p) => p.kind === "circle");
    expect(circles).toHaveLength(2);
    const itemA = lir.primitives.find((p) => p.kind === "text" && p.runs[0].text === "A");
    if (circles[0].kind === "circle" && itemA?.kind === "text") {
      expect(circles[0].r).toBeGreaterThan(0);
      expect(circles[0].cx).toBeLessThan(itemA.runs[0].x);
    }
  });

  it("markers are placed to the left of the item (within the gutter)", () => {
    const lir = lower(deckWith([list("ol")]).slides[0], deckWith([list("ol")]), ctx);
    const texts = lir.primitives.filter((p) => p.kind === "text");
    const marker = texts.find((p) => p.kind === "text" && p.runs[0].text === "1.");
    const itemA = texts.find((p) => p.kind === "text" && p.runs[0].text === "A");
    if (marker?.kind === "text" && itemA?.kind === "text") {
      expect(marker.runs[0].x).toBeLessThan(itemA.runs[0].x);
    }
  });

  it("a group item is measured so following items do not overlap", () => {
    const group: MirGroup = {
      type: "group",
      position: { left: pct(0), top: pct(0), width: pct(100), height: pct(100) },
      layout: "column",
      gap: pct(0),
      align: "stretch",
      justify: "start",
      padding: pct(0),
      children: [textItem("g1"), textItem("g2")],
    };
    const d = deckWith([{ ...list("ul"), items: [group, textItem("B")] }]);
    const prims = lower(d.slides[0], d, ctx).primitives;
    const yOf = (t: string) => {
      const p = prims.find((p) => p.kind === "text" && p.runs[0].text === t);
      return p?.kind === "text" ? p.runs[0].y : NaN;
    };
    // The group stacks g1 then g2; B must sit below g2 (group height measured).
    expect(yOf("g2")).toBeGreaterThan(yOf("g1"));
    expect(yOf("B")).toBeGreaterThan(yOf("g2"));
  });
});

describe("lower image aspect", () => {
  it("derives height from width via aspect and anchors at the position (not centered)", () => {
    const ictx: LowerCtx = {
      metrics: new ApproximateMetrics(),
      images: new Map([
        ["a.png", { data: new Uint8Array(), mime: "image/png", width: 400, height: 200 }], // 2:1
      ]),
    };
    const deck = deckWith([
      {
        type: "image",
        src: "a.png",
        fit: "contain",
        position: { left: pct(10), top: pct(10), width: pct(40) }, // width only, no height
      },
    ]);
    const img = lower(deck.slides[0], deck, ictx).primitives[0];
    expect(img.kind).toBe("image");
    if (img.kind === "image") {
      expect(img.x).toBe(100); // left 10%
      expect(img.y).toBe(100); // top 10% (anchored, not centered in leftover space)
      expect(img.w).toBe(400); // width 40%
      expect(img.h).toBe(200); // 400 / (400/200) aspect
    }
  });
});
