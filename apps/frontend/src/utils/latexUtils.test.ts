import { describe, it, expect } from 'vitest';
import {
  stripLatexComment,
  stripLineComment,
  parseOutline,
  extractIncludeTargets,
  findNearestHeading,
  findLineOffset,
  replaceSelection,
} from './latexUtils';

describe('stripLatexComment', () => {
  it('strips a % comment', () => {
    expect(stripLatexComment('hello % world')).toBe('hello ');
  });

  it('does not strip escaped %', () => {
    expect(stripLatexComment('100\\% done')).toBe('100\\% done');
  });

  it('returns full string when no comment', () => {
    expect(stripLatexComment('no comment here')).toBe('no comment here');
  });
});

describe('stripLineComment', () => {
  it('strips inline comment', () => {
    expect(stripLineComment('text % comment')).toBe('text ');
  });

  it('ignores escaped percent', () => {
    expect(stripLineComment('50\\% off')).toBe('50\\% off');
  });
});

describe('parseOutline', () => {
  it('extracts sections from LaTeX', () => {
    const text = '\\section{Intro}\nSome text\n\\subsection{Background}\n\\subsubsection{Detail}';
    const items = parseOutline(text);
    expect(items).toHaveLength(3);
    expect(items[0].title).toBe('Intro');
    expect(items[0].level).toBe(1);
    expect(items[1].title).toBe('Background');
    expect(items[1].level).toBe(2);
    expect(items[2].title).toBe('Detail');
    expect(items[2].level).toBe(3);
  });

  it('handles starred sections', () => {
    const items = parseOutline('\\section*{Acknowledgments}');
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Acknowledgments');
  });

  it('returns empty for plain text', () => {
    expect(parseOutline('just plain text')).toHaveLength(0);
  });
});

describe('extractIncludeTargets', () => {
  it('finds \\input and \\include', () => {
    const text = '\\input{chapters/intro}\n\\include{chapters/methods}';
    const targets = extractIncludeTargets(text);
    expect(targets).toEqual(['chapters/intro', 'chapters/methods']);
  });

  it('ignores commented includes', () => {
    const text = '% \\input{hidden}\n\\input{visible}';
    const targets = extractIncludeTargets(text);
    expect(targets).toEqual(['visible']);
  });
});

describe('findNearestHeading', () => {
  it('finds the nearest heading before cursor', () => {
    const text = '\\section{A}\nline1\n\\subsection{B}\nline2\nline3';
    const result = findNearestHeading(text, text.length);
    expect(result?.title).toBe('B');
    expect(result?.level).toBe('subsection');
  });

  it('returns null when no heading', () => {
    expect(findNearestHeading('no headings', 5)).toBeNull();
  });
});

describe('findLineOffset', () => {
  it('returns 0 for line 1', () => {
    expect(findLineOffset('abc\ndef\nghi', 1)).toBe(0);
  });

  it('returns correct offset for line 2', () => {
    expect(findLineOffset('abc\ndef\nghi', 2)).toBe(4);
  });

  it('returns correct offset for line 3', () => {
    expect(findLineOffset('abc\ndef\nghi', 3)).toBe(8);
  });
});

describe('replaceSelection', () => {
  it('replaces a range', () => {
    expect(replaceSelection('hello world', 6, 11, 'there')).toBe('hello there');
  });

  it('handles insertion at start', () => {
    expect(replaceSelection('world', 0, 0, 'hello ')).toBe('hello world');
  });
});
