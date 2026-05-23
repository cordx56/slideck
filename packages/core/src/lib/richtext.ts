import MarkdownIt from "markdown-it";
import { parseInlineMath, hasInlineMath } from "./inline-math";

// インライン Markdown (強調/太字/コード/打ち消し/リンク) + インライン数式を
// スタイル付きセグメント列に分解する。HTML や foreignObject は使わず、
// 下流の shapeRich がネイティブな text/line/path プリミティブに落とす。
const md = new MarkdownIt({ html: false, linkify: false, breaks: false });

// ペアになったマーカのみ検出して、通常テキストを誤って rich 化しないようにする。
const MARKDOWN_RE =
  /`[^`]+`|~~[^~]+~~|\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|_[^_]+_|\[[^\]]+\]\([^)]+\)/;

export function hasMarkdown(text: string): boolean {
  return MARKDOWN_RE.test(text);
}

// 数式または Markdown を含むか (含めば rich として扱う)。
export function hasRichMarkup(text: string): boolean {
  return hasInlineMath(text) || hasMarkdown(text);
}

interface TextSegment {
  kind: "text";
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
  strike: boolean;
  link: boolean;
}

interface MathSegment {
  kind: "math";
  tex: string;
}

export type RichSegment = TextSegment | MathSegment;

// テキストを「数式」と「スタイル付きテキスト」のセグメント列に分解する。
// 改行は "\n" のテキストとして残す (shapeRich が段落区切りに使う)。
export function parseRich(text: string): RichSegment[] {
  const out: RichSegment[] = [];
  for (const seg of parseInlineMath(text)) {
    if (seg.math) {
      out.push({ kind: "math", tex: seg.value });
      continue;
    }
    const tokens = md.parseInline(seg.value, {})[0]?.children ?? [];
    let bold = 0;
    let italic = 0;
    let code = 0;
    let strike = 0;
    let link = 0;
    const push = (t: string, isCode = false): void => {
      if (t === "") return;
      out.push({
        kind: "text",
        text: t,
        bold: bold > 0,
        italic: italic > 0,
        code: isCode || code > 0,
        strike: strike > 0,
        link: link > 0,
      });
    };
    for (const tk of tokens) {
      switch (tk.type) {
        case "text":
          push(tk.content);
          break;
        case "code_inline":
          push(tk.content, true);
          break;
        case "softbreak":
        case "hardbreak":
          push("\n");
          break;
        case "strong_open":
          bold++;
          break;
        case "strong_close":
          bold--;
          break;
        case "em_open":
          italic++;
          break;
        case "em_close":
          italic--;
          break;
        case "s_open":
          strike++;
          break;
        case "s_close":
          strike--;
          break;
        case "link_open":
          link++;
          break;
        case "link_close":
          link--;
          break;
        default:
          break;
      }
    }
  }
  return out;
}
