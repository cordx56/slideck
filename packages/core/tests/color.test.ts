import { describe, it, expect } from "vitest";
import { toHex, hexToRgb01, normalizeHex } from "../src/lib/color";

describe("toHex", () => {
  it("normalizes #abc / #aabbcc forms (case-insensitive)", () => {
    expect(toHex("#abc")).toBe("#aabbcc");
    expect(toHex("#AABBcc")).toBe("#aabbcc");
  });

  it("resolves CSS named colors to canonical hex (PDF needs the hex)", () => {
    expect(toHex("red")).toBe("#ff0000");
    expect(toHex("Red")).toBe("#ff0000"); // case-insensitive
    expect(toHex("steelblue")).toBe("#4682b4");
    expect(toHex("rebeccapurple")).toBe("#663399");
  });

  it("returns null for unknown strings (caller falls back)", () => {
    expect(toHex("not-a-color")).toBeNull();
    expect(toHex("#zz")).toBeNull();
  });

  it("normalizeHex stays hex-only (palette resolution path)", () => {
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("#fff")).toBe("#ffffff");
  });
});

describe("hexToRgb01", () => {
  it("parses hex literals", () => {
    expect(hexToRgb01("#ff0000")).toEqual({ r: 1, g: 0, b: 0 });
  });

  it("resolves CSS named colors so PDF text/paths get the right rgb", () => {
    expect(hexToRgb01("red")).toEqual({ r: 1, g: 0, b: 0 });
    const { r, g, b } = hexToRgb01("steelblue"); // #4682b4
    expect(r).toBeCloseTo(70 / 255);
    expect(g).toBeCloseTo(130 / 255);
    expect(b).toBeCloseTo(180 / 255);
  });

  it("unrecognised strings default to black, not crash", () => {
    expect(hexToRgb01("garbage")).toEqual({ r: 0, g: 0, b: 0 });
  });
});
