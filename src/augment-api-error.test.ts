import { describe, it, expect, vi, beforeEach } from 'vitest';

type UpstreamErrorEntry = {
  ts: number;
  code: string;
  url: string;
  phase: 'pre-header' | 'mid-stream' | 'idle-timeout';
};

const recent: UpstreamErrorEntry[] = [];

vi.mock('./credential-proxy.js', () => ({
  getRecentUpstreamErrors: (windowMs?: number) => {
    if (windowMs === undefined) return [...recent];
    const cutoff = Date.now() - windowMs;
    return recent.filter((e) => e.ts >= cutoff);
  },
  startCredentialProxy: vi.fn(),
}));

// index.ts has many imports, but none auto-initialise at import time
// (main() is gated by a direct-run check at the bottom).
import { augmentApiError } from './index.js';

describe('augmentApiError', () => {
  beforeEach(() => {
    recent.length = 0;
  });

  it('returns null for non-API-error text', () => {
    expect(augmentApiError('Hello world', undefined)).toBeNull();
    expect(augmentApiError('Pong! 🏓', undefined)).toBeNull();
    // Leading text before "API Error:" doesn't count
    expect(augmentApiError('Context: API Error: 502', undefined)).toBeNull();
  });

  it('rewrites with a proxy-side breakdown when upstream errors exist', () => {
    const now = Date.now();
    for (let i = 0; i < 17; i++) {
      recent.push({
        ts: now - 120_000 + i * 1000,
        code: 'ECONNRESET',
        url: '/v1/messages',
        phase: 'pre-header',
      });
    }
    const out = augmentApiError(
      'API Error: 502 Bad Gateway',
      '23f1c183-a761-4292-9593-c0ec213b3e57',
      now,
    );
    expect(out).not.toBeNull();
    expect(out).toContain('⚠️ API Error: 502 Bad Gateway');
    expect(out).toContain('17 connection errors');
    expect(out).toContain('17× ECONNRESET');
    expect(out).toContain('SDK retries exhausted');
    expect(out).toContain('_session: 23f1c183_');
  });

  it('explains upstream-response errors when no proxy errors exist', () => {
    const out = augmentApiError(
      'API Error: 529 Overloaded',
      'abcdef12-xxxx',
      Date.now(),
    );
    expect(out).not.toBeNull();
    expect(out).toContain('⚠️ API Error: 529 Overloaded');
    expect(out).toContain('No proxy-side connection errors');
    expect(out).toContain('529 came as a response from Anthropic');
    expect(out).toContain('_session: abcdef12_');
  });

  it('omits session line when sessionId is absent', () => {
    const out = augmentApiError(
      'API Error: 500 Internal Server Error',
      undefined,
      Date.now(),
    );
    expect(out).not.toBeNull();
    expect(out).not.toContain('_session:');
  });

  it('mixes multiple error codes in the breakdown', () => {
    const now = Date.now();
    recent.push(
      { ts: now - 30_000, code: 'ECONNRESET', url: '/a', phase: 'pre-header' },
      { ts: now - 20_000, code: 'ECONNRESET', url: '/b', phase: 'pre-header' },
      {
        ts: now - 10_000,
        code: 'IDLE_TIMEOUT',
        url: '/c',
        phase: 'idle-timeout',
      },
    );
    const out = augmentApiError('API Error: 502 Bad Gateway', undefined, now);
    expect(out).toContain('3 connection errors');
    // Sorted by count descending
    expect(out).toMatch(/2× ECONNRESET, 1× IDLE_TIMEOUT/);
  });

  it('ignores entries older than the 5-minute window', () => {
    const now = Date.now();
    recent.push(
      { ts: now - 600_000, code: 'ECONNRESET', url: '/a', phase: 'pre-header' },
      { ts: now - 10_000, code: 'ECONNRESET', url: '/b', phase: 'pre-header' },
    );
    const out = augmentApiError('API Error: 502 Bad Gateway', undefined, now);
    expect(out).toContain('1 connection error');
    expect(out).not.toContain('2 connection');
  });
});
