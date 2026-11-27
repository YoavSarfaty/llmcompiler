import { useEffect, useRef } from "react";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";

interface Props {
  initialDoc: string;
  onChange: (doc: string) => void;
  onCursorOffset: (offset: number) => void;
}

const theme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    backgroundColor: "#0f1117",
    color: "#d7dce5",
  },
  ".cm-content": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    padding: "8px 0",
    caretColor: "#7aa2f7",
  },
  ".cm-gutters": {
    backgroundColor: "#0b0d12",
    color: "#4b5263",
    border: "none",
  },
  ".cm-activeLine": { backgroundColor: "#161a24" },
  ".cm-activeLineGutter": { backgroundColor: "#161a24", color: "#9aa5b8" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "#243049" },
});

export function SourceEditor({ initialDoc, onChange, onCursorOffset }: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const callbacks = useRef({ onChange, onCursorOffset });
  callbacks.current = { onChange, onCursorOffset };
  const initial = useRef(initialDoc);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initial.current,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          placeholder("Enter a program. Pseudocode, invented notation and mixed syntax are valid."),
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              callbacks.current.onChange(update.state.doc.toString());
            }
            if (update.selectionSet || update.docChanged) {
              callbacks.current.onCursorOffset(update.state.selection.main.head);
            }
          }),
        ],
      }),
    });

    return () => view.destroy();
  }, []);

  return <div className="editor-host" ref={host} />;
}
