import { EditorView } from '@codemirror/view';

/**
 * CodeMirror extension that enables the browser's native spellcheck.
 *
 * This sets `spellcheck="true"` and `autocorrect="on"` on the editor's
 * contenteditable element, giving free, instant spell checking with
 * the browser's built-in dictionary (red dotted underlines).
 *
 * Works in Chrome, Firefox, Safari, and Edge. The browser handles
 * the word dictionary, language detection, and underline rendering.
 */
export const browserSpellCheck = EditorView.contentAttributes.of({
  spellcheck: 'true',
  autocorrect: 'on',
  autocapitalize: 'on',
});
