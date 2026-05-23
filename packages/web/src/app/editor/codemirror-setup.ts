import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  hoverTooltip,
} from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";

// YAML syntax highlighting (maps to @lezer/yaml tags). Dark theme colors.
const yamlHighlight = HighlightStyle.define([
  { tag: t.lineComment, color: "#565f89", fontStyle: "italic" },
  { tag: t.definition(t.propertyName), color: "#7dcfff" }, // key
  { tag: t.string, color: "#9ece6a" }, // quoted string
  { tag: t.special(t.string), color: "#9ece6a" }, // block literal
  { tag: t.content, color: "#c0caf5" }, // plain value
  { tag: t.attributeValue, color: "#9ece6a" },
  { tag: t.keyword, color: "#bb9af7" }, // directive
  { tag: t.labelName, color: "#e0af68" }, // anchor / alias
  { tag: t.typeName, color: "#2ac3de" }, // tag
  { tag: t.meta, color: "#ff9e64" }, // --- / ...
  { tag: [t.separator, t.punctuation], color: "#89ddff" }, // : , - ?
  { tag: [t.squareBracket, t.brace], color: "#89ddff" }, // [] {}
]);
import { DeckSchema, BaseSchema } from "@slideck/core";
import { parseAndValidate } from "@slideck/core";
import { collectFileReferences } from "@slideck/core";
import { extname } from "@slideck/core";
import type { VFS } from "../../vfs";

// Context that determines the open file's kind (deck.yaml / base / non-YAML).
export interface EditorContext {
  vfs: VFS | null;
  openPath: string;
}

function isYamlPath(path: string): boolean {
  const e = extname(path);
  return e === ".yaml" || e === ".yml";
}

// Schema validation based on the open file (deck.yaml -> DeckSchema, other
// YAML -> BaseSchema). Turns syntax/type errors into CodeMirror diagnostics.
function schemaLinter(ctx: () => EditorContext) {
  return linter((view): Diagnostic[] => {
    const { openPath } = ctx();
    if (!isYamlPath(openPath)) return [];
    const text = view.state.doc.toString();
    const len = text.length;
    const { errors } =
      openPath === "/deck.yaml"
        ? parseAndValidate(text, DeckSchema, openPath)
        : parseAndValidate(text, BaseSchema, openPath);
    const diags: Diagnostic[] = [];
    for (const e of errors) {
      const off = e.pos?.offset;
      if (!off) continue;
      const from = Math.max(0, Math.min(off[0], len));
      let to = Math.max(from, Math.min(off[1], len));
      if (to <= from) to = Math.min(len, from + 1);
      diags.push({ from, to, severity: "error", message: e.message });
    }
    return diags;
  });
}

// Warn on the relevant range when a path reference does not exist in the VFS (§7).
function brokenRefLinter(ctx: () => EditorContext) {
  return linter(async (view): Promise<Diagnostic[]> => {
    const { vfs, openPath } = ctx();
    if (!vfs || !isYamlPath(openPath)) return [];
    const refs = collectFileReferences(openPath, view.state.doc.toString());
    const diags: Diagnostic[] = [];
    for (const r of refs) {
      if (!(await vfs.exists(r.toPath))) {
        diags.push({
          from: r.range[0],
          to: r.range[1],
          severity: "warning",
          message: `Reference not found: ${r.toPath}`,
        });
      }
    }
    return diags;
  });
}

// Field schema docs shown on hover. Keyed by YAML key; type is the value's shape
// and desc a one-line explanation. Some keys are context-dependent (noted inline).
const FIELD_DOCS: Record<string, { type: string; desc: string }> = {
  // deck.yaml
  bases: {
    type: "BaseRef[]",
    desc: "Base layers. Applied in declaration order; each { id, file, always? }.",
  },
  slides: { type: "Slide[]", desc: "The slides of the deck." },
  use: {
    type: "string | string[]",
    desc: "Base id(s) to apply to this slide (besides always:true bases).",
  },
  elements: { type: "Element[]", desc: "Elements layered on top of the applied bases." },
  vars: {
    type: "Record<string, value>",
    desc: "Values for the bases' schema.vars (referenced as ${name}).",
  },
  // base / base ref
  id: {
    type: "string",
    desc: "Identifier. For a base: referenced by use:. For a slide/element: optional id.",
  },
  file: { type: "string", desc: "Path to the base YAML file (relative to this file)." },
  always: { type: "boolean", desc: "If true, this base applies to every slide. Default false." },
  name: { type: "string", desc: "Base name (optional)." },
  extends: { type: "string", desc: "Parent base file to inherit from." },
  fonts: {
    type: "Record<string, FontDecl>",
    desc: "Font key -> { path, family, weight?, style?, index? }.",
  },
  colors: {
    type: "Record<string, string>",
    desc: "Color name -> value, injected as variables (use as ${name}).",
  },
  slide: { type: "{ width, height }", desc: "Slide dimensions in px (logical coordinate system)." },
  background: { type: "string", desc: "Background color (${var} or literal)." },
  defaults: {
    type: "{ text?, link?, mono? }",
    desc: "Default text style and inline link/code styles.",
  },
  schema: {
    type: "{ vars }",
    desc: "Variables this base accepts: name -> { type, required?, default?, values? }.",
  },
  layout: {
    type: "Element[] | 'row' | 'column'",
    desc: "Base: element layout. Group: auto-layout direction.",
  },
  // font declaration
  path: { type: "string", desc: "Font file path (.ttf / .ttc)." },
  family: { type: "string", desc: "Font family name for this declaration." },
  weight: { type: "number", desc: "Font weight (optional)." },
  style: { type: "'normal' | 'italic'", desc: "Font style (optional)." },
  index: { type: "number", desc: "Font index within a .ttc collection (default 0)." },
  // schema.vars declaration
  type: {
    type: "string",
    desc: "Element type (text/image/rect/line/path/group/ul/ol) or var type (string/number/boolean/color/image/enum).",
  },
  required: { type: "boolean", desc: "Whether this variable must be provided." },
  default: { type: "value", desc: "Default value when the variable is omitted." },
  values: { type: "string[]", desc: "Allowed values for an enum-typed variable." },
  // element: common
  position: {
    type: "Position",
    desc: "Box: left/right/top/bottom/width/height (%, px, or 'center' for left/top).",
  },
  flex: { type: "number", desc: "Grow ratio along the main axis in an auto-layout group." },
  left: { type: "% | px | 'center'", desc: "Left edge ('center' centers horizontally)." },
  right: { type: "% | px", desc: "Right edge." },
  top: { type: "% | px | 'center'", desc: "Top edge ('center' centers vertically)." },
  bottom: { type: "% | px", desc: "Bottom edge." },
  width: { type: "% | px | number", desc: "Width (or slide width under slide:)." },
  height: { type: "% | px | number", desc: "Height (or slide height under slide:)." },
  // element: text
  text: {
    type: "string",
    desc: "Text content. Inline markdown (**bold**, `code`, ~~del~~, [link](url)) and math $...$ supported.",
  },
  font: { type: "string", desc: "Font key declared in fonts:." },
  size: { type: "number", desc: "Font size in px." },
  color: { type: "string", desc: "Text/fill color (${var} or literal)." },
  align: {
    type: "'left' | 'center' | 'right'",
    desc: "Text alignment, or auto-layout cross-axis alignment.",
  },
  lineHeight: { type: "number", desc: "Line height multiplier." },
  letterSpacing: { type: "number", desc: "Letter spacing in px." },
  // element: image
  src: { type: "string", desc: "Image path (relative to this file)." },
  fit: {
    type: "'contain' | 'cover' | 'fill'",
    desc: "How the image fits its box. Default contain.",
  },
  // element: rect / path / line
  fill: { type: "string", desc: "Fill color." },
  stroke: { type: "string", desc: "Stroke color." },
  strokeWidth: { type: "number", desc: "Stroke width in px." },
  rx: { type: "number", desc: "Rectangle corner radius in px." },
  d: { type: "string", desc: "SVG path data." },
  from: { type: "{ x, y }", desc: "Line start point (relative to the box)." },
  to: { type: "{ x, y }", desc: "Line end point (relative to the box)." },
  // element: group / ul / ol
  gap: { type: "% | px", desc: "Gap between children in an auto-layout group/list." },
  justify: {
    type: "main-axis",
    desc: "Auto-layout main-axis: start/center/end/space-between/space-around.",
  },
  padding: { type: "% | px", desc: "Inner padding of a group/list." },
  children: { type: "Element[]", desc: "Child elements of a group." },
  items: { type: "Element[]", desc: "List items of a ul/ol." },
  start: { type: "number", desc: "Starting number of an ol." },
  // defaults.link / defaults.mono
  underline: { type: "boolean", desc: "Whether links are underlined (defaults.link)." },
  mono: { type: "{ family?, color? }", desc: "Inline code style." },
  link: { type: "{ color?, underline? }", desc: "Inline link style." },
};

const KEY_CHAR = /[A-Za-z0-9_-]/;

// Hover over a YAML key to show its schema (type + description). Keys only:
// the hovered word must be immediately followed by ':'.
function schemaHover(ctx: () => EditorContext) {
  return hoverTooltip((view, pos) => {
    if (!isYamlPath(ctx().openPath)) return null;
    const line = view.state.doc.lineAt(pos);
    const text = line.text;
    const rel = pos - line.from;
    let s = rel;
    let e = rel;
    while (s > 0 && KEY_CHAR.test(text[s - 1])) s--;
    while (e < text.length && KEY_CHAR.test(text[e])) e++;
    if (s === e) return null;
    let k = e;
    while (k < text.length && text[k] === " ") k++;
    if (text[k] !== ":") return null; // only treat the word as a key
    const info = FIELD_DOCS[text.slice(s, e)];
    if (!info) return null;
    return {
      pos: line.from + s,
      end: line.from + e,
      above: true,
      create() {
        const dom = document.createElement("div");
        dom.className = "cm-schema-tooltip";
        const head = document.createElement("div");
        head.className = "cm-schema-head";
        head.textContent = `${text.slice(s, e)}: ${info.type}`;
        const desc = document.createElement("div");
        desc.className = "cm-schema-desc";
        desc.textContent = info.desc;
        dom.append(head, desc);
        return { dom };
      },
    };
  });
}

const darkTheme = EditorView.theme(
  {
    "&": { height: "100%", fontSize: "13px", color: "var(--fg)" },
    ".cm-scroller": {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      lineHeight: "1.5",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-gutters": {
      background: "var(--bg-2)",
      color: "var(--fg-dim)",
      border: "none",
    },
    ".cm-activeLine": { background: "rgba(230,69,83,0.07)" },
    ".cm-activeLineGutter": { background: "rgba(230,69,83,0.1)" },
    ".cm-content": { caretColor: "var(--accent)" },
    ".cm-tooltip": {
      background: "var(--bg-2)",
      border: "1px solid var(--border)",
      borderRadius: "4px",
    },
    ".cm-schema-tooltip": { padding: "6px 9px", maxWidth: "360px", lineHeight: "1.45" },
    ".cm-schema-head": {
      color: "var(--accent)",
      fontWeight: "600",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    },
    ".cm-schema-desc": { marginTop: "3px", color: "var(--fg-dim)", fontSize: "12px" },
  },
  { dark: true },
);

const VFS_PATH_MIME = "application/x-vfs-path";

// Handle D&D from the file tree: insert the absolute path at the drop position.
const vfsPathDropHandler = EditorView.domEventHandlers({
  dragover(event) {
    if (!event.dataTransfer?.types.includes(VFS_PATH_MIME)) return false;
    event.preventDefault(); // allow drop
    event.dataTransfer.dropEffect = "copy";
    return true;
  },
  drop(event, view) {
    const path = event.dataTransfer?.getData(VFS_PATH_MIME);
    if (!path) return false;
    event.preventDefault();
    const pos =
      view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
    view.dispatch({
      changes: { from: pos, insert: path },
      selection: { anchor: pos + path.length },
    });
    view.focus();
    return true;
  },
});

export interface EditorHandle {
  view: EditorView;
  destroy(): void;
}

export function createEditor(opts: {
  parent: HTMLElement;
  doc: string;
  onChange: (text: string) => void;
  ctx: () => EditorContext;
}): EditorHandle {
  const state = EditorState.create({
    doc: opts.doc,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      drawSelection(),
      history(),
      yaml(),
      syntaxHighlighting(yamlHighlight),
      lintGutter(),
      schemaLinter(opts.ctx),
      brokenRefLinter(opts.ctx),
      schemaHover(opts.ctx),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      darkTheme,
      EditorView.lineWrapping,
      vfsPathDropHandler,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) opts.onChange(u.state.doc.toString());
      }),
    ],
  });
  const view = new EditorView({ state, parent: opts.parent });
  return { view, destroy: () => view.destroy() };
}
