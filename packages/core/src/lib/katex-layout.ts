import type {} from "../types/katex";
import { __renderToHTMLTree, type KatexInternalNode } from "katex";
import { toHex } from "./color";
import { katexFontFamily } from "./katex-fonts";

// KaTeX's public API emits HTML, which neither the SVG LIR nor pdf-lib can
// consume directly. Its internal HTML tree already contains TeX metrics and
// positioning data, so this module applies the small relevant subset of KaTeX
// CSS and lowers that tree to positioned text and vector items. The dependency
// is pinned exactly because this internal tree is intentionally not stable.

export interface KatexText {
  kind: "text";
  text: string;
  x: number;
  baseline: number;
  size: number;
  family: string;
  color?: string;
}

export interface KatexRect {
  kind: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  background: boolean;
  strokeWidth?: number;
}

export interface KatexLine {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  color?: string;
}

export interface KatexSvgPath {
  kind: "svgPath";
  d: string;
  x: number;
  y: number;
  width: number;
  height: number;
  viewBox: { x: number; y: number; width: number; height: number };
  align: "min" | "mid" | "max";
  color?: string;
}

export type KatexItem = KatexText | KatexRect | KatexLine | KatexSvgPath;

export interface KatexLayout {
  width: number;
  ascent: number;
  depth: number;
  items: KatexItem[];
}

type Align = "left" | "center" | "right";

interface LayoutContext {
  rootSize: number;
  scale: number;
  align: Align;
  color?: string;
  parentClasses: string[];
  fontClasses: string[];
}

interface BoxWidth {
  content: number;
  marginLeft: number;
  marginRight: number;
  paddingLeft: number;
  paddingRight: number;
}

const FONT_SIZES = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.2, 1.44, 1.728, 2.074, 2.488];
const ZERO_WIDTH_CLASSES = new Set(["llap", "rlap", "clap", "katex-thinbox"]);
const RULE_CLASSES = new Set([
  "frac-line",
  "overline-line",
  "underline-line",
  "katex-hline",
  "katex-hdashline",
]);

function classesOf(node: KatexInternalNode): string[] {
  return node.classes?.filter(Boolean) ?? [];
}

function hasClass(node: KatexInternalNode, name: string): boolean {
  return classesOf(node).includes(name);
}

function em(value: string | undefined, fontSize: number): number {
  if (!value) return 0;
  const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))em$/);
  return match ? Number(match[1]) * fontSize : 0;
}

function percent(value: string | undefined, total: number): number {
  if (!value) return 0;
  if (value.endsWith("%")) return (Number(value.slice(0, -1)) / 100) * total;
  return Number(value) || 0;
}

function scaleForClasses(classes: string[], current: number): number {
  const reset = classes.find((name) => /^reset-size\d+$/.test(name));
  const size = classes.find((name) => /^size\d+$/.test(name));
  if (!reset || !size) return current;
  const from = Number(reset.slice("reset-size".length)) - 1;
  const to = Number(size.slice("size".length)) - 1;
  const fromSize = FONT_SIZES[from];
  const toSize = FONT_SIZES[to];
  return fromSize && toSize ? current * (toSize / fromSize) : current;
}

function childContext(node: KatexInternalNode, ctx: LayoutContext): LayoutContext {
  const classes = classesOf(node);
  let align = ctx.align;
  if (
    classes.some((name) =>
      ["mfrac", "op-limits", "katex-accent", "x-arrow", "mover", "munder", "col-align-c"].includes(
        name,
      ),
    )
  ) {
    align = "center";
  } else if (classes.includes("col-align-r")) {
    align = "right";
  } else if (classes.includes("col-align-l") || classes.includes("msupsub")) {
    align = "left";
  }
  return {
    rootSize: ctx.rootSize,
    scale: scaleForClasses(classes, ctx.scale),
    align,
    color: toHex(node.style?.color ?? "") ?? ctx.color,
    parentClasses: classes,
    fontClasses: [...ctx.fontClasses, ...classes],
  };
}

function classPadding(node: KatexInternalNode, size: number): [number, number] {
  const classes = classesOf(node);
  if (classes.includes("boxpad")) return [0.3 * size, 0.3 * size];
  if (classes.includes("cancel-pad")) return [0.2 * size, 0.2 * size];
  if (classes.includes("x-arrow-pad")) return [0.5 * size, 0.5 * size];
  if (classes.includes("cd-arrow-pad")) return [0.27778 * size, 0.55556 * size];
  if (classes.includes("anglpad")) return [0.03889 * size, 0.03889 * size];
  return [0, 0];
}

function margins(node: KatexInternalNode, size: number, parentClasses: string[]): [number, number] {
  let left = em(node.style?.marginLeft, size);
  let right = em(node.style?.marginRight, size);
  const shorthand = node.style?.margin?.trim().split(/\s+/) ?? [];
  if (shorthand.length === 4) {
    right += em(shorthand[1], size);
    left += em(shorthand[3], size);
  }
  if (hasClass(node, "katex-root") && parentClasses.includes("sqrt")) {
    left += (5 / 18) * size;
    right -= (10 / 18) * size;
  }
  if (hasClass(node, "cancel-lap")) {
    left -= 0.2 * size;
    right -= 0.2 * size;
  }
  return [left, right];
}

function mainVList(node: KatexInternalNode): KatexInternalNode | undefined {
  const firstRow = node.children?.find((child) => hasClass(child, "vlist-r"));
  return firstRow?.children?.find((child) => hasClass(child, "vlist"));
}

function vlistWidth(node: KatexInternalNode, ctx: LayoutContext): number {
  const vlist = mainVList(node);
  if (!vlist?.children) return 0;
  let width = 0;
  for (const wrapper of vlist.children) width = Math.max(width, measureNode(wrapper, ctx));
  return width;
}

function intrinsicContentWidth(node: KatexInternalNode, ctx: LayoutContext): number {
  const classes = classesOf(node);
  const size = ctx.rootSize * ctx.scale;
  if (node.text !== undefined) return (node.width ?? 0) * size + (node.italic ?? 0) * size;
  if (
    classes.includes("katex-strut") ||
    classes.includes("pstrut") ||
    classes.includes("vlist-s")
  ) {
    return 0;
  }
  if (classes.includes("nulldelimiter")) return 0.12 * size;
  if (classes.includes("katex-rule")) return em(node.style?.borderRightWidth, size);
  if (classes.includes("vlist-t")) return vlistWidth(node, ctx);
  const explicit = em(node.style?.width, size);
  const children = node.children ?? [];
  const childrenWidth = children.reduce((sum, child) => sum + measureNode(child, ctx), 0);
  return Math.max(explicit, childrenWidth, (node.width ?? 0) * size);
}

function boxWidth(node: KatexInternalNode, ctx: LayoutContext, parentClasses: string[]): BoxWidth {
  const size = ctx.rootSize * ctx.scale;
  const [classLeft, classRight] = classPadding(node, size);
  const [marginLeft, marginRight] = margins(node, size, parentClasses);
  const paddingLeft = classLeft + em(node.style?.paddingLeft, size);
  const paddingRight = classRight;
  const minWidth = em(node.style?.minWidth, size);
  return {
    content: Math.max(minWidth, intrinsicContentWidth(node, ctx)),
    marginLeft,
    marginRight,
    paddingLeft,
    paddingRight,
  };
}

function measureNode(node: KatexInternalNode, ctx: LayoutContext): number {
  const classes = classesOf(node);
  const nodeCtx = childContext(node, ctx);
  const box = boxWidth(node, nodeCtx, ctx.parentClasses);
  if (
    classes.some((name) => ZERO_WIDTH_CLASSES.has(name)) ||
    (classes.includes("accent-body") && !classes.includes("accent-full"))
  ) {
    return box.marginLeft + box.marginRight;
  }
  return box.marginLeft + box.paddingLeft + box.content + box.paddingRight + box.marginRight;
}

function alignOffset(align: Align, outer: number, inner: number): number {
  if (align === "center") return (outer - inner) / 2;
  if (align === "right") return outer - inner;
  return 0;
}

function pstrutHeight(wrapper: KatexInternalNode, size: number): number {
  const pstrut = wrapper.children?.find((child) => hasClass(child, "pstrut"));
  return em(pstrut?.style?.height, size);
}

function fillsVListWidth(node: KatexInternalNode): boolean {
  const classes = classesOf(node);
  if (
    node.attributes?.viewBox ||
    node.attributes?.width === "100%" ||
    classes.includes("katex-stretchy") ||
    classes.some((name) => RULE_CLASSES.has(name))
  ) {
    return true;
  }
  return node.children?.some(fillsVListWidth) ?? false;
}

function renderVList(
  node: KatexInternalNode,
  x: number,
  baseline: number,
  ctx: LayoutContext,
  items: KatexItem[],
): void {
  // KaTeX represents superscripts, fractions, accents, and array cells as a
  // zero-height stack. Each wrapper's `top` plus its pstrut height is the child
  // baseline relative to the formula baseline; no browser layout is needed.
  const vlist = mainVList(node);
  if (!vlist?.children) return;
  const width = vlistWidth(node, ctx);
  const fontSize = ctx.rootSize * ctx.scale;
  for (const wrapper of vlist.children) {
    // CSS gives rules and stretchy SVG containers width:100%. Treat their
    // zero-width virtual wrapper as the full table-cell width before aligning.
    const wrapperWidth = fillsVListWidth(wrapper) ? width : measureNode(wrapper, ctx);
    const wrapperX = x + alignOffset(ctx.align, width, wrapperWidth);
    const childBaseline =
      baseline + em(wrapper.style?.top, fontSize) + pstrutHeight(wrapper, fontSize);
    const children = wrapper.children?.filter((child) => !hasClass(child, "pstrut")) ?? [];
    let cursor = wrapperX;
    for (const child of children) {
      const childWidth = measureNode(child, ctx);
      renderNode(child, cursor, childBaseline, ctx, items, width);
      cursor += childWidth;
    }
  }
}

function fontName(classes: string[]): string {
  if (classes.includes("delimsizing")) {
    const size = classes.find((name) => /^size[1-4]$/.test(name));
    if (size) return `Size${size.slice(4)}-Regular`;
  }
  if (classes.includes("small-op")) return "Size1-Regular";
  if (classes.includes("large-op")) return "Size2-Regular";
  if (classes.some((name) => ["amsrm", "mathbb", "textbb"].includes(name))) return "AMS-Regular";
  if (classes.includes("mathboldfrak") || classes.includes("textboldfrak")) return "Fraktur-Bold";
  if (classes.includes("mathfrak") || classes.includes("textfrak")) return "Fraktur-Regular";
  if (classes.includes("mathcal")) {
    return classes.includes("mathbf") ? "Caligraphic-Bold" : "Caligraphic-Regular";
  }
  if (classes.includes("mathscr") || classes.includes("textscr")) return "Script-Regular";
  if (classes.includes("mathtt") || classes.includes("texttt")) return "Typewriter-Regular";
  if (classes.includes("boldsymbol")) return "Math-BoldItalic";
  if (classes.includes("mathnormal")) return "Math-Italic";
  if (classes.includes("mathit")) return "Main-Italic";
  const sans = classes.some((name) =>
    ["mathsf", "textsf", "mathboldsf", "textboldsf", "mathsfit", "mathitsf", "textitsf"].includes(
      name,
    ),
  );
  const bold = classes.some((name) =>
    ["mathbf", "textbf", "mathboldsf", "textboldsf"].includes(name),
  );
  const italic = classes.some((name) =>
    ["textit", "mathsfit", "mathitsf", "textitsf"].includes(name),
  );
  if (sans) return `SansSerif-${bold ? "Bold" : italic ? "Italic" : "Regular"}`;
  if (bold && italic) return "Main-BoldItalic";
  if (bold) return "Main-Bold";
  if (italic) return "Main-Italic";
  return "Main-Regular";
}

function pathData(node: KatexInternalNode): string | undefined {
  if (node.alternate) return node.alternate;
  return node.toMarkup().match(/<path d="([\s\S]*?)"\/>/)?.[1];
}

function renderSvg(
  node: KatexInternalNode,
  x: number,
  baseline: number,
  width: number,
  height: number,
  ctx: LayoutContext,
  items: KatexItem[],
): void {
  const attrs = node.attributes ?? {};
  const fontSize = ctx.rootSize * ctx.scale;
  const viewBox = attrs.viewBox?.split(/\s+/).map(Number);
  if (viewBox?.length === 4) {
    const [vx, vy, vw, vh] = viewBox;
    const align = attrs.preserveAspectRatio?.startsWith("xMax")
      ? "max"
      : attrs.preserveAspectRatio?.startsWith("xMid")
        ? "mid"
        : "min";
    for (const child of node.children ?? []) {
      const d = pathData(child);
      if (d) {
        items.push({
          kind: "svgPath",
          d,
          x,
          y: baseline - height,
          width,
          height,
          viewBox: { x: vx, y: vy, width: vw, height: vh },
          align,
          color: ctx.color,
        });
      }
    }
    return;
  }
  for (const child of node.children ?? []) {
    const line = child.attributes;
    if (!line?.x1) continue;
    items.push({
      kind: "line",
      x1: x + percent(line.x1, width),
      y1: baseline - height + percent(line.y1, height),
      x2: x + percent(line.x2, width),
      y2: baseline - height + percent(line.y2, height),
      width: em(line["stroke-width"], fontSize),
      color: ctx.color,
    });
  }
}

function renderRule(
  node: KatexInternalNode,
  x: number,
  baseline: number,
  width: number,
  ctx: LayoutContext,
  items: KatexItem[],
): void {
  const size = ctx.rootSize * ctx.scale;
  if (hasClass(node, "katex-rule")) {
    const ruleWidth = em(node.style?.borderRightWidth, size);
    const height = em(node.style?.borderTopWidth, size);
    const bottom = em(node.style?.bottom, size);
    items.push({
      kind: "rect",
      x,
      y: baseline - bottom - height,
      width: ruleWidth,
      height,
      color: ctx.color,
      background: false,
    });
    return;
  }
  const height = Math.max(1, em(node.style?.borderBottomWidth, size));
  items.push({
    kind: "rect",
    x,
    y: baseline - height,
    width,
    height,
    color: ctx.color,
    background: false,
  });
}

function renderDecoration(
  node: KatexInternalNode,
  x: number,
  baseline: number,
  width: number,
  ctx: LayoutContext,
  items: KatexItem[],
): void {
  const size = ctx.rootSize * ctx.scale;
  const explicitHeight = em(node.style?.height, size);
  const height = explicitHeight || ((node.height ?? 0) + (node.depth ?? 0)) * ctx.rootSize;
  const top = baseline - (node.height ?? 0) * ctx.rootSize;
  const background = toHex(node.style?.backgroundColor ?? "");
  if (background) {
    items.push({ kind: "rect", x, y: top, width, height, color: background, background: true });
  }
  if (hasClass(node, "fbox") || hasClass(node, "fcolorbox")) {
    items.push({
      kind: "rect",
      x,
      y: top,
      width,
      height,
      color: toHex(node.style?.borderColor ?? "") ?? ctx.color,
      background: false,
      strokeWidth: em(node.style?.borderWidth, size) || 0.04 * size,
    });
  }
}

function renderNode(
  node: KatexInternalNode,
  x: number,
  baseline: number,
  parentCtx: LayoutContext,
  items: KatexItem[],
  availableWidth?: number,
): void {
  const ctx = childContext(node, parentCtx);
  const classes = classesOf(node);
  const box = boxWidth(node, ctx, parentCtx.parentClasses);
  const contentX =
    x + box.marginLeft + box.paddingLeft + em(node.style?.left, ctx.rootSize * ctx.scale);
  const shiftedBaseline = baseline + em(node.style?.top, ctx.rootSize * ctx.scale);
  const width = availableWidth ?? box.content;

  if (node.text !== undefined) {
    if (node.text !== "\u200b") {
      items.push({
        kind: "text",
        text: node.text,
        x: contentX,
        baseline: shiftedBaseline,
        size: ctx.rootSize * ctx.scale,
        family: katexFontFamily(fontName(ctx.fontClasses)),
        color: ctx.color,
      });
    }
    return;
  }
  if (
    classes.includes("katex-strut") ||
    classes.includes("pstrut") ||
    classes.includes("vlist-s")
  ) {
    return;
  }
  if (classes.includes("vlist-t")) {
    renderVList(node, contentX, shiftedBaseline, ctx, items);
    return;
  }
  if (classes.includes("katex-rule") || classes.some((name) => RULE_CLASSES.has(name))) {
    renderRule(node, contentX, shiftedBaseline, width, ctx, items);
    return;
  }

  renderDecoration(node, contentX, shiftedBaseline, width, ctx, items);
  const svg = node.children?.find(
    (child) => child.attributes?.viewBox || child.attributes?.width === "100%",
  );
  if (svg) {
    const height = em(node.style?.height ?? svg.attributes?.height, ctx.rootSize * ctx.scale);
    renderSvg(svg, contentX, shiftedBaseline, width, height, ctx, items);
    return;
  }

  let cursor = contentX;
  for (const child of node.children ?? []) {
    const childWidth = measureNode(child, ctx);
    const forceWidth =
      hasClass(child, "katex-stretchy") || classes.some((name) => RULE_CLASSES.has(name))
        ? width
        : undefined;
    renderNode(child, cursor, shiftedBaseline, ctx, items, forceWidth);
    cursor += childWidth;
  }
}

export function layoutKatex(tex: string, sizePx: number): KatexLayout | null {
  let tree: KatexInternalNode;
  try {
    tree = __renderToHTMLTree(tex, {
      output: "html",
      displayMode: false,
      throwOnError: true,
      strict: "ignore",
      trust: false,
    });
  } catch {
    return null;
  }
  const ctx: LayoutContext = {
    rootSize: sizePx,
    scale: 1,
    align: "left",
    parentClasses: [],
    fontClasses: [],
  };
  const items: KatexItem[] = [];
  renderNode(tree, 0, 0, ctx, items);
  return {
    width: measureNode(tree, ctx),
    ascent: (tree.height ?? 0) * sizePx,
    depth: (tree.depth ?? 0) * sizePx,
    items,
  };
}
