import type { LoadedFont } from "@slideck/core";

// Record to avoid registering the same family twice (rough id by byte length).
const registered = new Set<string>();

// Register loaded fonts with the browser via the FontFace API.
// This makes the preview SVG render with the same real fonts as the PDF,
// keeping metrics (line wrapping) and appearance consistent.
export async function registerFonts(
  fonts: Map<string, LoadedFont>,
): Promise<void> {
  if (typeof FontFace === "undefined" || typeof document === "undefined") return;
  for (const [family, lf] of fonts) {
    const key = `${family}:${lf.bytes.byteLength}`;
    if (registered.has(key)) continue;
    try {
      const face = new FontFace(family, lf.bytes as BufferSource, {
        weight: lf.weight ? String(lf.weight) : undefined,
        style: lf.style,
      });
      await face.load();
      document.fonts.add(face);
      registered.add(key);
    } catch {
      // On registration failure, defer to the system fallback.
    }
  }
}
