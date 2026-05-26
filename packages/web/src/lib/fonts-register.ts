import type { LoadedFont } from "@slideck/core";

// Record to avoid registering the same family twice (rough id by byte length).
const registered = new Set<string>();

// Register loaded fonts with the browser via the FontFace API.
// This makes the preview SVG render with the same real fonts as the PDF,
// keeping metrics (line wrapping) and appearance consistent.
export async function registerFonts(fonts: Map<string, LoadedFont>): Promise<void> {
  if (typeof FontFace === "undefined" || typeof document === "undefined") return;
  for (const [variantKey, lf] of fonts) {
    const cache = `${variantKey}:${lf.bytes.byteLength}`;
    if (registered.has(cache)) continue;
    try {
      // Each declared face is its own CSS family, so weight/style stay "normal"
      // and the family alone selects the right face for any text run.
      const face = new FontFace(lf.family, lf.bytes as BufferSource, {
        weight: "normal",
        style: "normal",
      });
      await face.load();
      document.fonts.add(face);
      registered.add(cache);
    } catch {
      // On registration failure, defer to the system fallback.
    }
  }
}
