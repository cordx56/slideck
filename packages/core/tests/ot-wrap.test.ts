import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, decodePDFRawStream, PDFRawStream } from "pdf-lib";
import { parseCff } from "../src/render/pdf/cff-parse";
import { wrapCffInOpenType } from "../src/render/pdf/ot-wrap";
import { injectFontCmaps } from "../src/render/pdf/font-postprocess";
import { extractFontFromTtc } from "../src/load/ttc";
import { readCffName } from "../src/render/pdf/cff-name";

// fontkit typings are coarse for the bits we touch; narrow via cast.
type FK = {
  create: (b: Uint8Array) => {
    constructor: { name: string };
    numGlyphs: number;
    postscriptName: string | null;
  };
};
const fk = fontkit as unknown as FK;

// Pick whichever CFF-bearing font happens to be on the test machine. We
// prefer the JP TTC (closest to the user's Hiragino setup) but fall back to
// a plain CFF OTF for environments without it.
const CFF_FONT_PATH = [
  "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
  "/usr/share/fonts/truetype/adf/AccanthisADFStdNo3-Italic.otf",
].find((p) => existsSync(p));

// Skip if neither is present -- those paths are Linux-distro specific.
describe.skipIf(!CFF_FONT_PATH)("CFF -> OpenType wrap", () => {
  // Load the source font as bytes, extracting from TTC when needed so the
  // downstream code sees an OTF (the same shape it sees after prepare()).
  function loadSource(): Uint8Array {
    const bytes = new Uint8Array(readFileSync(CFF_FONT_PATH!));
    if (CFF_FONT_PATH!.endsWith(".ttc")) return extractFontFromTtc(bytes, 0);
    return bytes;
  }

  // Helper: run a font through pdf-lib's CFF subsetter to get the raw CFF
  // blob we then wrap. Returns just the FontFile3 stream bytes.
  async function makeCffSubset(): Promise<Uint8Array> {
    const src = loadSource();
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit as never);
    const font = await pdf.embedFont(src, { subset: true });
    pdf.addPage().drawText("Hi 日本", { font });
    const saved = await pdf.save({ useObjectStreams: false });
    const doc = await PDFDocument.load(saved);
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const d = decodePDFRawStream(obj).decode();
      if (d[0] === 0x01 && d[1] === 0x00) return d; // raw CFF
    }
    throw new Error("no CFF subset in test PDF");
  }

  it("parseCff reads numGlyphs and a plausible bbox", async () => {
    const cff = await makeCffSubset();
    const info = parseCff(cff);
    expect(info.numGlyphs).toBeGreaterThan(0);
    // FontBBox: xMin < xMax, yMin < yMax. Either real font's bbox is non-trivial.
    expect(info.fontBBox[0]).toBeLessThan(info.fontBBox[2]);
    expect(info.fontBBox[1]).toBeLessThan(info.fontBBox[3]);
  });

  it("wrapCffInOpenType produces an OTTO sfnt fontkit can re-parse", async () => {
    const cff = await makeCffSubset();
    const otf = wrapCffInOpenType(cff);

    // Scaler "OTTO" identifies the file as OpenType with CFF outlines.
    expect(String.fromCharCode(otf[0], otf[1], otf[2], otf[3])).toBe("OTTO");

    // fontkit accepts only well-formed sfnt; loading proves the table
    // directory, checksums, and required-table set all add up.
    const reparsed = fk.create(otf);
    expect(reparsed.constructor.name).toBe("TTFFont");
    expect(reparsed.numGlyphs).toBe(parseCff(cff).numGlyphs);
    // PostScript name should match the CFF Name INDEX entry (we copied it
    // into the synthesised name table).
    const name = readCffName(otf);
    expect(name).toBe(reparsed.postscriptName);
  });

  it("injectFontCmaps rewrites FontFile3 /CIDFontType0C to /OpenType + OTTO bytes", async () => {
    const src = loadSource();
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit as never);
    const font = await pdf.embedFont(src, { subset: true });
    pdf.addPage().drawText("Hi 日本", { font });
    const before = await pdf.save({ useObjectStreams: false });
    const after = await injectFontCmaps(before);

    // Stream subtype: was /CIDFontType0C (raw CFF), now /OpenType (sfnt).
    const reloaded = await PDFDocument.load(after);
    const plain = new TextDecoder("latin1").decode(
      await reloaded.save({ useObjectStreams: false }),
    );
    expect(plain).toMatch(/\/Subtype \/OpenType/);
    expect(plain).not.toMatch(/\/Subtype \/CIDFontType0C/);

    // Descendant CIDFont keeps Type 0 (still CFF-flavoured) and has no
    // /CIDToGIDMap (the earlier post-process step strips it).
    expect(plain).toMatch(/\/Subtype \/CIDFontType0\b/);
    expect(plain).not.toMatch(/\/CIDToGIDMap/);

    // The new FontFile3 stream content is an OTTO sfnt, not raw CFF.
    for (const [, obj] of reloaded.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const d = decodePDFRawStream(obj).decode();
      // The original raw CFF (header 01 00) must no longer appear among the
      // PDF's streams -- it should have been replaced by the OTTO wrapper.
      expect(d[0] === 0x01 && d[1] === 0x00).toBe(false);
    }
  });
});
