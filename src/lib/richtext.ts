import MarkdownIt from "markdown-it";
import katex from "katex";
import { parseInlineMath, hasInlineMath } from "./inline-math";

// インラインのみの Markdown (強調/太字/コード/打ち消し/リンク) + インライン数式。
// ブロック要素 (見出し/リスト等) は使わない。html:false で生 HTML は無効化。
const md = new MarkdownIt({ html: false, linkify: false, breaks: false });

// ペアになったマーカのみ検出して、通常テキストを誤って richtext 化しないようにする。
const MARKDOWN_RE =
  /`[^`]+`|~~[^~]+~~|\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|_[^_]+_|\[[^\]]+\]\([^)]+\)/;

export function hasMarkdown(text: string): boolean {
  return MARKDOWN_RE.test(text);
}

// 数式または Markdown を含むか (含めば richtext として扱う)。
export function hasRichMarkup(text: string): boolean {
  return hasInlineMath(text) || hasMarkdown(text);
}

function renderMath(tex: string): string {
  try {
    return katex.renderToString(tex, {
      displayMode: false,
      throwOnError: false,
      output: "html",
    });
  } catch {
    return tex;
  }
}

// 数式以外の部分を inline Markdown -> HTML、数式部分を KaTeX にして連結する。
export function renderRichHtml(text: string): string {
  return parseInlineMath(text)
    .map((seg) => (seg.math ? renderMath(seg.value) : md.renderInline(seg.value)))
    .join("");
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// マークアップを外した素テキスト (PDF フォールバック・高さ/幅の概算用)。
export function richToPlain(text: string): string {
  return parseInlineMath(text)
    .map((seg) => (seg.math ? seg.value : stripTags(md.renderInline(seg.value))))
    .join("");
}
