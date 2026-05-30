import { describe, it, expect } from "vitest";
import type { AssetResolver } from "../src/load/assets";
import { compileDeck } from "../src/pipeline";
import { renderPdf } from "../src/render/pdf";

// A tiny SVG used as the embedded image. The exact content is not important to
// the rasterizer stub below -- we just need the deck-side bytes to flow through
// the pipeline and reach drawPrimitive's image case.
const TINY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>';

// Minimal 1x1 transparent PNG: the rasterizer stub returns this so pdf-lib has
// real raster bytes to embed. Built once and reused.
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

// In-memory resolver with two files: a deck.yaml that references an SVG image,
// plus the SVG itself. Anything else is reported as missing.
class MemResolver implements AssetResolver {
  constructor(private files: Record<string, string | Uint8Array>) {}
  async readText(path: string) {
    const v = this.files[path];
    if (typeof v !== "string") throw new Error(`missing: ${path}`);
    return v;
  }
  async readBytes(path: string) {
    const v = this.files[path];
    if (!v) throw new Error(`missing: ${path}`);
    return typeof v === "string" ? new TextEncoder().encode(v) : v;
  }
  async exists(path: string) {
    return this.files[path] !== undefined;
  }
}

const BASE_YAML = `
slide: { width: 1920, height: 1080 }
`;

const DECK_YAML = `
bases:
  - id: base
    file: ./base.yaml
slides:
  - id: only
    elements:
      - type: image
        src: ./icon.svg
        position: { left: 10%, top: 10%, width: 20% }
`;

describe("renderPdf SVG raster", () => {
  // The default browser rasterizer returns null in Node (no canvas), so the SVG
  // is skipped with a clear error explaining what happened. Confirms the
  // diagnostic path so users know they need to supply a rasterizer in Node.
  it("reports a clear error when no rasterizer is available", async () => {
    const resolver = new MemResolver({
      "deck.yaml": DECK_YAML,
      "base.yaml": BASE_YAML,
      "icon.svg": TINY_SVG,
    });
    const { compiled, errors } = await compileDeck(resolver);
    if (errors.length > 0) console.error(errors);
    expect(errors).toHaveLength(0);

    const { errors: pdfErrors } = await renderPdf(compiled!);
    expect(pdfErrors).toHaveLength(1);
    expect(pdfErrors[0].message).toMatch(/SVG rasterization unavailable/);
  });

  // When a rasterizer is supplied, its PNG bytes are embedded and the PDF
  // produced contains an image XObject. Stub rasterizer receives the display
  // size so it can decide on raster resolution.
  it("embeds SVG when a rasterizer is supplied", async () => {
    const resolver = new MemResolver({
      "deck.yaml": DECK_YAML,
      "base.yaml": BASE_YAML,
      "icon.svg": TINY_SVG,
    });
    const { compiled } = await compileDeck(resolver);

    let calledWith: { w: number; h: number } | undefined;
    const { bytes, errors } = await renderPdf(compiled!, {
      rasterizeSvg: async (_data, w, h) => {
        calledWith = { w, h };
        return TINY_PNG;
      },
    });

    expect(errors).toHaveLength(0);
    // Display size: 20% of 1920 = 384 wide. Height follows whatever box the
    // image is resolved to; we just check the rasterizer got non-zero values.
    expect(calledWith).toBeDefined();
    expect(calledWith!.w).toBeGreaterThan(0);
    expect(calledWith!.h).toBeGreaterThan(0);

    // PDF should contain an embedded image (XObject of Subtype /Image).
    const raw = new TextDecoder("latin1").decode(bytes);
    expect(raw).toContain("/Subtype /Image");
  });
});
