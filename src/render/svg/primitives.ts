import type { Primitive, Stroke } from "../../ir/lir";
import { dataUri } from "../../lib/base64";
import { renderRichHtml } from "../../lib/richtext";

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function num(n: number): string {
  // 不要な桁を落として SVG を読みやすく。
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");
}

// 宣言フォントが未ロードでもプレビューが読めるよう sans-serif を後置する。
function fontFamilyWithFallback(family: string): string {
  return `'${family.replace(/'/g, "")}', sans-serif`;
}

function strokeAttrs(stroke: Stroke | undefined): string {
  if (!stroke) return "";
  return ` stroke="${escapeXml(stroke.color)}" stroke-width="${num(stroke.width)}"`;
}

// 1 つの LIR プリミティブを SVG マークアップ文字列にする。
export function renderPrimitive(p: Primitive): string {
  switch (p.kind) {
    case "text":
      return p.runs
        .map(
          (r) =>
            `<text x="${num(r.x)}" y="${num(r.y)}" font-family="${escapeXml(
              fontFamilyWithFallback(r.font.family),
            )}" font-size="${num(r.size)}" fill="${escapeXml(r.color)}"${
              r.font.weight ? ` font-weight="${r.font.weight}"` : ""
            }${
              r.font.style === "italic" ? ` font-style="italic"` : ""
            }>${escapeXml(r.text)}</text>`,
        )
        .join("");
    case "image":
      return `<image x="${num(p.x)}" y="${num(p.y)}" width="${num(
        p.w,
      )}" height="${num(p.h)}" preserveAspectRatio="none" href="${dataUri(
        p.mime,
        p.data,
      )}"/>`;
    case "rect":
      return `<rect x="${num(p.x)}" y="${num(p.y)}" width="${num(
        p.w,
      )}" height="${num(p.h)}"${p.rx ? ` rx="${num(p.rx)}"` : ""} fill="${
        p.fill ? escapeXml(p.fill) : "none"
      }"${strokeAttrs(p.stroke)}/>`;
    case "line":
      return `<line x1="${num(p.x1)}" y1="${num(p.y1)}" x2="${num(
        p.x2,
      )}" y2="${num(p.y2)}"${strokeAttrs(p.stroke)}/>`;
    case "path":
      return `<path d="${escapeXml(p.d)}" fill="${
        p.fill ? escapeXml(p.fill) : "none"
      }"${strokeAttrs(p.stroke)}/>`;
    case "richtext": {
      // インライン Markdown + 数式入りテキストを foreignObject 内の HTML で描画する。
      // 数式表示には katex の CSS/フォントがページに読み込まれている必要がある。
      const inner = renderRichHtml(p.raw, p.rich);
      const style =
        `font-family:${escapeXml(fontFamilyWithFallback(p.font.family))};` +
        `font-size:${num(p.size)}px;color:${escapeXml(p.color)};` +
        `text-align:${p.align};line-height:${p.lineHeight}`;
      return (
        `<foreignObject x="${num(p.x)}" y="${num(p.y)}" width="${num(p.w)}" height="${num(p.h)}">` +
        `<div xmlns="http://www.w3.org/1999/xhtml" style="${style}">${inner}</div>` +
        `</foreignObject>`
      );
    }
  }
}
