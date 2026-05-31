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

// End-to-end tests for the three patches font-postprocess applies to
// pdf-lib's CFF-source output. Each test embeds a CFF OTF via pdf-lib, runs
// the post-process, and checks one specific patch landed in the saved PDF.
//
// Both patches are only triggered by CFF source fonts, so the suite is
// skipped when no CFF-bearing OTF is available on the test machine.
import { describe as desc2 } from "vitest";
import {
  PDFDocument,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { injectFontCmaps } from "../src/render/pdf/font-postprocess";
import { readFileSync } from "node:fs";

const OTF_PATH = "/usr/share/fonts/truetype/adf/AccanthisADFStdNo3-Italic.otf";
const otfBytes: Uint8Array | undefined = (() => {
  try {
    return new Uint8Array(readFileSync(OTF_PATH));
  } catch {
    return undefined;
  }
})();

async function embedCff(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit as never);
  const font = await pdf.embedFont(otfBytes!, { subset: true });
  pdf.addPage().drawText("Hi", { font });
  return await pdf.save({ useObjectStreams: false });
}

desc2.skipIf(!otfBytes)("font-postprocess", () => {
  // PDF 1.7 Table 117 reserves /CIDToGIDMap for CIDFontType2 (TrueType).
  // pdf-lib writes it on Type 0 (CFF) descendants too -- we delete it for
  // spec compliance.
  it("strips /CIDToGIDMap from CIDFontType0 dicts", async () => {
    const before = new TextDecoder("latin1").decode(await embedCff());
    expect(before).toMatch(/\/Subtype \/CIDFontType0\b/);
    expect(before).toMatch(/\/CIDToGIDMap \/Identity/);

    const patched = await injectFontCmaps(await embedCff());
    const reloaded = await PDFDocument.load(patched);
    const after = new TextDecoder("latin1").decode(
      await reloaded.save({ useObjectStreams: false }),
    );
    // Type 0 dict still there; just the bogus entry is gone.
    expect(after).toMatch(/\/Subtype \/CIDFontType0\b/);
    expect(after).not.toMatch(/\/CIDToGIDMap/);
  });

  // The essential fix. pdf-lib's CFF subsetter (via fontkit's CFFSubset)
  // writes the CFF header's OffSize byte as whatever was in the backing
  // buffer (typically values like 28 or 31). CFF spec section 6 requires
  // 1..4 and macOS Preview / CoreText / FreeType / poppler all reject the
  // font when it's out of range, falling back to a system font and rendering
  // subset CIDs 1..N as the fallback's first N glyphs (the "+,-./0123..."
  // garble). Clamp to 4.
  it("clamps the CFF header OffSize byte into the legal 1..4 range", async () => {
    // Sanity-check pdf-lib still emits the bug; pull the raw CFF stream out
    // of a freshly embedded PDF and verify byte 3 is out of range.
    const pre = await PDFDocument.load(await embedCff());
    let rawOffSize = -1;
    for (const [, obj] of pre.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const d = decodePDFRawStream(obj).decode();
      if (d.length >= 4 && d[0] === 0x01 && d[1] === 0x00) {
        rawOffSize = d[3];
        break;
      }
    }
    expect(rawOffSize).toBeGreaterThan(0);
    expect(rawOffSize < 1 || rawOffSize > 4).toBe(true);

    // After post-process: same raw-CFF stream should have OffSize within
    // 1..4. (When pdf-lib upstreams a fix this test starts being trivially
    // true -- safe to delete it then.)
    const patched = await injectFontCmaps(await embedCff());
    const reloaded = await PDFDocument.load(patched);
    let patchedOffSize = -1;
    for (const [, obj] of reloaded.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const d = decodePDFRawStream(obj).decode();
      if (d.length >= 4 && d[0] === 0x01 && d[1] === 0x00) {
        patchedOffSize = d[3];
        break;
      }
    }
    expect(patchedOffSize).toBeGreaterThanOrEqual(1);
    expect(patchedOffSize).toBeLessThanOrEqual(4);
  });
});
