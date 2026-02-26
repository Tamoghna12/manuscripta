import { describe, it, expect } from 'vitest';
import {
  isFigureFile,
  isTextFile,
  isTextPath,
  getFileTypeLabel,
  getParentPath,
  buildTree,
  findTreeNode,
} from './fileUtils';

describe('isFigureFile', () => {
  it('returns true for image extensions', () => {
    expect(isFigureFile('fig.png')).toBe(true);
    expect(isFigureFile('photo.JPG')).toBe(true);
    expect(isFigureFile('diagram.svg')).toBe(true);
  });

  it('returns false for non-image files', () => {
    expect(isFigureFile('main.tex')).toBe(false);
    expect(isFigureFile('refs.bib')).toBe(false);
  });
});

describe('isTextFile / isTextPath', () => {
  it('recognizes tex and bib as text', () => {
    expect(isTextFile('main.tex')).toBe(true);
    expect(isTextPath('refs.bib')).toBe(true);
  });

  it('recognizes style files as text', () => {
    expect(isTextFile('custom.sty')).toBe(true);
    expect(isTextFile('article.cls')).toBe(true);
  });

  it('rejects binary files', () => {
    expect(isTextFile('image.png')).toBe(false);
  });
});

describe('getFileTypeLabel', () => {
  it('returns correct labels', () => {
    expect(getFileTypeLabel('main.tex')).toBe('TEX');
    expect(getFileTypeLabel('refs.bib')).toBe('BIB');
    expect(getFileTypeLabel('image.png')).toBe('PNG');
    expect(getFileTypeLabel('unknown.xyz')).toBe('FILE');
  });
});

describe('getParentPath', () => {
  it('returns parent directory', () => {
    expect(getParentPath('chapters/intro.tex')).toBe('chapters');
  });

  it('returns empty for root-level files', () => {
    expect(getParentPath('main.tex')).toBe('');
  });

  it('returns empty for empty input', () => {
    expect(getParentPath('')).toBe('');
  });
});

describe('buildTree', () => {
  it('builds a tree from flat items', () => {
    const items = [
      { path: 'main.tex', type: 'file' },
      { path: 'chapters', type: 'dir' },
      { path: 'chapters/intro.tex', type: 'file' },
    ];
    const root = buildTree(items);
    expect(root.children).toHaveLength(2);
    const chaptersNode = root.children.find((n) => n.name === 'chapters');
    expect(chaptersNode?.children).toHaveLength(1);
    expect(chaptersNode?.children[0].name).toBe('intro.tex');
  });

  it('sorts directories before files', () => {
    const items = [
      { path: 'z.tex', type: 'file' },
      { path: 'a-dir', type: 'dir' },
    ];
    const root = buildTree(items);
    expect(root.children[0].name).toBe('a-dir');
    expect(root.children[1].name).toBe('z.tex');
  });
});

describe('findTreeNode', () => {
  it('finds a node by path', () => {
    const items = [
      { path: 'chapters', type: 'dir' },
      { path: 'chapters/intro.tex', type: 'file' },
    ];
    const root = buildTree(items);
    const node = findTreeNode(root, 'chapters/intro.tex');
    expect(node?.name).toBe('intro.tex');
  });

  it('returns null for non-existent path', () => {
    const root = buildTree([]);
    expect(findTreeNode(root, 'missing.tex')).toBeNull();
  });
});
