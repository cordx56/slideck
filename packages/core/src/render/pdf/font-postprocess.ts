// Post-process a saved PDF's font subset streams to inject a minimal cmap.
//
// pdf-lib's subset:true output omits the cmap table because PDF rendering of
// a CIDFontType2 doesn't strictly need it -- the CID-to-GID translation
// happens via CIDToGIDMap in the PDF, not via the font's cmap. macOS Preview
// (Core Graphics) rejects cmap-less sfnt blobs anyway, falls back to system
// fonts, and renders garbled ASCII. See ttf-cmap.ts for the deeper write-up.
//
// External injection: we load the saved PDF, walk every PDFRawStream, and
// when one starts with the TrueType signature ("\x00\x01\x00\x00" or "true"),
// run ensureCmap over it and replace the stream content. No pdf-lib internals
// are touched; the embedder is left alone and the BaseFont / CIDToGIDMap /
// ToUnicode entries it generated all continue to apply. Cost is one extra
// PDF load/save cycle.

import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { ensureCmap } from "./ttf-cmap";

// Return either the input bytes (when no font needed cmap injection -- save
// the second serialisation) or a freshly saved PDF with patched streams.
export async function injectFontCmaps(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  let changed = false;

  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;

    let decoded: Uint8Array;
    try {
      decoded = decodePDFRawStream(obj).decode();
    } catch {
      continue; // can't decode (unknown filter etc.) -- leave it alone
    }
    if (!isTrueType(decoded)) continue;

    const fixed = ensureCmap(decoded);
    if (fixed === decoded) continue; // already has cmap

    // Re-encode with FlateDecode (pdf-lib's default for new streams). Length1
    // is the uncompressed sfnt size; required by PDF 9.9 for FontFile2, but
    // pdf-lib's embedder omits it. Setting it on the replacement is more
    // spec-correct and harmless when missing.
    const newStream = doc.context.flateStream(fixed, { Length1: fixed.length });
    // Preserve other dict entries the embedder might have set (e.g. Subtype).
    copyExtraEntries(obj, newStream);
    doc.context.assign(ref, newStream);
    changed = true;
  }

  if (!changed) return bytes;
  return await doc.save();
}

function isTrueType(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  // Standard sfnt scaler (TTF/OTF outline) is 0x00010000; Apple uses "true"
  // for legacy TrueType. Either one indicates a TrueType font program.
  const b0 = bytes[0], b1 = bytes[1], b2 = bytes[2], b3 = bytes[3];
  if (b0 === 0x00 && b1 === 0x01 && b2 === 0x00 && b3 === 0x00) return true;
  if (b0 === 0x74 && b1 === 0x72 && b2 === 0x75 && b3 === 0x65) return true;
  return false;
}

// Copy any dict entries from the original stream (other than the ones the
// replacement already sets: Length, Length1, Filter) so we don't lose
// implementation-specific keys. PDFFile2 streams typically only carry
// /Length, /Filter, /Length1 -- but defensive copy is cheap insurance.
function copyExtraEntries(src: PDFRawStream, dst: PDFRawStream): void {
  const skip = new Set(["Length", "Length1", "Filter"]);
  for (const [key, value] of src.dict.entries()) {
    const name = key.asString().slice(1); // strip the leading "/"
    if (skip.has(name)) continue;
    dst.dict.set(PDFName.of(name), value);
  }
}
