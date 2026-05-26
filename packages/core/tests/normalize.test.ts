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
  fonts: { body: { path: "x.ttf" } },
  // colors are injected as variables.
  colors: { fg: "#ffffff", accent: "#7aa2f7" },
  slide: { width: 1000, height: 500 },
  defaults: { text: { family: "body", size: 30, color: "${fg}" } },
  schema: {
    vars: {
      title: { type: "string", required: true },
    },
  },
  layout: [{ type: "text", text: "${title}" }],
};

// Simple helper applying a single base to all slides via always.
function single(base: BaseHir, slides: SlideHir[], deckVars?: Record<string, unknown>) {
  return loaded([{ id: "std", always: true, base }], slides, deckVars);
}

describe("normalize", () => {
  it("expands variables and applies defaults", () => {
    const { deck, errors } = normalize(
      single(stdBase, [{ id: "s1", vars: { title: "Hello" } }]),
    );
    expect(errors).toHaveLength(0);
    const el = deck!.slides[0].elements[0] as MirText;
    expect(el.type).toBe("text");
    expect(el.text).toBe("Hello");
    expect(el.font).toBe("body");
    expect(el.size).toBe(30);
    expect(el.color).toBe("#ffffff");
  });

  it("partial expansion within a string", () => {
    const base: BaseHir = { ...stdBase, layout: [{ type: "text", text: "Hi ${title}!" }] };
    const el = normalize(single(base, [{ id: "s", vars: { title: "Bob" } }])).deck!
      .slides[0].elements[0] as MirText;
    expect(el.text).toBe("Hi Bob!");
  });

  it("missing required variable is an error", () => {
    const { errors } = normalize(single(stdBase, [{ id: "s", vars: {} }]));
    expect(errors.some((e) => e.message.includes("title"))).toBe(true);
  });

  it("referencing an undefined variable is an error", () => {
    const base: BaseHir = { ...stdBase, layout: [{ type: "text", text: "${nope}" }] };
    const { errors } = normalize(single(base, [{ id: "s", vars: { title: "x" } }]));
    expect(errors.some((e) => e.message.includes("nope"))).toBe(true);
  });

  it("colors can be referenced as variables (${name})", () => {
    const base: BaseHir = {
      ...stdBase,
      layout: [{ type: "text", text: "x", color: "${fg}" }],
    };
    const el = normalize(single(base, [{ id: "s", vars: { title: "t" } }]))
      .deck!.slides[0].elements[0] as MirText;
    expect(el.color).toBe("#ffffff"); // colors.fg is injected
  });

  it("the color field also accepts a literal string", () => {
    const base: BaseHir = {
      ...stdBase,
      layout: [{ type: "text", text: "x", color: "#ff0000" }],
    };
    const el = normalize(single(base, [{ id: "s", vars: { title: "t" } }]))
      .deck!.slides[0].elements[0] as MirText;
    expect(el.color).toBe("#ff0000");
  });

  it("color variables can be overridden via slide.vars", () => {
    const base: BaseHir = {
      ...stdBase,
      layout: [{ type: "text", text: "x", color: "${accent}" }],
    };
    const el = normalize(
      single(base, [{ id: "s", vars: { title: "t", accent: "#00ff00" } }]),
    ).deck!.slides[0].elements[0] as MirText;
    expect(el.color).toBe("#00ff00");
  });

  it("defaults.link / defaults.mono resolve into MirText.rich", () => {
    const base: BaseHir = {
      ...stdBase,
      colors: { fg: "#ffffff", accent: "#7aa2f7", muted: "#999999" },
      defaults: {
        text: { family: "body", size: 30, color: "${fg}" },
        link: { color: "${accent}", underline: false },
        mono: { color: "${muted}" },
      },
      layout: [{ type: "text", text: "${title}" }],
    };
    const el = normalize(single(base, [{ id: "s", vars: { title: "x" } }]))
      .deck!.slides[0].elements[0] as MirText;
    expect(el.rich).toEqual({
      linkColor: "#7aa2f7",
      linkUnderline: false,
      monoFamily: "", // no mono / bold / italic faces declared -> roles fall
      monoColor: "#999999", // through to the surrounding text font in rich-shaping
      boldFamily: "",
      italicFamily: "",
      boldItalicFamily: "",
    });
  });

  it("a list size becomes the default text size of its items", () => {
    const base: BaseHir = {
      ...stdBase,
      layout: [
        {
          type: "ul",
          size: 50,
          items: [
            { type: "text", text: "a" }, // inherits the list size (50)
            { type: "text", text: "b", size: 12 }, // explicit size wins
          ],
        },
      ],
    };
    const list = normalize(single(base, [{ id: "s", vars: { title: "t" } }])).deck!.slides[0]
      .elements[0];
    expect(list.type === "ul" && list.size).toBe(50);
    if (list.type === "ul") {
      expect((list.items[0] as MirText).size).toBe(50);
      expect((list.items[1] as MirText).size).toBe(12);
    }
  });

  it("without a list size, items fall back to the global default size", () => {
    const base: BaseHir = {
      ...stdBase,
      layout: [{ type: "ul", items: [{ type: "text", text: "a" }] }],
    };
    const list = normalize(single(base, [{ id: "s", vars: { title: "t" } }])).deck!.slides[0]
      .elements[0];
    if (list.type === "ul") expect((list.items[0] as MirText).size).toBe(30); // defaults.text.size
  });

  it("deck-level vars are overridden by slide.vars", () => {
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
