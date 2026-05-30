import { describe, it, expect } from "vitest";
import { shapeText } from "../src/lower/text-shaping";
import { ApproximateMetrics } from "../src/lower/metrics";

const m = new ApproximateMetrics();
const shape = (text: string, maxWidth: number, align: "left" | "center" | "right" = "left") =>
  shapeText(text, "body", 40, maxWidth, align, 1.2, 0, m);

describe("shapeText", () => {
  it("a single line when width is enough", () => {
    const r = shape("Hello", 10000);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].text).toBe("Hello");
  });

  it("respects explicit line breaks", () => {
    const r = shape("a\nb\nc", 10000);
    expect(r.lines.map((l) => l.text)).toEqual(["a", "b", "c"]);
  });

  it("English words wrap at space boundaries", () => {
    const r = shape("word word word word word word", 200);
    expect(r.lines.length).toBeGreaterThan(1);
    // no trailing space remains on each line
    for (const l of r.lines) expect(l.text).not.toMatch(/\s$/);
  });

  it("CJK wraps per character", () => {
    const r = shape("あいうえおかきくけこ", 120); // 40px/char -> ~3 chars/line
    expect(r.lines.length).toBeGreaterThan(1);
    expect(r.lines.map((l) => l.text).join("")).toBe("あいうえおかきくけこ");
  });

  it("center alignment centers the line", () => {
    const r = shape("Hi", 1000, "center");
    expect(r.lines[0].x).toBeGreaterThan(0);
  });

  it("height is lineCount x lineHeight x size", () => {
    const r = shape("a\nb", 1000);
    expect(r.height).toBeCloseTo(2 * 40 * 1.2);
  });

  it("the baseline drops by the ascent", () => {
    const r = shape("a", 1000);
    expect(r.lines[0].baseline).toBeCloseTo(40 * 0.8);
  });

  // A line opened by a user-written "\n" (or by start-of-text) keeps its
  // leading whitespace because the indent was typed deliberately. Only
  // wrap-induced lines drop leading space (to avoid prev-line trailing-space
  // bleed). Regression for indented code-style content like "    println!()".
  it("preserves leading whitespace after a hard newline", () => {
    const r = shape("fn main {\n    body\n}", 10000);
    expect(r.lines.map((l) => l.text)).toEqual(["fn main {", "    body", "}"]);
  });

  it("still drops the leading-space bleed on wrap-induced lines", () => {
    // "word " is ~ 4*0.5 + 0.28 = 2.28em wide at size 40 -> ~91px; limit 200
    // fits ~2 words per line. The space between words must not appear at the
    // start of the next wrapped line.
    const r = shape("word word word word", 200);
    expect(r.lines.length).toBeGreaterThan(1);
    for (const l of r.lines) expect(l.text.startsWith(" ")).toBe(false);
  });
});
