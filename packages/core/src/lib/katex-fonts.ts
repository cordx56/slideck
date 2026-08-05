import { KATEX_FONT_BASE64 } from "../generated/katex-font-data";
import type { LoadedFont } from "../lower/context";

const PREFIX = "slideck-katex-";

export function katexFontFamily(name: string): string {
  return PREFIX + name;
}

function decodeBase64(value: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }
  return new Uint8Array(Buffer.from(value, "base64"));
}

let cached: Map<string, LoadedFont> | undefined;

export function katexFonts(): Map<string, LoadedFont> {
  if (!cached) {
    cached = new Map(
      KATEX_FONT_BASE64.map(([name, data]) => {
        const family = katexFontFamily(name);
        return [family, { family, bytes: decodeBase64(data) }];
      }),
    );
  }
  return cached;
}
