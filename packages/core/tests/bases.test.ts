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

function loaded(bases: BaseEntry[], slides: SlideHir[]): LoadedDeck {
  return {
    deck: {
      bases: bases.map((b) => ({ id: b.id, always: b.always, file: `${b.id}.yaml` })),
      slides,
    },
    basesById: new Map(bases.map((b) => [b.id, b.base])),
    resolver: new MemoryAssetResolver(new Map()),
  };
}

const slideSize = { width: 100, height: 100 };
const texts = (deck: ReturnType<typeof normalize>["deck"], i = 0) =>
  deck!.slides[i].elements.map((e) => (e as MirText).text);

describe("base composition: schema.vars merge", () => {
  it("same name and type merge so both layouts get the value", () => {
    const a: BaseHir = {
      slide: slideSize,
      schema: { vars: { title: { type: "string", required: true } } },
      layout: [{ type: "text", text: "A:${title}" }],
    };
    const b: BaseHir = {
      schema: { vars: { title: { type: "string" } } },
      layout: [{ type: "text", text: "B:${title}" }],
    };
    const { deck, errors } = normalize(
      loaded(
        [
          { id: "a", always: true, base: a },
          { id: "b", base: b },
        ],
        [{ id: "s", use: "b", vars: { title: "X" } }],
      ),
    );
    expect(errors).toHaveLength(0);
    expect(texts(deck)).toEqual(["A:X", "B:X"]);
  });

  it("same name with mismatched type is an error", () => {
    const a: BaseHir = {
      slide: slideSize,
      schema: { vars: { n: { type: "string" } } },
      layout: [],
    };
    const b: BaseHir = { schema: { vars: { n: { type: "number" } } }, layout: [] };
    const { errors } = normalize(
      loaded(
        [
          { id: "a", always: true, base: a },
          { id: "b", base: b },
        ],
        [{ id: "s", use: "b" }],
      ),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("required propagates via OR", () => {
    const a: BaseHir = {
      slide: slideSize,
      schema: { vars: { t: { type: "string" } } }, // optional
      layout: [],
    };
    const b: BaseHir = {
      schema: { vars: { t: { type: "string", required: true } } }, // required
      layout: [],
    };
    const { errors } = normalize(
      loaded(
        [
          { id: "a", always: true, base: a },
          { id: "b", base: b },
        ],
        [{ id: "s", use: "b" }], // t omitted -> required after merge, so error
      ),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("base composition: defaults deep merge", () => {
  it("last wins, unspecified fields are inherited", () => {
    const a: BaseHir = {
      slide: slideSize,
      defaults: { text: { family: "Body", size: 36, color: "#111111" } },
      layout: [],
    };
    const b: BaseHir = {
      defaults: { text: { size: 48 } }, // family/color inherited from a
      layout: [{ type: "text", text: "x" }],
    };
    const { deck } = normalize(
      loaded(
        [
          { id: "a", always: true, base: a },
          { id: "b", base: b },
        ],
        [{ id: "s", use: "b" }],
      ),
    );
    const el = deck!.slides[0].elements[0] as MirText;
    expect(el.size).toBe(48);
    expect(el.font).toBe("Body");
    expect(el.color).toBe("#111111");
  });
});

describe("base composition: z-order", () => {
  it("stacks in order always -> use -> slide.elements", () => {
    const base = (t: string): BaseHir => ({
      slide: slideSize,
      layout: [{ type: "text", text: t }],
    });
    const { deck } = normalize(
      loaded(
        [
          { id: "footer", always: true, base: base("footer") },
          { id: "std", base: base("std") },
        ],
        [{ id: "s", use: "std", elements: [{ type: "text", text: "own" }] }],
      ),
    );
    expect(texts(deck)).toEqual(["footer", "std", "own"]);
  });

  it("a use: array stacks in the given order", () => {
    const base = (t: string): BaseHir => ({ slide: slideSize, layout: [{ type: "text", text: t }] });
    const { deck } = normalize(
      loaded(
        [
          { id: "b1", base: base("1") },
          { id: "b2", base: base("2") },
        ],
        [{ id: "s", use: ["b2", "b1"] }],
      ),
    );
    expect(texts(deck)).toEqual(["2", "1"]);
  });
});

describe("system variables", () => {
  const sysBase: BaseHir = {
    slide: slideSize,
    layout: [{ type: "text", text: "${slideNumber}/${slideCount} ${slideId}" }],
  };

  it("slideNumber/slideCount/slideId are injected", () => {
    const { deck, errors } = normalize(
      loaded([{ id: "b", always: true, base: sysBase }], [{ id: "intro" }, { id: "next" }]),
    );
    expect(errors).toHaveLength(0);
    expect(texts(deck, 0)).toEqual(["1/2 intro"]);
    expect(texts(deck, 1)).toEqual(["2/2 next"]);
  });

  it("slideId becomes the generated id even without an explicit id", () => {
    const { deck } = normalize(loaded([{ id: "b", always: true, base: sysBase }], [{}]));
    expect(texts(deck, 0)).toEqual(["1/1 slide-1"]);
  });

  it("overriding a system variable via slide.vars warns (value takes precedence)", () => {
    const { deck, errors } = normalize(
      loaded([{ id: "b", always: true, base: sysBase }], [{ id: "s", vars: { slideNumber: 99 } }]),
    );
    expect(texts(deck, 0)).toEqual(["99/1 s"]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("declaring a reserved name in schema.vars is an error", () => {
    const base: BaseHir = {
      slide: slideSize,
      schema: { vars: { slideNumber: { type: "number" } } },
      layout: [],
    };
    const { errors } = normalize(loaded([{ id: "b", always: true, base }], [{ id: "s" }]));
    expect(errors.length).toBeGreaterThan(0);
  });
});
