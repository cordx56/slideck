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
import { DeckSchema, BaseSchema, schemaDocs } from "@slideck/core";
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

// Field types and alias expansions are generated from the zod schemas
// (schemaDocs); only the prose descriptions are kept here, keyed by YAML key.
// Descriptions are optional supplements; the type itself comes from the schema.
const DESCRIPTIONS: Record<string, string> = {
  bases:
    "Base layers, applied in declaration order. always:true applies to all slides; others via use:.",
  slides: "The slides of the deck.",
  use: "Base id(s) to apply to this slide (besides always:true bases). Does not change ordering.",
  elements: "Elements layered on top of the applied bases.",
  vars: "Values for the bases' schema.vars (referenced as ${name}).",
  id: "Identifier. For a base: referenced by use:. For a slide/element: optional id.",
  file: "Path to the base YAML file (relative to this file).",
  always: "If true, this base applies to every slide.",
  name: "Base name.",
  extends: "Parent base file to inherit from.",
  fonts: "Font key -> declaration. Reference the key in font:.",
  colors: "Color name -> value, injected as variables (use as ${name}).",
  slide: "Slide dimensions in px (logical coordinate system).",
  background: "Background color (${var} or literal).",
  defaults: "Default text style and inline link/code styles.",
  schema: "Variables this base accepts.",
  layout: "Base: element layout. Group: auto-layout direction.",
  path: "Font file path (.ttf / .ttc).",
  family: "Font family name for this declaration.",
  weight: "Font weight.",
  style: "Font style.",
  index: "Font index within a .ttc collection (default 0).",
  type: "Element type, or a schema variable type.",
  required: "Whether this variable must be provided.",
  default: "Default value when the variable is omitted.",
  values: "Allowed values for an enum-typed variable.",
  position: "Placement box. % / px, or 'center' for left/top.",
  flex: "Grow ratio along the main axis in an auto-layout group.",
  left: "Left edge ('center' centers horizontally).",
  right: "Right edge.",
  top: "Top edge ('center' centers vertically).",
  bottom: "Bottom edge.",
  width: "Width (or slide width under slide:).",
  height: "Height (or slide height under slide:).",
  text: "Text content. Inline markdown (**bold**, `code`, ~~del~~, [link](url)), math $...$, and per-run attributes ?[text](color=#hex) supported.",
  font: "Font key declared in fonts:.",
  size: "Font size in px.",
  color: "Text/fill color (${var} or literal).",
  align: "Text alignment, or auto-layout cross-axis alignment.",
  lineHeight: "Line height multiplier.",
  letterSpacing: "Letter spacing in px.",
  src: "Image path (relative to this file).",
  fit: "How the image fits its box. Default contain.",
  fill: "Fill color.",
  stroke: "Stroke color.",
  strokeWidth: "Stroke width in px.",
  rx: "Rectangle corner radius in px.",
  d: "SVG path data.",
  from: "Line start point (relative to the box).",
  to: "Line end point (relative to the box).",
  gap: "Gap between children in an auto-layout group/list. A % is of the slide (row: width, column: height); a number is px.",
  justify: "Auto-layout main-axis distribution.",
  padding:
    "Inner padding of a group/list. A % is of the slide (left/right: width, top/bottom: height); a number is px.",
  children: "Child elements of a group.",
  items: "List items of a ul/ol.",
  start: "Starting number of an ol.",
};

// Alias names (Element, Position, ...) come from the generated schema docs.
const ALIAS_RE = new RegExp(`\\b(${Object.keys(schemaDocs.aliases).join("|")})\\b`, "g");

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
    const key = text.slice(s, e);
    const type = schemaDocs.fields[key];
    const description = DESCRIPTIONS[key];
    if (!type && !description) return null;
    return {
      pos: line.from + s,
      end: line.from + e,
      above: true,
      create() {
        const dom = document.createElement("div");
        dom.className = "cm-schema-tooltip";

        // Panel that expands the definition of a hovered type alias.
        const expand = document.createElement("div");
        expand.className = "cm-schema-expand";
        expand.style.display = "none";
        const showAlias = (nm: string) => {
          expand.textContent = `${nm} = ${schemaDocs.aliases[nm]}`;
          expand.style.display = "block";
        };

        // Render "key: <type>" with alias names as hoverable tokens.
        const head = document.createElement("div");
        head.className = "cm-schema-head";
        head.append(document.createTextNode(`${key}: `));
        let last = 0;
        for (const m of (type ?? "").matchAll(ALIAS_RE)) {
          const idx = m.index ?? 0;
          if (idx > last) head.append(document.createTextNode((type ?? "").slice(last, idx)));
          const ref = document.createElement("span");
          ref.className = "cm-schema-ref";
          ref.textContent = m[1];
          ref.addEventListener("mouseenter", () => showAlias(m[1]));
          head.append(ref);
          last = idx + m[1].length;
        }
        if (type && last < type.length) head.append(document.createTextNode(type.slice(last)));

        dom.append(head);
        if (description) {
          const desc = document.createElement("div");
          desc.className = "cm-schema-desc";
          desc.textContent = description;
          dom.append(desc);
        }
        dom.append(expand);
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
    ".cm-schema-tooltip": { padding: "6px 9px", maxWidth: "460px", lineHeight: "1.45" },
    ".cm-schema-head": {
      color: "var(--accent)",
      fontWeight: "600",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    },
    ".cm-schema-ref": { textDecoration: "underline dotted", cursor: "help" },
    ".cm-schema-desc": { marginTop: "3px", color: "var(--fg-dim)", fontSize: "12px" },
    ".cm-schema-expand": {
      marginTop: "6px",
      paddingTop: "6px",
      borderTop: "1px solid var(--border)",
      whiteSpace: "pre-wrap",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: "12px",
      color: "var(--fg)",
    },
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
