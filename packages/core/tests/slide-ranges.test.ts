import { describe, it, expect } from "vitest";
import { slideRangesOf } from "../src/load/parse";

describe("slideRangesOf", () => {
  // Helper: returns the slice of `text` that the i-th range covers, so a test
  // can assert "this range starts where slide N's dash starts" by checking the
  // first chars instead of pinning down exact offsets (which shift when the
  // doc above moves).
  const slice = (text: string, ranges: Array<[number, number]>, i: number) =>
    text.slice(ranges[i][0], ranges[i][1]);

  it("returns one range per slides: entry", () => {
    const yaml = [
      "bases: []",
      "slides:",
      "  - id: a",
      "    elements: []",
      "  - id: b",
      "    elements: []",
      "  - id: c",
      "    elements: []",
      "",
    ].join("\n");
    const ranges = slideRangesOf(yaml);
    expect(ranges).toHaveLength(3);
    expect(slice(yaml, ranges, 0)).toContain("id: a");
    expect(slice(yaml, ranges, 1)).toContain("id: b");
    expect(slice(yaml, ranges, 2)).toContain("id: c");
  });

  // Ranges must tile [first-slide-start, doc-end] without gaps -- the editor's
  // cursor→slide lookup walks them as a sorted interval list, so a gap would
  // map some valid cursor positions to "no slide".
  it("tiles the document with no gaps between slides", () => {
    const yaml = [
      "bases: []",
      "slides:",
      "  - id: a",
      "",
      "  # a comment between slides",
      "  - id: b",
      "",
    ].join("\n");
    const ranges = slideRangesOf(yaml);
    expect(ranges).toHaveLength(2);
    expect(ranges[0][1]).toBe(ranges[1][0]); // touch, don't overlap
    expect(ranges[1][1]).toBe(yaml.length); // last stretches to EOF
  });

  it("returns [] when the YAML has no slides: key", () => {
    expect(slideRangesOf("bases: []\nfoo: bar\n")).toEqual([]);
  });

  it("returns [] for unparseable YAML", () => {
    expect(slideRangesOf("slides: [\n  not closed\n")).toEqual([]);
  });

  it("returns [] when slides: isn't a sequence", () => {
    expect(slideRangesOf("slides: not-an-array\n")).toEqual([]);
  });
});
