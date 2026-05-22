import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AssetResolver } from "../src/load/assets";
import { normalizePath } from "../src/load/assets";
import { compileDeck, renderSlideSvg } from "../src/pipeline";

// public/examples/basic を実ディスクから読む resolver (Node 専用、テスト用)。
class DiskResolver implements AssetResolver {
  constructor(private root: string) {}
  private p(rel: string) {
    return resolve(this.root, normalizePath(rel));
  }
  async readText(rel: string) {
    return readFile(this.p(rel), "utf8");
  }
  async readBytes(rel: string) {
    return new Uint8Array(await readFile(this.p(rel)));
  }
  async exists(rel: string) {
    try {
      await readFile(this.p(rel));
      return true;
    } catch {
      return false;
    }
  }
}

describe("examples/basic", () => {
  it("全スライドが SVG にレンダリングできる", async () => {
    const resolver = new DiskResolver(
      resolve(__dirname, "../public/examples/basic"),
    );
    const { compiled, errors } = await compileDeck(resolver);
    expect(errors).toHaveLength(0);
    expect(compiled).toBeTruthy();

    const slides = compiled!.deck.slides;
    expect(slides).toHaveLength(5);

    const svgs = slides.map((_, i) => renderSlideSvg(compiled!, i)!);
    for (const svg of svgs) expect(svg.startsWith("<svg")).toBe(true);

    // intro: タイトル + サブタイトル + 画像 + フッタ
    expect(svgs[0]).toContain("YAML スライドの世界");
    expect(svgs[0]).toContain("<image");
    // overlay は全スライドに適用される
    for (const svg of svgs) expect(svg).toContain("Slider — YAML Slides");
    // section テーマ (extends) のスライド
    expect(svgs[2]).toContain("背景と動機");
    // closing: light プリセット (extends で配色のみ上書き) の明るい背景
    expect(svgs[3]).toContain('fill="#f7f7fb"');
    // feature: row レイアウトの矩形が 3 つ + フッタ line
    expect((svgs[4].match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
