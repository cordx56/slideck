import { describe, it, expect } from "vitest";
import { normalize } from "../src/normalize";
import { MemoryAssetResolver } from "../src/load/assets";
import type { LoadedDeck } from "../src/load/resolve-refs";
import type { BaseHir, SlideHir, MirText } from "../src/ir";

interface BaseEntry {
  id: string;
  always?: boolean;
  base: BaseHir;
}

function loaded(
  bases: BaseEntry[],
  slides: SlideHir[],
  deckVars?: Record<string, unknown>,
): LoadedDeck {
  return {
    deck: {
      bases: bases.map((b) => ({ id: b.id, always: b.always, file: `${b.id}.yaml` })),
      vars: deckVars,
      slides,
    },
    basesById: new Map(bases.map((b) => [b.id, b.base])),
    resolver: new MemoryAssetResolver(new Map()),
  };
}

const stdBase: BaseHir = {
  fonts: { body: { path: "x.ttf", family: "Body" } },
  colors: { fg: "#ffffff", accent: "#7aa2f7" },
  slide: { width: 1000, height: 500 },
  defaults: { text: { family: "body", size: 30, color: "fg" } },
  schema: {
    vars: {
      title: { type: "string", required: true },
      accent: { type: "color", default: "#7aa2f7" },
    },
  },
  layout: [{ type: "text", text: "${title}" }],
};

// 単一 base を always で全スライドに適用する簡易ヘルパ。
function single(base: BaseHir, slides: SlideHir[], deckVars?: Record<string, unknown>) {
  return loaded([{ id: "std", always: true, base }], slides, deckVars);
}

describe("normalize", () => {
  it("変数を展開しデフォルトを適用する", () => {
    const { deck, errors } = normalize(
      single(stdBase, [{ id: "s1", vars: { title: "Hello" } }]),
    );
    expect(errors).toHaveLength(0);
    const el = deck!.slides[0].elements[0] as MirText;
    expect(el.type).toBe("text");
    expect(el.text).toBe("Hello");
    expect(el.font).toBe("Body");
    expect(el.size).toBe(30);
    expect(el.color).toBe("#ffffff");
  });

  it("文字列内の部分展開", () => {
    const base: BaseHir = { ...stdBase, layout: [{ type: "text", text: "Hi ${title}!" }] };
    const el = normalize(single(base, [{ id: "s", vars: { title: "Bob" } }])).deck!
      .slides[0].elements[0] as MirText;
    expect(el.text).toBe("Hi Bob!");
  });

  it("required 変数の欠落はエラー", () => {
    const { errors } = normalize(single(stdBase, [{ id: "s", vars: {} }]));
    expect(errors.some((e) => e.message.includes("title"))).toBe(true);
  });

  it("未定義変数の参照はエラー", () => {
    const base: BaseHir = { ...stdBase, layout: [{ type: "text", text: "${nope}" }] };
    const { errors } = normalize(single(base, [{ id: "s", vars: { title: "x" } }]));
    expect(errors.some((e) => e.message.includes("nope"))).toBe(true);
  });

  it("color 変数は構造化埋め込みで解決される", () => {
    const base: BaseHir = {
      ...stdBase,
      layout: [{ type: "text", text: "x", color: "${accent}" }],
    };
    const el = normalize(single(base, [{ id: "s", vars: { title: "t", accent: "fg" } }]))
      .deck!.slides[0].elements[0] as MirText;
    expect(el.color).toBe("#ffffff");
  });

  it("deck-level vars が slide.vars に上書きされる", () => {
    const base: BaseHir = { ...stdBase, layout: [{ type: "text", text: "${title}" }] };
    const { deck } = normalize(
      single(
        base,
        [
          { id: "a", vars: {} },
          { id: "b", vars: { title: "slide" } },
        ],
        { title: "deck" },
      ),
    );
    expect((deck!.slides[0].elements[0] as MirText).text).toBe("deck");
    expect((deck!.slides[1].elements[0] as MirText).text).toBe("slide");
  });
});
