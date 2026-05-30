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
    // Subset embed: BaseFont must follow PDF 9.6.4's "AAAAAA+PSName" form so
    // macOS Preview's font-name lookup doesn't kick in (see fonts.ts).
    const baseFonts = [...new Set(raw.match(/\/BaseFont\s+\/[^\s>]+/g) ?? [])];
    const customEmbedded = baseFonts.filter(
      (n) => !/\/(Helvetica|Courier|Times|Symbol|ZapfDingbats)/.test(n),
    );
    expect(customEmbedded.length).toBeGreaterThan(0);
    for (const name of customEmbedded) {
      expect(name).toMatch(/^\/BaseFont \/[A-Z]{6}\+[A-Za-z0-9._-]+$/);
    }

    // Every embedded TrueType subset must carry a cmap table -- the
    // post-process injection in font-postprocess.ts is what teaches macOS
    // Preview's sfnt loader the font is valid. We re-walk the saved PDF
    // streams looking for sfnt-headered raw streams and confirm "cmap" is in
    // each one's table directory.
    const { default: pakoModule } = await import("pdf-lib");
    // pdf-lib re-exports utilities we need to decode the FlateDecode streams.
    const { decodePDFRawStream, PDFRawStream } = pakoModule as unknown as {
      decodePDFRawStream: (s: unknown) => { decode: () => Uint8Array };
      PDFRawStream: new (...args: unknown[]) => unknown;
    };
    let subsetsChecked = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      let decoded: Uint8Array;
      try {
        decoded = decodePDFRawStream(obj).decode();
      } catch {
        continue;
      }
      if (decoded.length < 4) continue;
      const isSfnt =
        (decoded[0] === 0x00 && decoded[1] === 0x01 && decoded[2] === 0x00 && decoded[3] === 0x00) ||
        (decoded[0] === 0x74 && decoded[1] === 0x72 && decoded[2] === 0x75 && decoded[3] === 0x65);
      if (!isSfnt) continue;
      const numTables = (decoded[4] << 8) | decoded[5];
      const tags: string[] = [];
      for (let i = 0; i < numTables; i++) {
        const off = 12 + i * 16;
        tags.push(String.fromCharCode(decoded[off], decoded[off + 1], decoded[off + 2], decoded[off + 3]).trim());
      }
      expect(tags).toContain("cmap");
      subsetsChecked++;
    }
    expect(subsetsChecked).toBeGreaterThan(0);
  });
});
