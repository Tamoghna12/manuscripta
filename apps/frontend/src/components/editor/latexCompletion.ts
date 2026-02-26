import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { BibEntry } from '../../utils/bibParser';

export function latexCompletionSource(context: CompletionContext) {
  const before = context.matchBefore(/[\\/][A-Za-z]*$/);
  if (!before) return null;
  const prev =
    before.from > 0 ? context.state.doc.sliceString(before.from - 1, before.from) : ' ';
  if (prev && !/[\s({\n]/.test(prev)) return null;
  if (before.text.startsWith('/') && prev === ':') return null;
  const options = [
    {
      label: '\\section{}',
      type: 'keyword',
      apply: (view: any, _completion: any, from: number, to: number) => {
        view.dispatch({
          changes: { from, to, insert: '\\section{}' },
          selection: { anchor: from + '\\section{'.length },
        });
      },
    },
    {
      label: '\\subsection{}',
      type: 'keyword',
      apply: (view: any, _completion: any, from: number, to: number) => {
        view.dispatch({
          changes: { from, to, insert: '\\subsection{}' },
          selection: { anchor: from + '\\subsection{'.length },
        });
      },
    },
    {
      label: '\\subsubsection{}',
      type: 'keyword',
      apply: (view: any, _completion: any, from: number, to: number) => {
        view.dispatch({
          changes: { from, to, insert: '\\subsubsection{}' },
          selection: { anchor: from + '\\subsubsection{'.length },
        });
      },
    },
    {
      label: '\\paragraph{}',
      type: 'keyword',
      apply: (view: any, _completion: any, from: number, to: number) => {
        view.dispatch({
          changes: { from, to, insert: '\\paragraph{}' },
          selection: { anchor: from + '\\paragraph{'.length },
        });
      },
    },
    {
      label: '\\cite{}',
      type: 'keyword',
      apply: (view: any, _completion: any, from: number, to: number) => {
        view.dispatch({
          changes: { from, to, insert: '\\cite{}' },
          selection: { anchor: from + '\\cite{'.length },
        });
      },
    },
    {
      label: '\\ref{}',
      type: 'keyword',
      apply: (view: any, _completion: any, from: number, to: number) => {
        view.dispatch({
          changes: { from, to, insert: '\\ref{}' },
          selection: { anchor: from + '\\ref{'.length },
        });
      },
    },
    {
      label: '\\label{}',
      type: 'keyword',
      apply: (view: any, _completion: any, from: number, to: number) => {
        view.dispatch({
          changes: { from, to, insert: '\\label{}' },
          selection: { anchor: from + '\\label{'.length },
        });
      },
    },
    {
      label: '\\begin{itemize}',
      type: 'keyword',
      apply: '\\begin{itemize}\n\\item \n\\end{itemize}',
    },
    {
      label: '\\begin{enumerate}',
      type: 'keyword',
      apply: '\\begin{enumerate}\n\\item \n\\end{enumerate}',
    },
    {
      label: '\\begin{figure}',
      type: 'keyword',
      apply:
        '\\begin{figure}[t]\n\\centering\n\\includegraphics[width=0.9\\linewidth]{}\n\\caption{}\n\\label{}\n\\end{figure}',
    },
    {
      label: '\\begin{table}',
      type: 'keyword',
      apply:
        '\\begin{table}[t]\n\\centering\n\\begin{tabular}{}\n\\end{tabular}\n\\caption{}\n\\label{}\n\\end{table}',
    },
  ];
  return {
    from: before.from,
    options,
    validFor: /^[\\/][A-Za-z]*$/,
  };
}

/**
 * Creates a completion source that suggests citation keys inside \cite{}, \citep{}, \citet{} etc.
 * Uses a RefObject so the entries can update without recreating the extension.
 */
export function createCiteKeyCompletion(
  bibEntriesRef: { current: BibEntry[] },
) {
  return function citeKeyCompletionSource(context: CompletionContext): CompletionResult | null {
    const pos = context.pos;
    const line = context.state.doc.lineAt(pos);
    const textBefore = line.text.slice(0, pos - line.from);

    // Find the nearest \cite..{ before cursor
    const citeMatch = textBefore.match(/\\cite[pt]?\{([^}]*)$/);
    if (!citeMatch) return null;

    // The partial text after the last comma (or after the opening brace)
    const inside = citeMatch[1];
    const lastComma = inside.lastIndexOf(',');
    const partial = lastComma >= 0 ? inside.slice(lastComma + 1).trim() : inside.trim();
    const from = pos - partial.length;

    const entries = bibEntriesRef.current;
    if (!entries.length) return null;

    const formatAuthors = (author: string) => {
      if (!author) return '';
      const parts = author.split(/\s+and\s+/i);
      if (parts.length <= 2) return author;
      return `${parts[0].trim()} et al.`;
    };

    const options = entries.map((e) => ({
      label: e.key,
      type: 'text' as const,
      detail: [formatAuthors(e.author), e.year].filter(Boolean).join(', '),
      info: e.title || undefined,
      boost: e.key.toLowerCase().startsWith(partial.toLowerCase()) ? 1 : 0,
    }));

    return {
      from,
      options,
      validFor: /^[A-Za-z0-9_:.\-/]*$/,
    };
  };
}
