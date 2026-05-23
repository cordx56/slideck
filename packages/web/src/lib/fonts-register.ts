import type { LoadedFont } from "@slideck/core";

// 同じ family を二重登録しないための記録 (バイト長で簡易識別)。
const registered = new Set<string>();

// ロード済みフォントを FontFace API でブラウザに登録する。
// これによりプレビュー SVG が PDF と同じ実フォントで描画され、
// メトリクス (折り返し) と見た目が一致する。
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
      // 登録失敗時はシステムフォールバックに任せる。
    }
  }
}
