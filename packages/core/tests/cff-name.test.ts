import { describe, it, expect } from "vitest";
import { readCffName } from "../src/render/pdf/cff-name";

describe("readCffName", () => {
  // Build a minimal raw-CFF blob whose Name INDEX has one entry. CFF Name
  // INDEX format: count u16, offSize u8, offsets[count+1] (each `offSize`
  // bytes, 1-based), then the concatenated name bytes. We don't include any
  // of the other CFF sub-tables -- readCffName only needs the header + Name
  // INDEX, so anything after that is ignored.
  function rawCff(name: string): Uint8Array {
    const nameBytes = new TextEncoder().encode(name);
    const total = 4 /*hdr*/ + 2 + 1 + 2 + nameBytes.length;
    const out = new Uint8Array(total);
    // CFF header
    out[0] = 1; // major
    out[1] = 0; // minor
    out[2] = 4; // header size (we set p=4 after this)
    out[3] = 1; // offSize (irrelevant past header but well-formed)
    // Name INDEX
    let p = 4;
    out[p++] = 0;
    out[p++] = 1; // count = 1
    out[p++] = 1; // offSize = 1
    out[p++] = 1; // offsets[0] = 1 (1-based start)
    out[p++] = 1 + nameBytes.length; // offsets[1] = past the last byte
    out.set(nameBytes, p);
    return out;
  }

  it("reads the first entry of a raw CFF Name INDEX", () => {
    expect(readCffName(rawCff("HiraKakuStdN-W7"))).toBe("HiraKakuStdN-W7");
  });

  it("reads the CFF Name inside an OTTO sfnt wrapper", () => {
    // Build a minimal OTTO sfnt with one table whose tag is "CFF " and whose
    // bytes are a valid raw-CFF blob. Other sfnt tables aren't referenced by
    // the reader so we only need this one.
    const cff = rawCff("HiraKakuProN-W2");
    const numTables = 1;
    const headerSize = 12 + numTables * 16;
    const dataOff = (headerSize + 3) & ~3;
    const total = dataOff + cff.length;
    const otto = new Uint8Array(total);
    // sfnt scaler "OTTO"
    otto.set([0x4f, 0x54, 0x54, 0x4f], 0);
    const dv = new DataView(otto.buffer);
    dv.setUint16(4, numTables);
    // Table record: tag "CFF " (note trailing space), checksum 0, offset, length
    const recOff = 12;
    otto.set([0x43, 0x46, 0x46, 0x20], recOff); // "CFF "
    dv.setUint32(recOff + 4, 0); // checksum (ignored by reader)
    dv.setUint32(recOff + 8, dataOff);
    dv.setUint32(recOff + 12, cff.length);
    otto.set(cff, dataOff);
    expect(readCffName(otto)).toBe("HiraKakuProN-W2");
  });

  it("returns undefined for a TrueType outline font (no CFF table)", () => {
    // Bare sfnt header with scaler 0x00010000 (TrueType). Reader sees the
    // header but neither "OTTO" nor "ttcf" matches and bails out.
    const ttf = new Uint8Array(12);
    ttf.set([0x00, 0x01, 0x00, 0x00], 0);
    expect(readCffName(ttf)).toBeUndefined();
  });

  it("returns undefined for unrecognised input", () => {
    expect(readCffName(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).toBeUndefined();
    expect(readCffName(new Uint8Array(2))).toBeUndefined();
  });
});

// Separate describe for the CIDFontType0 CIDToGIDMap strip in font-postprocess.
// pdf-lib unconditionally writes /CIDToGIDMap /Identity on every descendant
// CIDFont it embeds, but PDF 1.7 Table 117 says the entry is for CIDFontType2
// only. macOS Preview rejects CIDFontType0 (CFF) dicts that carry it and
// falls back to a system font, producing the garbled output the user saw.
import { describe as desc2 } from "vitest";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { injectFontCmaps } from "../src/render/pdf/font-postprocess";
import { readFileSync } from "node:fs";

const OTF_PATH = "/usr/share/fonts/truetype/adf/AccanthisADFStdNo3-Italic.otf";

// Only run when the system happens to have a CFF-bearing OTF available;
// rebuilding one from scratch would mean writing a full CFF encoder.
const otfBytes: Uint8Array | undefined = (() => {
  try {
    return new Uint8Array(readFileSync(OTF_PATH));
  } catch {
    return undefined;
  }
})();

desc2.skipIf(!otfBytes)("injectFontCmaps: CIDFontType0 CIDToGIDMap strip", () => {
  it("removes /CIDToGIDMap when /Subtype is /CIDFontType0", async () => {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit as never);
    const font = await pdf.embedFont(otfBytes!, { subset: true });
    const page = pdf.addPage();
    page.drawText("Hi", { font });
    const beforeBytes = await pdf.save({ useObjectStreams: false });

    // Sanity: pdf-lib wrote the bogus CIDToGIDMap. (Use a substring check
    // instead of a balanced-dict regex -- the dict has a nested <<...>> for
    // CIDSystemInfo, which JS regex can't bracket.)
    const before = new TextDecoder("latin1").decode(beforeBytes);
    expect(before).toMatch(/\/Subtype \/CIDFontType0\b/);
    expect(before).toMatch(/\/CIDToGIDMap \/Identity/);

    // After post-processing the entry is gone but the CIDFontType0 dict
    // itself is still there (we only deleted that one key).
    const patched = await injectFontCmaps(beforeBytes);
    const reloaded = await PDFDocument.load(patched);
    const after = new TextDecoder("latin1").decode(
      await reloaded.save({ useObjectStreams: false }),
    );
    expect(after).toMatch(/\/Subtype \/CIDFontType0\b/);
    expect(after).not.toMatch(/\/CIDToGIDMap/);
  });
});
