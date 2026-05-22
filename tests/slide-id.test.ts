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

describe("スライド id", () => {
  it("id は任意 (省略可)", () => {
    const r = DeckSchema.safeParse({
      theme: "./theme.yaml",
      slides: [{ use: "standard" }, { id: "named" }],
    });
    expect(r.success).toBe(true);
  });

  it("明示 id の重複はエラー (パス付き)", () => {
    const r = DeckSchema.safeParse({
      theme: "./theme.yaml",
      slides: [{ id: "dup" }, { id: "dup" }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.message.includes("重複"));
      expect(issue).toBeTruthy();
      // 2 番目の id を指す
      expect(issue!.path).toEqual(["slides", 1, "id"]);
    }
  });

  it("id 省略時はインデックス由来の id が割り当たる", async () => {
    const { compiled, errors } = await compileDeck(
      resolver(`theme: ./theme.yaml\nslides: [{}, { id: agenda }]`),
    );
    expect(errors).toHaveLength(0);
    expect(compiled!.deck.slides[0].id).toBe("slide-1");
    expect(compiled!.deck.slides[1].id).toBe("agenda");
  });

  it("重複 id はコンパイル時にエラーとして返る (preview は更新されない)", async () => {
    const { compiled, errors } = await compileDeck(
      resolver(`theme: ./theme.yaml\nslides: [{ id: x }, { id: x }]`),
    );
    expect(compiled).toBeFalsy();
    expect(errors.some((e) => e.message.includes("重複"))).toBe(true);
  });
});
