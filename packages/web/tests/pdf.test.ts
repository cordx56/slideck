import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import type { AssetResolver } from "@slideck/core";
import { normalizePath } from "@slideck/core";
import { compileDeck } from "@slideck/core";
import { renderPdf } from "@slideck/core/pdf";

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
    return readFile(this.p(rel)).then(
      () => true,
      () => false,
    );
  }
}

describe("renderPdf", () => {
  it("generates a PDF with real fonts subset-embedded", async () => {
    const resolver = new DiskResolver(
      resolve(__dirname, "../public/examples/basic"),
    );
    const { compiled, errors } = await compileDeck(resolver);
    expect(errors).toHaveLength(0);

    const { bytes, errors: pdfErrors } = await renderPdf(compiled!);
    expect(pdfErrors).toHaveLength(0);

    // A valid PDF with one page per slide.
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(9);
    expect(doc.getPage(0).getWidth()).toBe(1920);
    expect(doc.getPage(0).getHeight()).toBe(1080);

    // Verify that a TrueType font is embedded (FontFile2).
    // The default save compresses into object streams, so re-save expanded for inspection.
    const inspectable = await doc.save({ useObjectStreams: false });
    const raw = new TextDecoder("latin1").decode(inspectable);
    expect(raw).toContain("FontFile2");
    expect(raw).toContain("Type0"); // composite font for CJK

    // Every embedded subset BaseFont must follow PDF 9.6.4:
    // "AAAAAA+OriginalName" (six uppercase letters + "+" tag). Without the
    // tag, macOS Preview renders garbled ASCII even when the font program is
    // present (other viewers tolerate it).
    // We full-embed (subset: false) so macOS Preview gets a complete font with
    // cmap/name/post/OS-2 tables. The BaseFont is the bare PostScript name --
    // no "+" subset tag, since the font isn't a subset.
    const baseFonts = [...new Set(raw.match(/\/BaseFont\s+\/[^\s>]+/g) ?? [])];
    const customEmbedded = baseFonts.filter(
      (n) => !/\/(Helvetica|Courier|Times|Symbol|ZapfDingbats)/.test(n),
    );
    expect(customEmbedded.length).toBeGreaterThan(0);
    for (const name of customEmbedded) {
      // PSName: letters/digits and a few punctuation chars; no "+" tag.
      expect(name).toMatch(/^\/BaseFont \/[A-Za-z0-9._-]+$/);
      expect(name).not.toMatch(/\+/);
    }
  });
});
