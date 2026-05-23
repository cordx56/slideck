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

describe("base 合成: schema.vars マージ", () => {
  it("同名・同型はマージされ両方の layout に値が入る", () => {
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

  it("同名・型不一致はエラー", () => {
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
    expect(errors.some((e) => e.message.includes("競合"))).toBe(true);
  });

  it("required は OR で伝播する", () => {
    const a: BaseHir = {
      slide: slideSize,
      schema: { vars: { t: { type: "string" } } }, // 任意
      layout: [],
    };
    const b: BaseHir = {
      schema: { vars: { t: { type: "string", required: true } } }, // 必須
      layout: [],
    };
    const { errors } = normalize(
      loaded(
        [
          { id: "a", always: true, base: a },
          { id: "b", base: b },
        ],
        [{ id: "s", use: "b" }], // t 未指定 -> マージ後 required なのでエラー
      ),
    );
    expect(errors.some((e) => e.message.includes("必須"))).toBe(true);
  });
});

describe("base 合成: defaults 深いマージ", () => {
  it("後勝ち、未指定フィールドは継承", () => {
    const a: BaseHir = {
      slide: slideSize,
      defaults: { text: { family: "Body", size: 36, color: "#111111" } },
      layout: [],
    };
    const b: BaseHir = {
      defaults: { text: { size: 48 } }, // family/color は a から継承
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

describe("base 合成: z-order", () => {
  it("always -> use -> slide.elements の順に積む", () => {
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

  it("use: 配列は指定順に積む", () => {
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

describe("システム変数", () => {
  const sysBase: BaseHir = {
    slide: slideSize,
    layout: [{ type: "text", text: "${slideNumber}/${slideCount} ${slideId}" }],
  };

  it("slideNumber/slideCount/slideId が注入される", () => {
    const { deck, errors } = normalize(
      loaded([{ id: "b", always: true, base: sysBase }], [{ id: "intro" }, { id: "next" }]),
    );
    expect(errors).toHaveLength(0);
    expect(texts(deck, 0)).toEqual(["1/2 intro"]);
    expect(texts(deck, 1)).toEqual(["2/2 next"]);
  });

  it("id 未指定でも slideId は生成 id になる", () => {
    const { deck } = normalize(loaded([{ id: "b", always: true, base: sysBase }], [{}]));
    expect(texts(deck, 0)).toEqual(["1/1 slide-1"]);
  });

  it("slide.vars でシステム変数を上書きすると警告 (値は優先)", () => {
    const { deck, errors } = normalize(
      loaded([{ id: "b", always: true, base: sysBase }], [{ id: "s", vars: { slideNumber: 99 } }]),
    );
    expect(texts(deck, 0)).toEqual(["99/1 s"]);
    expect(errors.some((e) => e.message.includes("システム変数"))).toBe(true);
  });

  it("schema.vars で予約名を宣言するとエラー", () => {
    const base: BaseHir = {
      slide: slideSize,
      schema: { vars: { slideNumber: { type: "number" } } },
      layout: [],
    };
    const { errors } = normalize(loaded([{ id: "b", always: true, base }], [{ id: "s" }]));
    expect(errors.some((e) => e.message.includes("システム変数"))).toBe(true);
  });
});
