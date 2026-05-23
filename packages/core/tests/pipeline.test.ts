import { describe, it, expect } from "vitest";
import { MemoryAssetResolver } from "../src/load/assets";
import { compileDeck, renderSlideSvg } from "../src/pipeline";

function resolverFrom(files: Record<string, string>): MemoryAssetResolver {
  const map = new Map<string, Uint8Array>();
  const enc = new TextEncoder();
  for (const [k, v] of Object.entries(files)) map.set(k, enc.encode(v));
  return new MemoryAssetResolver(map);
}

const theme = `
name: standard
colors: { bg: "#0e0e10", fg: "#f5f5f5", accent: "#7aa2f7" }
slide: { width: 1920, height: 1080 }
background: \${bg}
defaults: { text: { size: 40, color: "\${fg}" } }
schema:
  vars:
    title: { type: string, required: true }
layout:
  - type: text
    position: { left: center, top: 20%, width: 80% }
    align: center
    text: \${title}
`;

const deck = `
bases:
  - { id: standard, file: ./theme.yaml }
slides:
  - id: one
    use: standard
    vars: { title: "こんにちは" }
`;

describe("compileDeck (end-to-end)", () => {
  it("YAML プロジェクトを読み込みレンダリングできる", async () => {
    const resolver = resolverFrom({ "deck.yaml": deck, "theme.yaml": theme });
    const { compiled, errors } = await compileDeck(resolver);
    expect(errors).toHaveLength(0);
    expect(compiled).toBeTruthy();
    expect(compiled!.deck.slide).toEqual({ width: 1920, height: 1080 });

    const svg = renderSlideSvg(compiled!, 0)!;
    expect(svg).toContain("<svg");
    expect(svg).toContain('viewBox="0 0 1920 1080"');
    expect(svg).toContain("こんにちは");
    // 背景 bg -> #0e0e10
    expect(svg).toContain('fill="#0e0e10"');
  });

  it("bases 未指定はエラー", async () => {
    const resolver = resolverFrom({ "deck.yaml": "slides: [{ id: x }]" });
    const { compiled, errors } = await compileDeck(resolver);
    expect(compiled).toBeFalsy();
    expect(errors.length).toBeGreaterThan(0);
  });
});
