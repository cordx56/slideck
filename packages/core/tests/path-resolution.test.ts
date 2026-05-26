import { describe, it, expect } from "vitest";
import { MemoryAssetResolver } from "../src/load/assets";
import { loadDeck } from "../src/load/resolve-refs";
import { compileDeck } from "../src/pipeline";

// Case where a base in a subfolder references font / image relative to itself.
const deck = `bases:
  - { id: t, always: true, file: ./theme/base.yaml }
slides:
  - id: s
    elements:
      - { type: image, src: ./pics/slide.png }
`;

const base = `colors: { bg: "#000000" }
slide: { width: 100, height: 100 }
fonts:
  body: { path: ./fonts/x.ttf }
layout:
  - { type: image, src: ./logo.png }
`;

function resolver() {
  const enc = new TextEncoder();
  return new MemoryAssetResolver(
    new Map<string, Uint8Array>([
      ["deck.yaml", enc.encode(deck)],
      ["theme/base.yaml", enc.encode(base)],
      ["theme/fonts/x.ttf", new Uint8Array([1, 2, 3])],
      ["theme/logo.png", new Uint8Array([4, 5, 6])],
      ["pics/slide.png", new Uint8Array([7, 8, 9])],
    ]),
  );
}

describe("relative paths resolve against the declaring file", () => {
  it("base font.path / layout image are relative to the base file", async () => {
    const { loaded, errors } = await loadDeck(resolver());
    expect(errors).toHaveLength(0);
    const t = loaded!.basesById.get("t")!;
    // relative to theme/base.yaml -> theme/fonts/x.ttf
    expect(t.fonts!.body.path).toBe("theme/fonts/x.ttf");
    // layout image -> theme/logo.png
    const img = t.layout![0] as { type: "image"; src: string };
    expect(img.src).toBe("theme/logo.png");
  });

  it("slide element images are relative to deck.yaml", async () => {
    const { loaded } = await loadDeck(resolver());
    const slide = loaded!.deck.slides[0];
    const img = slide.elements![0] as { type: "image"; src: string };
    expect(img.src).toBe("pics/slide.png");
  });

  it("compile can load declaration-relative assets (not at root)", async () => {
    const { compiled, errors } = await compileDeck(resolver());
    // can resolve theme/fonts/x.ttf, theme/logo.png, pics/slide.png
    // (root /fonts/x.ttf etc. do not exist, so wrong root resolution errors)
    expect(errors).toHaveLength(0);
    expect(compiled).toBeTruthy();
  });
});
