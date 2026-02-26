import { describe, it, expect } from 'vitest';
import { extractArxivId, buildArxivBibtex } from './arxivService.js';

describe('extractArxivId', () => {
  it('returns empty string for falsy input', () => {
    expect(extractArxivId(null)).toBe('');
    expect(extractArxivId(undefined)).toBe('');
    expect(extractArxivId('')).toBe('');
  });

  it('extracts id from abs URL', () => {
    expect(extractArxivId('https://arxiv.org/abs/2301.07041')).toBe('2301.07041');
  });

  it('extracts id from pdf URL', () => {
    expect(extractArxivId('https://arxiv.org/pdf/2301.07041')).toBe('2301.07041');
  });

  it('strips .pdf suffix', () => {
    expect(extractArxivId('https://arxiv.org/pdf/2301.07041.pdf')).toBe('2301.07041');
  });

  it('strips version suffix', () => {
    expect(extractArxivId('2301.07041v3')).toBe('2301.07041');
  });

  it('handles plain id', () => {
    expect(extractArxivId('2301.07041')).toBe('2301.07041');
  });

  it('handles e-print URL', () => {
    expect(extractArxivId('https://arxiv.org/e-print/2301.07041')).toBe('2301.07041');
  });

  it('handles old-style ids with category prefix', () => {
    expect(extractArxivId('hep-ph/0512103')).toBe('hep-ph/0512103');
  });
});

describe('buildArxivBibtex', () => {
  it('returns empty string for null entry', () => {
    expect(buildArxivBibtex(null)).toBe('');
  });

  it('generates valid bibtex from entry', () => {
    const entry = {
      arxivId: '2301.07041',
      title: 'Some Paper Title',
      authors: ['Alice Smith', 'Bob Jones'],
      year: '2023',
    };
    const bib = buildArxivBibtex(entry);
    expect(bib).toContain('@article{arxiv:2301.07041');
    expect(bib).toContain('title={Some Paper Title}');
    expect(bib).toContain('author={Alice Smith and Bob Jones}');
    expect(bib).toContain('year={2023}');
  });

  it('defaults year to 2024 when missing', () => {
    const entry = { arxivId: '1234.5678', title: 'Test', authors: [], year: '' };
    expect(buildArxivBibtex(entry)).toContain('year={2024}');
  });
});
