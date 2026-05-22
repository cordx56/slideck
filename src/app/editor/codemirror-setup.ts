import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
} from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { yaml } from "@codemirror/lang-yaml";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import { DeckSchema } from "../../schema";
import { parseAndValidate } from "../../load/parse";

// deck.yaml を YAML 構文 + DeckSchema で検証し、CodeMirror 診断に変換する。
// 変数型や未知テーマ等の意味エラーは別途ストア側に出る (テーマ文脈が必要なため)。
const deckLinter = linter((view): Diagnostic[] => {
  const text = view.state.doc.toString();
  const len = text.length;
  const { errors } = parseAndValidate(text, DeckSchema, "deck.yaml");
  const diags: Diagnostic[] = [];
  for (const e of errors) {
    const off = e.pos?.offset;
    if (!off) continue;
    let from = Math.max(0, Math.min(off[0], len));
    let to = Math.max(from, Math.min(off[1], len));
    if (to <= from) to = Math.min(len, from + 1);
    diags.push({ from, to, severity: "error", message: e.message });
  }
  return diags;
});

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
    ".cm-activeLine": { background: "rgba(122,162,247,0.07)" },
    ".cm-activeLineGutter": { background: "rgba(122,162,247,0.1)" },
    ".cm-content": { caretColor: "var(--accent)" },
  },
  { dark: true },
);

export interface EditorHandle {
  view: EditorView;
  destroy(): void;
}

export function createEditor(opts: {
  parent: HTMLElement;
  doc: string;
  onChange: (text: string) => void;
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
      lintGutter(),
      deckLinter,
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      darkTheme,
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) opts.onChange(u.state.doc.toString());
      }),
    ],
  });
  const view = new EditorView({ state, parent: opts.parent });
  return { view, destroy: () => view.destroy() };
}
