import { describe, it, expect } from "vitest";
import {
  parseDeck,
  serialize,
  listSlideElements,
  getField,
  setField,
  addElement,
  removeElement,
} from "../src/edit/ast";

const deck = `# project deck
theme: ./theme.yaml
slides:
  - id: intro
    elements:
      - type: text # title
        text: Hello
        size: 40
`;

describe("AST editing (inspector write-back)", () => {
  it("field updates preserve comments and formatting", () => {
    const doc = parseDeck(deck);
    setField(doc, ["slides", 0, "elements", 0], ["size"], "72");
    const out = serialize(doc);
    expect(out).toContain("# project deck");
    expect(out).toContain("# title");
    expect(out).toContain("size: 72");
    expect(out).not.toContain("size: 40");
  });

  it("numbers and booleans convert to the right type", () => {
    const doc = parseDeck(deck);
    setField(doc, ["slides", 0, "elements", 0], ["size"], "50");
    // verify it is a number after JSON conversion
    const v = doc.getIn(["slides", 0, "elements", 0, "size"]);
    expect(v).toBe(50);
    expect(typeof v).toBe("number");
  });

  it("empty string deletes the field", () => {
    const doc = parseDeck(deck);
    setField(doc, ["slides", 0, "elements", 0], ["size"], "");
    expect(doc.getIn(["slides", 0, "elements", 0, "size"])).toBeUndefined();
  });

  it("sets a nested position field", () => {
    const doc = parseDeck(deck);
    setField(doc, ["slides", 0, "elements", 0], ["position", "left"], "10%");
    expect(getField(doc, ["slides", 0, "elements", 0], ["position", "left"])).toBe(
      "10%",
    );
  });

  it("can add, list, and remove elements", () => {
    const doc = parseDeck(deck);
    const idx = addElement(doc, 0, "rect");
    expect(idx).toBe(1);
    let els = listSlideElements(doc, 0);
    expect(els).toHaveLength(2);
    expect(els[1].type).toBe("rect");

    removeElement(doc, ["slides", 0, "elements", 1]);
    els = listSlideElements(doc, 0);
    expect(els).toHaveLength(1);
  });

  it("can add to a slide that has no elements", () => {
    const doc = parseDeck(`theme: ./t.yaml\nslides:\n  - id: blank\n`);
    addElement(doc, 0, "text");
    expect(listSlideElements(doc, 0)).toHaveLength(1);
  });
});
