import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { countNight } from '../src/digest/counts.js';

describe('countNight', () => {
  it('counts run lines by status and the bad line', () => {
    const c = countNight('runs', '2026-10-28');
    const lines = readFileSync('runs/2026-10-28.jsonl', 'utf8').split('\n').filter((l) => l.trim() !== '');
    expect(c).not.toBeNull();
    expect(c!.bad).toBe(1);
    expect(c!.ok + c!.retry + c!.fail + c!.bad).toBe(lines.length);
    expect(c!.ok).toBeGreaterThan(0);
  });

  it('is null for a night with no file', () => {
    expect(countNight('runs', '2000-01-01')).toBeNull();
  });
});
