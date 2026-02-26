import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  issueSessionToken,
  verifySessionToken,
} from './userService.js';

// Test session token functions (these are pure crypto, no file I/O needed)

describe('issueSessionToken / verifySessionToken', () => {
  it('issues a valid token and verifies it', () => {
    const token = issueSessionToken({ userId: 'u1', username: 'alice', role: 'admin' });
    expect(token).toMatch(/^ms1\./);
    const payload = verifySessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload.userId).toBe('u1');
    expect(payload.username).toBe('alice');
    expect(payload.role).toBe('admin');
  });

  it('returns null for tampered token', () => {
    const token = issueSessionToken({ userId: 'u1', username: 'alice' });
    const tampered = token.slice(0, -3) + 'xxx';
    expect(verifySessionToken(tampered)).toBeNull();
  });

  it('returns null for empty/null input', () => {
    expect(verifySessionToken(null)).toBeNull();
    expect(verifySessionToken('')).toBeNull();
    expect(verifySessionToken(123)).toBeNull();
  });

  it('returns null for malformed token', () => {
    expect(verifySessionToken('not.a.valid.token')).toBeNull();
    expect(verifySessionToken('ms1.abc')).toBeNull();
    expect(verifySessionToken('ms2.abc.def')).toBeNull();
  });

  it('defaults role to user', () => {
    const token = issueSessionToken({ userId: 'u2', username: 'bob' });
    const payload = verifySessionToken(token);
    expect(payload.role).toBe('user');
  });
});
