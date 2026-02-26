import { EditorView } from '@codemirror/view';

export const editorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      background: 'transparent',
    },
    '.cm-scroller': {
      fontFamily: '"JetBrains Mono", "SF Mono", "Menlo", monospace',
      fontSize: 'var(--editor-font-size, 11px)',
      lineHeight: '1.6',
    },
    '.cm-content': {
      padding: '16px',
    },
    '.cm-gutters': {
      background: 'transparent',
      border: 'none',
      color: 'rgba(122, 111, 103, 0.6)',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 8px 0 12px',
    },
    '.cm-activeLine': {
      background: 'rgba(180, 74, 47, 0.08)',
    },
    '.cm-activeLineGutter': {
      background: 'transparent',
    },
    '.cm-selectionBackground': {
      background: 'rgba(180, 74, 47, 0.18)',
    },
  },
  { dark: false },
);
