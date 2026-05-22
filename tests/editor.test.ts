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
  it("メモリ上の deck テキストでディスクを差し替える", async () => {
    const onDisk = base(`theme: ./theme.yaml\nslides: [{ id: s, vars: { title: disk } }]`);
    const edited = `theme: ./theme.yaml\nslides: [{ id: s, vars: { title: edited } }]`;
    const resolver = new OverrideResolver(
      onDisk,
      new Map([["deck.yaml", edited]]),
    );

    const { deck, errors } = await recompileDeck(resolver);
    expect(errors).toHaveLength(0);
    expect((deck!.slides[0].elements[0] as MirText).text).toBe("edited");
  });

  it("無効な YAML 編集ではエラーを返す (deck は undefined)", async () => {
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
  it("同一パスのバイト列を 1 度だけ読み同じ参照を返す", async () => {
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
    expect(a).toBe(b); // 同一参照 (fontkit メモ化が効く前提)
  });
});
