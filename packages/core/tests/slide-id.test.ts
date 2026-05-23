import { describe, it, expect } from "vitest";
import { DeckSchema } from "../src/schema";
import { MemoryAssetResolver } from "../src/load/assets";
import { compileDeck } from "../src/pipeline";

const theme = `
name: standard
slide: { width: 100, height: 100 }
defaults: { text: { size: 10 } }
layout: []
`;

function resolver(deckText: string) {
  const enc = new TextEncoder();
  return new MemoryAssetResolver(
    new Map([
      ["deck.yaml", enc.encode(deckText)],
      ["theme.yaml", enc.encode(theme)],
    ]),
  );
}

describe("slide id", () => {
  it("id is optional (can be omitted)", () => {
    const r = DeckSchema.safeParse({
      bases: [{ id: "standard", file: "./theme.yaml" }],
      slides: [{ use: "standard" }, { id: "named" }],
    });
    expect(r.success).toBe(true);
  });

  it("duplicate explicit id is an error (with path)", () => {
    const r = DeckSchema.safeParse({
      bases: [{ id: "standard", file: "./theme.yaml" }],
      slides: [{ id: "dup" }, { id: "dup" }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      // match by path (stable across message translation), pointing at the 2nd id
      const issue = r.error.issues.find(
        (i) => i.path.join(".") === ["slides", 1, "id"].join("."),
      );
      expect(issue).toBeTruthy();
      expect(issue!.path).toEqual(["slides", 1, "id"]);
    }
  });

  it("an index-derived id is assigned when id is omitted", async () => {
    const { compiled, errors } = await compileDeck(
      resolver(
        `bases: [{ id: standard, file: ./theme.yaml }]\nslides: [{}, { id: agenda }]`,
      ),
    );
    expect(errors).toHaveLength(0);
    expect(compiled!.deck.slides[0].id).toBe("slide-1");
    expect(compiled!.deck.slides[1].id).toBe("agenda");
  });

  it("duplicate id is returned as a compile-time error (preview not updated)", async () => {
    const { compiled, errors } = await compileDeck(
      resolver(
        `bases: [{ id: standard, file: ./theme.yaml }]\nslides: [{ id: x }, { id: x }]`,
      ),
    );
    expect(compiled).toBeFalsy();
    expect(errors.length).toBeGreaterThan(0);
  });
});
