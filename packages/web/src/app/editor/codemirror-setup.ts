import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
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
