import { StateField, StateEffect, RangeSet } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';

export interface TrackedChange {
  id: string;
  type: 'insert' | 'delete';
  from: number;
  to: number;
  text: string;
  author: string;
  color: string;
  timestamp: string;
}

// Effect to set all tracked changes
export const setTrackedChangesEffect = StateEffect.define<TrackedChange[]>();

// StateField for track changes decorations
export const trackChangesField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setTrackedChangesEffect)) {
        const changes = e.value;
        const decorations: any[] = [];
        for (const c of changes) {
          if (c.from >= 0 && c.to > c.from && c.to <= tr.state.doc.length) {
            const cls = c.type === 'insert' ? 'cm-track-insert' : 'cm-track-delete';
            decorations.push(
              Decoration.mark({
                class: cls,
                attributes: {
                  'data-track-id': c.id,
                  'data-track-author': c.author,
                  title: `${c.type === 'insert' ? 'Inserted' : 'Deleted'} by ${c.author}`,
                },
              }).range(c.from, c.to)
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

// Base theme for track changes
export const trackChangesTheme = EditorView.baseTheme({
  '.cm-track-insert': {
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    borderBottom: '2px solid #22c55e',
  },
  '.cm-track-delete': {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    textDecoration: 'line-through',
    color: '#ef4444',
  },
});
