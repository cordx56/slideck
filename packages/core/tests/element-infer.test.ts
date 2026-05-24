import { describe, it, expect } from "vitest";
import { ElementSchema } from "../src/schema";

// type is injected from distinctive fields during deserialization (preprocess).
const typeOf = (o: unknown): string | undefined => {
  const r = ElementSchema.safeParse(o);
  return r.success ? (r.data as { type: string }).type : undefined;
};

describe("element type inference", () => {
  it("infers type from a characteristic field", () => {
    expect(typeOf({ text: "x" })).toBe("text");
    expect(typeOf({ src: "a.png" })).toBe("image");
    expect(typeOf({ d: "M0 0 L1 1" })).toBe("path");
    expect(typeOf({ from: { x: 0, y: 0 }, to: { x: 1, y: 1 } })).toBe("line");
    expect(typeOf({ children: [{ text: "c" }] })).toBe("group");
    expect(typeOf({ items: [{ text: "li" }] })).toBe("ul");
    expect(typeOf({ items: [{ text: "li" }], start: 2 })).toBe("ol");
    expect(typeOf({ fill: "#fff" })).toBe("rect");
  });

  it("an explicit type always wins", () => {
    // items would infer ul, but the explicit ol is kept.
    expect(typeOf({ type: "ol", items: [{ text: "li" }] })).toBe("ol");
  });

  it("inference is recursive (nested children/items)", () => {
    const r = ElementSchema.safeParse({ children: [{ text: "c" }, { items: [{ text: "li" }] }] });
    expect(r.success).toBe(true);
    if (r.success && r.data.type === "group") {
      expect(r.data.children.map((c) => c.type)).toEqual(["text", "ul"]);
    }
  });

  it("an object with no characteristic field fails validation", () => {
    expect(typeOf({})).toBeUndefined();
  });
});
