import { useEffect, useRef } from "react";
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
  type DecorationSet,
} from "@codemirror/view";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import type { Confidence } from "../compiler/mappingResolver.ts";
import type { SourceRange } from "../types/diagnostics.ts";

export interface SourceHighlight {
  range: SourceRange;
  confidence: Confidence;
  active: boolean;
}

interface Props {
  initialDoc: string;
  onChange: (doc: string) => void;
  onCursorOffset: (offset: number) => void;
  onHoverOffset: (offset: number | null) => void;
  onClickOffset: (offset: number) => void;
  highlights: SourceHighlight[];
}

const setHighlights = StateEffect.define<SourceHighlight[]>();

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    decorations = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setHighlights) || !Array.isArray(effect.value)) continue;
      const ranges = effect.value.flatMap(({ range, confidence, active }) => {
        if (range.from >= range.to || range.from < 0 || range.to > transaction.state.doc.length) return [];
        const classes = ["source-map-range", confidence === "low" ? "source-map-low" : ""];
        if (active) classes.push("source-map-active");
        return [Decoration.mark({ class: classes.filter(Boolean).join(" ") }).range(range.from, range.to)];
      });
      decorations = Decoration.set(ranges, true);
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

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

export function SourceEditor({
  initialDoc,
  onChange,
  onCursorOffset,
  onHoverOffset,
  onClickOffset,
  highlights,
}: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onCursorOffset, onHoverOffset, onClickOffset });
  callbacks.current = { onChange, onCursorOffset, onHoverOffset, onClickOffset };
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
          highlightField,
          EditorView.lineWrapping,
          placeholder("Enter a program. Pseudocode, invented notation and mixed syntax are valid."),
          theme,
          EditorView.domEventHandlers({
            mousemove: (event, editorView) => {
              const offset = editorView.posAtCoords({ x: event.clientX, y: event.clientY });
              callbacks.current.onHoverOffset(offset);
              return false;
            },
            mouseleave: () => {
              callbacks.current.onHoverOffset(null);
              return false;
            },
            click: (event, editorView) => {
              const offset = editorView.posAtCoords({ x: event.clientX, y: event.clientY });
              if (offset !== null) callbacks.current.onClickOffset(offset);
              return false;
            },
          }),
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
    viewRef.current = view;

    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setHighlights.of(highlights) });
  }, [highlights]);

  return <div className="editor-host" ref={host} />;
}
