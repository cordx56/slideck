import { describe, it, expect } from "vitest";
import {
  MemoryAssetResolver,
  OverrideResolver,
  CachingResolver,
} from "../src/load/assets";
import { recompileDeck } from "../src/pipeline";
import type { MirText } from "../src/ir";

const theme = `
name: standard
slide: { width: 100, height: 100 }
defaults: { text: { size: 10 } }
schema: { vars: { title: { type: string, required: true } } }
layout:
  - { type: text, text: "\${title}" }
`;

function base(deckText: string) {
  const enc = new TextEncoder();
  return new MemoryAssetResolver(
    new Map([
      ["deck.yaml", enc.encode(deckText)],
      ["theme.yaml", enc.encode(theme)],
    ]),
  );
}

describe("OverrideResolver + recompileDeck (live edit)", () => {
  it("replaces disk with in-memory deck text", async () => {
    const mkDeck = (t: string) =>
      `bases: [{ id: standard, file: ./theme.yaml }]\nslides: [{ id: s, use: standard, vars: { title: ${t} } }]`;
    const onDisk = base(mkDeck("disk"));
    const edited = mkDeck("edited");
    const resolver = new OverrideResolver(
      onDisk,
      new Map([["deck.yaml", edited]]),
    );

    const { deck, errors } = await recompileDeck(resolver);
    expect(errors).toHaveLength(0);
    expect((deck!.slides[0].elements[0] as MirText).text).toBe("edited");
  });

  it("returns errors on invalid YAML edits (deck is undefined)", async () => {
    const resolver = new OverrideResolver(
      base("x"),
      new Map([["deck.yaml", "slides: [}"]]),
    );
    const { deck, errors } = await recompileDeck(resolver);
    expect(deck).toBeFalsy();
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("CachingResolver", () => {
  it("reads bytes for the same path once and returns the same reference", async () => {
    let reads = 0;
    const inner: MemoryAssetResolver = new MemoryAssetResolver(
      new Map([["a.bin", new Uint8Array([1, 2, 3])]]),
    );
    const counting = {
      readText: inner.readText.bind(inner),
      readBytes: async (p: string) => {
        reads++;
        return inner.readBytes(p);
      },
      exists: inner.exists.bind(inner),
    };
    const caching = new CachingResolver(counting);
    const a = await caching.readBytes("a.bin");
    const b = await caching.readBytes("a.bin");
    expect(reads).toBe(1);
    expect(a).toBe(b); // same reference (assumes fontkit memoization works)
  });
});
