import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { PostgreSQL, SQLite, sql, type SQLNamespace } from "@codemirror/lang-sql";
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import type { SqlCompletionTable, SqlEngine } from "@t3tools/contracts";
import { useEffect, useMemo, useRef } from "react";

export interface SqlEditorProps {
  readonly initialValue: string;
  readonly engine: SqlEngine;
  readonly tables: ReadonlyArray<SqlCompletionTable> | null;
  readonly defaultSchema: string | null;
  readonly vimMode: boolean;
  readonly onChange: (value: string) => void;
  /** ⌘/Ctrl+Enter — run the current editor contents. */
  readonly onRun: (sql: string) => void;
  readonly className?: string;
}

function toCompletionSchema(tables: ReadonlyArray<SqlCompletionTable>): SQLNamespace {
  const schema: Record<string, string[]> = {};
  for (const table of tables) {
    const qualified = table.schema === null ? table.name : `${table.schema}.${table.name}`;
    schema[qualified] = [...table.columns];
  }
  return schema;
}

const editorTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "12px" },
  ".cm-content": { fontFamily: "var(--font-mono, monospace)" },
  ".cm-scroller": { fontFamily: "var(--font-mono, monospace)", overflow: "auto" },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": { background: "transparent", border: "none" },
});

/**
 * CodeMirror 6 SQL editor with schema-aware autocomplete and an optional vim
 * mode. The component is uncontrolled: it seeds `initialValue` once and
 * reports changes upward; external state never rewrites the document.
 */
export function SqlEditor({
  initialValue,
  engine,
  tables,
  defaultSchema,
  vimMode,
  onChange,
  onRun,
  className,
}: SqlEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const compartmentsRef = useRef({ language: new Compartment(), vim: new Compartment() });
  const callbacksRef = useRef({ onChange, onRun });
  callbacksRef.current = { onChange, onRun };

  const languageExtension = useMemo(() => {
    const dialect = engine === "postgres" ? PostgreSQL : SQLite;
    return sql({
      dialect,
      ...(tables === null ? {} : { schema: toCompletionSchema(tables) }),
      ...(defaultSchema === null ? {} : { defaultSchema }),
      upperCaseKeywords: true,
    });
  }, [engine, tables, defaultSchema]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const compartments = compartmentsRef.current;
    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          // Vim must load before other keymaps to own the base key handling.
          compartments.vim.of(vimMode ? vim() : []),
          Prec.highest(
            keymap.of([
              {
                key: "Mod-Enter",
                run: (target) => {
                  callbacksRef.current.onRun(target.state.doc.toString());
                  return true;
                },
              },
              { key: "Tab", run: acceptCompletion },
            ]),
          ),
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          compartments.language.of(languageExtension),
          placeholder("SELECT …  (⌘⏎ runs the query)"),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              callbacksRef.current.onChange(update.state.doc.toString());
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
    // The editor is created once per mount; live updates flow via compartments.
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    view.dispatch({
      effects: compartmentsRef.current.language.reconfigure(languageExtension),
    });
  }, [languageExtension]);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    view.dispatch({
      effects: compartmentsRef.current.vim.reconfigure(vimMode ? vim() : []),
    });
  }, [vimMode]);

  return <div ref={containerRef} className={className} data-sql-editor />;
}
