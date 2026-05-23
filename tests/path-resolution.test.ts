import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { MemoryAssetResolver } from "../src/load/assets";
import { loadDeck } from "../src/load/resolve-refs";
import { compileDeck } from "../src/pipeline";

// サブフォルダに置いた base が、自分からの相対で font / image を参照するケース。
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
  body: { path: ./fonts/x.ttf, family: Body }
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

describe("相対パスは宣言元ファイル基準で解決される", () => {
  it("base の font.path / layout image は base ファイルからの相対", async () => {
    const { loaded, errors } = await loadDeck(resolver());
    expect(errors).toHaveLength(0);
    const t = loaded!.basesById.get("t")!;
    // theme/base.yaml からの相対 -> theme/fonts/x.ttf
    expect(t.fonts!.body.path).toBe("theme/fonts/x.ttf");
    // layout 画像 -> theme/logo.png
    const img = t.layout![0] as { type: "image"; src: string };
    expect(img.src).toBe("theme/logo.png");
  });

  it("slide elements の画像は deck.yaml からの相対", async () => {
    const { loaded } = await loadDeck(resolver());
    const slide = loaded!.deck.slides[0];
    const img = slide.elements![0] as { type: "image"; src: string };
    expect(img.src).toBe("pics/slide.png");
  });

  it("compile が宣言元相対のアセットを読み込める (root にはない)", async () => {
    const { compiled, errors } = await compileDeck(resolver());
    // theme/fonts/x.ttf や theme/logo.png, pics/slide.png を解決できる
    // (root の /fonts/x.ttf 等は存在しないので、誤って root 解決ならエラーになる)
    expect(errors).toHaveLength(0);
    expect(compiled).toBeTruthy();
  });
});
