import { describe, it, expect } from "vitest";
import { shapeText } from "../src/lower/text-shaping";
import { ApproximateMetrics } from "../src/lower/metrics";

const m = new ApproximateMetrics();
const shape = (text: string, maxWidth: number, align: "left" | "center" | "right" = "left") =>
  shapeText(text, "body", 40, maxWidth, align, 1.2, 0, m);

describe("shapeText", () => {
  it("十分な幅では 1 行", () => {
    const r = shape("Hello", 10000);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].text).toBe("Hello");
  });

  it("明示改行を尊重する", () => {
    const r = shape("a\nb\nc", 10000);
    expect(r.lines.map((l) => l.text)).toEqual(["a", "b", "c"]);
  });

  it("英単語はスペース境界で折り返す", () => {
    const r = shape("word word word word word word", 200);
    expect(r.lines.length).toBeGreaterThan(1);
    // 各行に行末スペースが残らない
    for (const l of r.lines) expect(l.text).not.toMatch(/\s$/);
  });

  it("CJK は文字単位で折り返す", () => {
    const r = shape("あいうえおかきくけこ", 120); // 40px/字 -> 3字/行程度
    expect(r.lines.length).toBeGreaterThan(1);
    expect(r.lines.map((l) => l.text).join("")).toBe("あいうえおかきくけこ");
  });

  it("center 揃えは行を中央に寄せる", () => {
    const r = shape("Hi", 1000, "center");
    expect(r.lines[0].x).toBeGreaterThan(0);
  });

  it("高さは行数 x lineHeight x size", () => {
    const r = shape("a\nb", 1000);
    expect(r.height).toBeCloseTo(2 * 40 * 1.2);
  });

  it("ベースラインは ascent ぶん下がる", () => {
    const r = shape("a", 1000);
    expect(r.lines[0].baseline).toBeCloseTo(40 * 0.8);
  });
});
