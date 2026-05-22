import { describe, it, expect } from "vitest";
import { normalize } from "../src/normalize";
import { MemoryAssetResolver } from "../src/load/assets";
import type { LoadedDeck } from "../src/load/resolve-refs";
import type { ThemeHir, DeckHir, MirText } from "../src/ir";

function makeLoaded(theme: ThemeHir, deck: DeckHir): LoadedDeck {
  return {
    deck,
    themes: new Map([[theme.name, theme]]),
    defaultThemeName: theme.name,
    overlays: [],
    resolver: new MemoryAssetResolver(new Map()),
  };
}

const baseTheme: ThemeHir = {
  name: "t",
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

describe("normalize", () => {
  it("変数を展開しデフォルトを適用する", () => {
    const loaded = makeLoaded(baseTheme, {
      theme: "t",
      slides: [{ id: "s1", vars: { title: "Hello" } }],
    });
    const { deck, errors } = normalize(loaded);
    expect(errors).toHaveLength(0);
    const el = deck!.slides[0].elements[0] as MirText;
    expect(el.type).toBe("text");
    expect(el.text).toBe("Hello");
    expect(el.font).toBe("Body"); // font キー -> family
    expect(el.size).toBe(30); // defaults
    expect(el.color).toBe("#ffffff"); // color キー fg -> hex
  });

  it("文字列内の部分展開", () => {
    const theme: ThemeHir = {
      ...baseTheme,
      layout: [{ type: "text", text: "Hi ${title}!" }],
    };
    const loaded = makeLoaded(theme, {
      theme: "t",
      slides: [{ id: "s", vars: { title: "Bob" } }],
    });
    const el = normalize(loaded).deck!.slides[0].elements[0] as MirText;
    expect(el.text).toBe("Hi Bob!");
  });

  it("required 変数の欠落はエラー", () => {
    const loaded = makeLoaded(baseTheme, {
      theme: "t",
      slides: [{ id: "s", vars: {} }],
    });
    const { errors } = normalize(loaded);
    expect(errors.some((e) => e.message.includes("title"))).toBe(true);
  });

  it("未定義変数の参照はエラー", () => {
    const theme: ThemeHir = {
      ...baseTheme,
      layout: [{ type: "text", text: "${nope}" }],
    };
    const loaded = makeLoaded(theme, {
      theme: "t",
      slides: [{ id: "s", vars: { title: "x" } }],
    });
    const { errors } = normalize(loaded);
    expect(errors.some((e) => e.message.includes("nope"))).toBe(true);
  });

  it("color 変数は構造化埋め込みで解決される", () => {
    const theme: ThemeHir = {
      ...baseTheme,
      layout: [{ type: "text", text: "x", color: "${accent}" }],
    };
    const loaded = makeLoaded(theme, {
      theme: "t",
      slides: [{ id: "s", vars: { title: "t", accent: "fg" } }],
    });
    const el = normalize(loaded).deck!.slides[0].elements[0] as MirText;
    expect(el.color).toBe("#ffffff"); // accent=fg -> #ffffff
  });

  it("deck-level vars が slide.vars に上書きされる", () => {
    const theme: ThemeHir = {
      ...baseTheme,
      layout: [{ type: "text", text: "${title}" }],
    };
    const loaded = makeLoaded(theme, {
      theme: "t",
      vars: { title: "deck" },
      slides: [
        { id: "a", vars: {} },
        { id: "b", vars: { title: "slide" } },
      ],
    });
    const { deck } = normalize(loaded);
    expect((deck!.slides[0].elements[0] as MirText).text).toBe("deck");
    expect((deck!.slides[1].elements[0] as MirText).text).toBe("slide");
  });
});
