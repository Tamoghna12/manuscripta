import { StateField, StateEffect, RangeSet } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';

export interface CommentThread {
  id: string;
  anchorFrom: number;
  anchorTo: number;
  anchorText: string;
  thread: {
    id: string;
    authorName: string;
    authorColor: string;
    content: string;
    createdAt: string;
  }[];
  resolved: boolean;
}

// Effect to set/update all comments
export const setCommentsEffect = StateEffect.define<CommentThread[]>();

// StateField that holds comment decorations
export const commentField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setCommentsEffect)) {
        const comments = e.value;
        const decorations: any[] = [];
        for (const c of comments) {
          if (c.anchorFrom >= 0 && c.anchorTo > c.anchorFrom && c.anchorTo <= tr.state.doc.length) {
            const cls = c.resolved ? 'cm-comment-resolved' : 'cm-comment-active';
            decorations.push(
              Decoration.mark({ class: cls, attributes: { 'data-comment-id': c.id } })
                .range(c.anchorFrom, c.anchorTo)
            );
          }
        }
        decorations.sort((a, b) => a.from - b.from || a.to - b.to);
        return RangeSet.of(decorations, true);
      }
    }
    return deco.map(tr.changes);
  },
  provide: f => EditorView.decorations.from(f),
});

// Base theme for comment highlights
export const commentTheme = EditorView.baseTheme({
  '.cm-comment-active': {
    backgroundColor: 'rgba(255, 235, 59, 0.3)',
    borderBottom: '2px solid #fdd835',
  },
  '.cm-comment-resolved': {
    backgroundColor: 'rgba(158, 158, 158, 0.15)',
    borderBottom: '1px dashed #9e9e9e',
  },
});
