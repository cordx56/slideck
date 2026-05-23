import { describe, it, expect } from "vitest";
import { schemaDocs } from "../src/schema/doc";

// schemaDocs is generated from the zod schemas; these guard the introspection
// against zod-internals changes and schema edits.
describe("schemaDocs (generated from zod)", () => {
  it("field types reference named aliases", () => {
    expect(schemaDocs.fields.elements).toBe("Element[]");
    expect(schemaDocs.fields.children).toBe("Element[]");
    expect(schemaDocs.fields.bases).toBe("BaseRef[]");
    expect(schemaDocs.fields.slides).toBe("Slide[]");
    expect(schemaDocs.fields.position).toBe("Position");
    expect(schemaDocs.fields.from).toBe("Point");
    expect(schemaDocs.fields.fonts).toBe("Record<string, FontDecl>");
    expect(schemaDocs.fields.use).toBe("string | string[]");
  });

  it("merges types of a field that appears in several objects", () => {
    // layout is Element[] in a base and an enum in a group.
    expect(schemaDocs.fields.layout).toContain("Element[]");
    expect(schemaDocs.fields.layout).toContain("'row'");
  });

  it("object aliases expand to their fields", () => {
    expect(schemaDocs.aliases.Position).toContain("left?: string | number");
    expect(schemaDocs.aliases.BaseRef).toContain("id: string");
    expect(schemaDocs.aliases.FontDecl).toContain("family: string");
    expect(schemaDocs.aliases.Slide).toContain("elements?: Element[]");
  });

  it("Element expands to one line per variant", () => {
    const el = schemaDocs.aliases.Element;
    expect(el).toContain("text");
    expect(el).toContain("image");
    expect(el).toContain("group");
    expect(el).toContain("ul");
    expect(el).toContain("common:");
  });
});
