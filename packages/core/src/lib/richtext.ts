import MarkdownIt from "markdown-it";
import { parseInlineMath, hasInlineMath } from "./inline-math";

// Break inline Markdown (emphasis/bold/code/strikethrough/link) + inline math
// into a list of styled segments. No HTML or foreignObject is used;
// downstream shapeRich turns them into native text/line/path primitives.
const md = new MarkdownIt({ html: false, linkify: false, breaks: false });

// Only detect paired markers, to avoid wrongly treating plain text as rich.
const MARKDOWN_RE =
  /`[^`]+`|~~[^~]+~~|\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|_[^_]+_|\[[^\]]+\]\([^)]+\)/;

export function hasMarkdown(text: string): boolean {
  return MARKDOWN_RE.test(text);
}

// Whether it contains math or Markdown (if so, treat as rich).
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
  href?: string; // target URL when it is a link
}

interface MathSegment {
  kind: "math";
  tex: string;
}

export type RichSegment = TextSegment | MathSegment;

// Break text into a list of "math" and "styled text" segments.
// Newlines are kept as "\n" text (shapeRich uses them as paragraph breaks).
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
    const hrefs: string[] = []; // link-target stack for nesting support
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
        href: link > 0 ? hrefs[hrefs.length - 1] : undefined,
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
          hrefs.push(tk.attrGet("href") ?? "");
          break;
        case "link_close":
          link--;
          hrefs.pop();
          break;
        default:
          break;
      }
    }
  }
  return out;
}
