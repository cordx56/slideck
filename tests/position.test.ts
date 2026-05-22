import { describe, it, expect } from "vitest";
import { resolveAxis, resolveBox } from "../src/lower/position";
import type { Dimension } from "../src/schema/position";

const pct = (v: number): Dimension => ({ kind: "percent", value: v });
const px = (v: number): Dimension => ({ kind: "px", value: v });
const center: Dimension = { kind: "center" };

describe("resolveAxis", () => {
  it("left + width", () => {
    expect(resolveAxis(pct(10), undefined, pct(80), 0, 1000)).toEqual({
      pos: 100,
      size: 800,
    });
  });

  it("right + width は右端から逆算", () => {
    expect(resolveAxis(undefined, pct(10), pct(80), 0, 1000)).toEqual({
      pos: 100,
      size: 800,
    });
  });

  it("left + right はサイズが決まる", () => {
    expect(resolveAxis(pct(10), pct(10), undefined, 0, 1000)).toEqual({
      pos: 100,
      size: 800,
    });
  });

  it("center + width は中央寄せ", () => {
    expect(resolveAxis(center, undefined, pct(60), 0, 1000)).toEqual({
      pos: 200,
      size: 600,
    });
  });

  it("親原点オフセットを加味する", () => {
    expect(resolveAxis(pct(10), undefined, pct(50), 500, 1000)).toEqual({
      pos: 600,
      size: 500,
    });
  });

  it("サイズ不足時は intrinsic を使う", () => {
    expect(resolveAxis(undefined, undefined, undefined, 0, 1000, 120)).toEqual({
      pos: 0,
      size: 120,
    });
  });

  it("center + intrinsic", () => {
    expect(resolveAxis(center, undefined, undefined, 0, 1000, 100)).toEqual({
      pos: 450,
      size: 100,
    });
  });

  it("px 単位は親比率に依存しない", () => {
    expect(resolveAxis(px(50), undefined, px(200), 0, 1000)).toEqual({
      pos: 50,
      size: 200,
    });
  });
});

describe("resolveBox", () => {
  it("矩形の四辺指定", () => {
    const parent = { x: 0, y: 0, w: 1000, h: 1000 };
    const box = resolveBox(
      { left: pct(10), right: pct(10), top: pct(20), bottom: pct(20) },
      parent,
    );
    expect(box).toEqual({ x: 100, y: 200, w: 800, h: 600 });
  });

  it("position 未指定は親いっぱい", () => {
    const parent = { x: 10, y: 20, w: 300, h: 400 };
    expect(resolveBox(undefined, parent)).toEqual(parent);
  });
});
