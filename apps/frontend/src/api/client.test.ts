import { describe, it, expect, beforeEach } from 'vitest';
import {
  setCollabToken,
  getCollabToken,
  clearCollabToken,
  setCollabServer,
  getCollabServer,
} from './client';

describe('collab token helpers', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('stores and retrieves a collab token', () => {
    setCollabToken('abc123');
    expect(getCollabToken()).toBe('abc123');
  });

  it('returns empty string when no token set', () => {
    expect(getCollabToken()).toBe('');
  });

  it('ignores empty token', () => {
    setCollabToken('real');
    setCollabToken('');
    expect(getCollabToken()).toBe('real');
  });

  it('clears the token', () => {
    setCollabToken('abc123');
    clearCollabToken();
    expect(getCollabToken()).toBe('');
  });
});

describe('collab server helpers', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('stores and retrieves a collab server', () => {
    setCollabServer('wss://example.com');
    expect(getCollabServer()).toBe('wss://example.com');
  });

  it('returns empty string when no server set', () => {
    expect(getCollabServer()).toBe('');
  });

  it('ignores empty server string', () => {
    setCollabServer('wss://a.com');
    setCollabServer('');
    expect(getCollabServer()).toBe('wss://a.com');
  });
});
