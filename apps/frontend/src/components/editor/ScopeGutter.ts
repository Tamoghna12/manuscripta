import { StateField } from '@codemirror/state';
import { EditorView, gutter, GutterMarker } from '@codemirror/view';
import { computeEnvDepths } from '../../utils/latexUtils';

const SCOPE_COLORS = [
  'rgba(180, 74, 47, 0.5)',
  'rgba(59, 130, 186, 0.5)',
  'rgba(76, 159, 88, 0.5)',
  'rgba(180, 137, 47, 0.5)',
  'rgba(142, 68, 173, 0.5)',
  'rgba(211, 84, 0, 0.5)',
];

export const envDepthField = StateField.define<number[]>({
  create(state) {
    return computeEnvDepths(state.doc);
  },
  update(value, tr) {
    if (tr.docChanged) return computeEnvDepths(tr.state.doc);
    return value;
  },
});

class ScopeMarker extends GutterMarker {
  constructor(readonly depth: number) {
    super();
  }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-scope-marker';
    for (let i = 0; i < this.depth; i++) {
      const bar = document.createElement('span');
      bar.className = 'cm-scope-bar';
      bar.style.backgroundColor = SCOPE_COLORS[i % SCOPE_COLORS.length];
      wrap.appendChild(bar);
    }
    return wrap;
  }
}

export const scopeGutter = gutter({
  class: 'cm-scope-gutter',
  lineMarker(view, line) {
    const depths = view.state.field(envDepthField);
    const lineNo = view.state.doc.lineAt(line.from).number;
    const d = depths[lineNo - 1] || 0;
    return d > 0 ? new ScopeMarker(d) : null;
  },
});
