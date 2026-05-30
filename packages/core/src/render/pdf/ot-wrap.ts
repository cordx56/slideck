// Wrap a raw CFF blob in a minimal OpenType (OTTO) sfnt container.
//
// pdf-lib's CFF subsetter emits raw CFF bytes (header "01 00 ...") that we
// embed in PDF as /FontFile3 + /Subtype /CIDFontType0C. This is spec-correct
// for PDF but macOS Preview's font loader rejects it -- presumably because
// CoreText only accepts sfnt-wrapped CFF, not the raw CFF blob form.
//
// The fix is to wrap the CFF in a standard OpenType sfnt (scaler "OTTO")
// with the OT-required tables synthesised around it, and to label the
// FontFile3 stream as /Subtype /OpenType. The wrapper carries cmap, head,
// hhea, maxp, hmtx, name, OS/2, post tables alongside the original "CFF "
// table. PDF rendering still uses the CIDFont dict's /W widths and the
// FontDescriptor's ascent/descent, so the synthesised values only need to
// be syntactically valid for the OT loader to accept the wrapper.

import { parseCff } from "./cff-parse";
import { readCffName } from "./cff-name";
import { buildMinimalCmap } from "./ttf-cmap";
import {
  buildHead,
  buildHhea,
  buildHmtx,
  buildMaxp,
  buildName,
  buildOS2,
  buildPost,
} from "./ot-tables";
import { buildSfnt } from "./ttf-tables";

// Wrap a raw CFF byte stream in an OpenType sfnt. Returns OTTO-prefixed bytes
// suitable for /FontFile3 + /Subtype /OpenType.
export function wrapCffInOpenType(cff: Uint8Array): Uint8Array {
  const cffInfo = parseCff(cff);
  const fontName = readCffName(cff) ?? "Untitled";

  const metrics = {
    numGlyphs: cffInfo.numGlyphs,
    fontBBox: cffInfo.fontBBox,
    fontName,
  };

  const tables = new Map<string, Uint8Array>([
    // Tag order doesn't matter here -- buildSfnt sorts alphabetically per the
    // OpenType spec before writing the directory.
    ["CFF ", cff],
    ["OS/2", buildOS2(metrics)],
    ["cmap", buildMinimalCmap()],
    ["head", buildHead(metrics)],
    ["hhea", buildHhea(metrics)],
    ["hmtx", buildHmtx(metrics)],
    ["maxp", buildMaxp(metrics)],
    ["name", buildName(metrics)],
    ["post", buildPost()],
  ]);

  return buildSfnt("OTTO", tables);
}
