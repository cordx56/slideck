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
  const fixed = normaliseCffHeader(cff);
  const cffInfo = parseCff(fixed);
  const fontName = readCffName(fixed) ?? "Untitled";

  const metrics = {
    numGlyphs: cffInfo.numGlyphs,
    fontBBox: cffInfo.fontBBox,
    fontName,
  };

  const tables = new Map<string, Uint8Array>([
    // Tag order doesn't matter here -- buildSfnt sorts alphabetically per the
    // OpenType spec before writing the directory.
    ["CFF ", fixed],
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

// pdf-lib's CFF subsetter (via fontkit's CFFSubset) writes the CFF header's
// OffSize byte as 31 (0x1f) instead of a CFF-spec-legal value (1-4). The
// byte sits at offset 3 of the CFF blob: major / minor / hdrSize / OffSize.
//
// Browsers and pdftools-with-lenient-parsers ignore the byte entirely, but
// CoreText (macOS Preview) and FreeType validate it and refuse to load the
// font when it's out of range -- the embedded CFF gets dropped and the
// renderer falls back to a system font, which is what produced the
// consecutive-ASCII garbling pattern in the user's slides.
//
// The fix is one byte: clamp OffSize to the maximum legal value (4). The
// header's OffSize is only consulted to size an optional offset array that
// follows the standard 4-byte header; since pdf-lib's subset doesn't emit
// that extra array (hdrSize stays 4), the OffSize value isn't otherwise
// referenced for parsing -- it just has to be 1..4 to pass validation.
function normaliseCffHeader(cff: Uint8Array): Uint8Array {
  if (cff.length < 4) return cff;
  const offSize = cff[3];
  if (offSize >= 1 && offSize <= 4) return cff; // already valid
  const out = new Uint8Array(cff.length);
  out.set(cff);
  out[3] = 4;
  return out;
}
