import { describe, it, expect } from "vitest";
import { parseInlineDirectives, hasInlineDirective } from "../src/lib/inline-directives";
import { parseRich } from "../src/lib/richtext";

describe("parseInlineDirectives", () => {
  it("splits a directive from surrounding text", () => {
    expect(parseInlineDirectives("hello ?[world](color=red) end")).toEqual([
      { directive: false, value: "hello " },
      { directive: true, content: "world", attrs: { color: "red" } },
      { directive: false, value: " end" },
    ]);
  });

  it("parses multiple comma-separated attributes (unknown keys are kept)", () => {
    const r = parseInlineDirectives("?[x](color=#ff0, bg=#222)");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ directive: true, attrs: { color: "#ff0", bg: "#222" } });
  });

  it("tracks bracket depth so nested directives close correctly", () => {
    const r = parseInlineDirectives("?[a ?[b](color=blue) c](color=red)");
    // Top-level scan yields the OUTER directive only; the inner one is part of
    // the outer's content (parseRich re-parses content recursively).
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      directive: true,
      content: "a ?[b](color=blue) c",
      attrs: { color: "red" },
    });
  });

  it("falls through to plain text when the syntax is malformed", () => {
    // unclosed: emitted as one plain chunk
    expect(parseInlineDirectives("?[unclosed")).toEqual([
      { directive: false, value: "?" },
      { directive: false, value: "[unclosed" },
    ]);
    // closing ] without "(": '?' goes plain, '[..]' stays as a markdown link
    expect(parseInlineDirectives("?[x] y")).toEqual([
      { directive: false, value: "?" },
      { directive: false, value: "[x] y" },
    ]);
  });

  it("unescapes \\] / \\) / \\\\ in content and attribute values", () => {
    const r = parseInlineDirectives("?[a\\]b](color=red\\,still)");
    expect(r[0]).toMatchObject({
      directive: true,
      content: "a]b",
      attrs: { color: "red,still" },
    });
  });

  it("hasInlineDirective is cheap and conservative", () => {
    expect(hasInlineDirective("nothing here")).toBe(false);
    expect(hasInlineDirective("contains ?[ somewhere")).toBe(true);
  });
});

describe("parseRich with directives", () => {
  it("propagates the color attr to every emitted text segment", () => {
    const segs = parseRich("plain ?[hot **bold**](color=red) end");
    const reds = segs.filter((s) => s.kind === "text" && s.color === "red");
    // "hot ", "bold" both inside the directive get color=red; markdown still
    // applies, so the "bold" segment is also bold.
    expect(reds.map((s) => s.kind === "text" && s.text)).toEqual(
      expect.arrayContaining(["hot ", "bold"]),
    );
    const boldRed = segs.find((s) => s.kind === "text" && s.text === "bold");
    expect(boldRed && boldRed.kind === "text" && boldRed.bold).toBe(true);
    expect(boldRed && boldRed.kind === "text" && boldRed.color).toBe("red");
    // text outside the directive has no color
    const plain = segs.find((s) => s.kind === "text" && s.text === "plain ");
    expect(plain && plain.kind === "text" && plain.color).toBeUndefined();
  });

  it("nests directives -- inner attrs override outer", () => {
    const segs = parseRich("?[outer ?[inner](color=blue) end](color=red)");
    const inner = segs.find((s) => s.kind === "text" && s.text === "inner");
    const outer = segs.find((s) => s.kind === "text" && s.text === "outer ");
    expect(inner && inner.kind === "text" && inner.color).toBe("blue");
    expect(outer && outer.kind === "text" && outer.color).toBe("red");
  });
});
