import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, hoverTooltip } from '@codemirror/view';

export interface GrammarMark {
  from: number;
  to: number;
  original: string;
  replacement: string;
  category: string;
  severity: 'error' | 'warning' | 'suggestion';
  explanation: string;
}

export const setGrammarMarks = StateEffect.define<GrammarMark[]>();

export const grammarField = StateField.define<{ marks: GrammarMark[]; decos: DecorationSet }>({
  create() {
    return { marks: [], decos: Decoration.none };
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGrammarMarks)) {
        const marks = effect.value;
        const decos = Decoration.set(
          marks
            .filter((m) => m.from >= 0 && m.to <= tr.state.doc.length && m.from < m.to)
            .map((m) => {
              const cls =
                m.severity === 'error'
                  ? 'cm-grammar-error'
                  : m.severity === 'warning'
                    ? 'cm-grammar-warning'
                    : 'cm-grammar-suggestion';
              return Decoration.mark({
                class: cls,
                attributes: { 'data-grammar': 'true' },
              }).range(m.from, m.to);
            })
            .sort((a, b) => a.from - b.from),
          true,
        );
        return { marks, decos };
      }
    }
    if (tr.docChanged) {
      return { marks: [], decos: Decoration.none };
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field, (val) => val.decos),
});

export function grammarTooltip(getFixCallback: (mark: GrammarMark) => void) {
  return hoverTooltip(
    (view, pos) => {
      const { marks } = view.state.field(grammarField);
      const mark = marks.find((m) => pos >= m.from && pos <= m.to);
      if (!mark) return null;
      return {
        pos: mark.from,
        end: mark.to,
        above: true,
        create() {
          const dom = document.createElement('div');
          dom.className = 'cm-grammar-tooltip';

          const badge = document.createElement('span');
          badge.className = `grammar-badge grammar-badge-${mark.severity}`;
          badge.textContent = mark.severity;
          dom.appendChild(badge);

          const cat = document.createElement('span');
          cat.className = 'grammar-tooltip-cat';
          cat.textContent = ` ${mark.category}`;
          dom.appendChild(cat);

          if (mark.explanation) {
            const exp = document.createElement('div');
            exp.className = 'grammar-tooltip-explain';
            exp.textContent = mark.explanation;
            dom.appendChild(exp);
          }

          const row = document.createElement('div');
          row.className = 'grammar-tooltip-fix-row';

          const orig = document.createElement('span');
          orig.className = 'grammar-original';
          orig.textContent = mark.original;
          row.appendChild(orig);

          const arrow = document.createElement('span');
          arrow.textContent = ' → ';
          arrow.className = 'grammar-arrow';
          row.appendChild(arrow);

          const repl = document.createElement('span');
          repl.className = 'grammar-replacement';
          repl.textContent = mark.replacement;
          row.appendChild(repl);

          dom.appendChild(row);

          const btn = document.createElement('button');
          btn.className = 'grammar-tooltip-btn';
          btn.textContent = 'Apply Fix';
          btn.onclick = () => {
            getFixCallback(mark);
          };
          dom.appendChild(btn);

          return { dom };
        },
      };
    },
    { hoverTime: 300 },
  );
}
