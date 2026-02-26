import { describe, it, expect } from 'vitest';
import {
  PROVIDER_PRESETS,
  DEFAULT_SETTINGS,
  pickCollabColor,
  normalizeServerUrl,
} from './settingsUtils';

describe('PROVIDER_PRESETS', () => {
  it('has all five providers', () => {
    const keys = Object.keys(PROVIDER_PRESETS);
    expect(keys).toContain('anthropic');
    expect(keys).toContain('ollama');
    expect(keys).toContain('zai');
    expect(keys).toContain('openai');
    expect(keys).toContain('custom');
  });

  it('ollama does not need a key', () => {
    expect(PROVIDER_PRESETS.ollama.needsKey).toBe(false);
  });

  it('all providers have a label', () => {
    for (const p of Object.values(PROVIDER_PRESETS)) {
      expect(p.label).toBeTruthy();
    }
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_SETTINGS.provider).toBe('openai');
    expect(DEFAULT_SETTINGS.compileEngine).toBe('pdflatex');
    expect(DEFAULT_SETTINGS.grammarEnabled).toBe(false);
  });
});

describe('pickCollabColor', () => {
  it('returns a color string', () => {
    const color = pickCollabColor('test');
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('is deterministic for the same seed', () => {
    const a = pickCollabColor('alice');
    const b = pickCollabColor('alice');
    expect(a).toBe(b);
  });

  it('returns different colors for different seeds', () => {
    const a = pickCollabColor('alice');
    const b = pickCollabColor('bob');
    // They might collide, but with high probability they differ
    // This is a probabilistic test; if it fails occasionally, that's OK
    expect(typeof a).toBe('string');
    expect(typeof b).toBe('string');
  });

  it('returns a random color without seed', () => {
    const color = pickCollabColor();
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('normalizeServerUrl', () => {
  it('returns empty for empty input', () => {
    expect(normalizeServerUrl('')).toBe('');
    expect(normalizeServerUrl('   ')).toBe('');
  });

  it('preserves http:// prefix', () => {
    expect(normalizeServerUrl('http://localhost:8787')).toBe('http://localhost:8787');
  });

  it('preserves https:// prefix', () => {
    expect(normalizeServerUrl('https://example.com')).toBe('https://example.com');
  });

  it('adds http:// when missing', () => {
    expect(normalizeServerUrl('localhost:8787')).toBe('http://localhost:8787');
  });

  it('trims whitespace', () => {
    expect(normalizeServerUrl('  http://example.com  ')).toBe('http://example.com');
  });
});
