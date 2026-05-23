import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AssetResolver } from "@slideck/core";
import { normalizePath } from "@slideck/core";
import { compileDeck, renderSlideSvg } from "@slideck/core";

// Resolver that reads public/examples/basic from real disk (Node only, for testing).
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
  it("renders all slides to SVG", async () => {
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

    // intro: title + subtitle + image + footer
    expect(svgs[0]).toContain("The World of YAML Slides");
    expect(svgs[0]).toContain("<image");
    // always:true footer base applies to all slides
    for (const svg of svgs) expect(svg).toContain("slideck — YAML Slides");
    // page number from system variables (${slideNumber}/${slideCount} in footer base)
    expect(svgs[0]).toContain("1 / 5");
    expect(svgs[4]).toContain("5 / 5");
    // slide with the section theme (extends); title fits on one line at size 100
    expect(svgs[2]).toContain("Background and Motivation");
    // closing: light preset (extends overriding only colors) bright background
    expect(svgs[3]).toContain('fill="#f7f7fb"');
    // feature: 3 rects in the row layout + footer line
    expect((svgs[4].match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
