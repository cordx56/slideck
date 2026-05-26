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
    expect(slides).toHaveLength(7);

    const svgs = slides.map((_, i) => renderSlideSvg(compiled!, i)!);
    for (const svg of svgs) expect(svg.startsWith("<svg")).toBe(true);

    // multiline slide: |- block scalar -> three separate text lines.
    const multiline = svgs[slides.findIndex((s) => s.id === "multiline")];
    expect(multiline).toContain("Line breaks are written");
    expect(multiline).toContain("Each line is laid out");
    expect(multiline).toContain("inline code");
    expect(multiline).toContain("still work");
    // The YAML key under fonts: IS the CSS family. "code" is auto-detected as
    // the mono face (only fixed-pitch font in fonts:); "body-bold" is declared
    // as the bold face via defaults.text.bold = body-bold. The XML-escaped
    // apostrophe is &apos; in the SVG output.
    expect(multiline).toContain("&apos;code&apos;");
    expect(multiline).toContain("&apos;body-bold&apos;");
    expect(multiline).not.toContain('font-family="monospace"');
    // Family alone encodes the role -- no font-weight/font-style attrs anywhere.
    expect(multiline).not.toContain("font-weight=");
    expect(multiline).not.toContain("font-style=");

    // intro: title + subtitle + image + footer
    expect(svgs[0]).toContain("The World of YAML Slides");
    expect(svgs[0]).toContain("<image");
    // always:true footer base applies to all slides
    for (const svg of svgs) expect(svg).toContain("slideck — YAML Slides");
    const byId = (id: string) => svgs[slides.findIndex((s) => s.id === id)];
    // page number from system variables (${slideNumber}/${slideCount} in footer base)
    expect(svgs[0]).toContain("1 / 7");
    expect(svgs[slides.length - 1]).toContain("7 / 7");
    // slide with the section theme (extends); title fits on one line at size 100
    expect(byId("section-1")).toContain("Background and Motivation");
    // closing: light preset (extends overriding only colors) bright background
    expect(byId("closing")).toContain('fill="#f7f7fb"');
    // feature: 3 rects in the row layout + footer line
    expect((byId("feature").match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
