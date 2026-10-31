import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { DigestRow, RunStatus } from '../src/digest/types.js';

type DigestJson = { night: string; rows: DigestRow[]; badLines: number };
type ErrorJson = { error: string };

const GOOD = '2026-10-30';
const EMPTY = '2026-10-29';
const BAD = '2026-10-28';
const MISSING = '2026-10-01';

const line = (at: string, job: string, status: RunStatus, owner: string | null = 'rook', error?: string): string =>
  JSON.stringify({ at, job, status, owner, ...(error !== undefined ? { error } : {}) });

// Fixture nights live in a temp dir; runs/ is never touched.
let runsDir: string;
let config: RigConfig;

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  config = {
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  };

  writeFileSync(
    join(runsDir, `${GOOD}.jsonl`),
    [
      line('2026-10-30T23:00:02+01:00', 'rig/rotate-logs', 'ok', 'lane-07'),
      line('2026-10-30T23:10:00+01:00', 'lane/sync', 'retry'),
      line('2026-10-30T23:11:00+01:00', 'lane/sync', 'retry'),
      line('2026-10-30T23:12:00+01:00', 'lane/sync', 'retry'),
      line('2026-10-30T23:13:00+01:00', 'lane/sync', 'ok'),
      line('2026-10-30T23:20:00+01:00', 'notes/backup', 'fail', null, 'quota exceeded'),
      line('2026-10-30T23:30:00+01:00', 'digest/render', 'ok', null),
      '',
    ].join('\n'),
  );

  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');

  writeFileSync(
    join(runsDir, `${BAD}.jsonl`),
    [
      line('2026-10-28T23:00:02+01:00', 'lane/sync', 'ok'),
      'this is not json',
      line('2026-10-28T23:05:00+01:00', 'notes/backup', 'ok'),
      '',
    ].join('\n'),
  );
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

describe('GET /digest/:night', () => {
  it('200 for a night with runs, one table with a row per job', async () => {
    const res = await createApp(config).request(`/digest/${GOOD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(html).toContain('digest/render');
    expect(html).toContain('lane/sync');
    expect(html).toContain('notes/backup');
    expect(html).toContain('rig/rotate-logs');
  });

  it('404 for a night with no file', async () => {
    const res = await createApp(config).request(`/digest/${MISSING}`);
    expect(res.status).toBe(404);
  });

  it('empty night renders "nothing ran"', async () => {
    const res = await createApp(config).request(`/digest/${EMPTY}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
  });

  it('bad-line night still renders its valid rows', async () => {
    const res = await createApp(config).request(`/digest/${BAD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('lane/sync');
    expect(html).toContain('notes/backup');
  });
});

describe('GET /api/digest/:night', () => {
  it('200 with { night, rows, badLines } for a good night', async () => {
    const res = await createApp(config).request(`/api/digest/${GOOD}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestJson;
    expect(body.night).toBe(GOOD);
    expect(body.badLines).toBe(0);
    expect(body.rows.map((r) => r.job)).toEqual(['digest/render', 'lane/sync', 'notes/backup', 'rig/rotate-logs']);
    expect(body.rows.find((r) => r.job === 'lane/sync')).toMatchObject({ runs: 4, retries: 3, lastStatus: 'ok' });
    expect(body.rows.find((r) => r.job === 'notes/backup')).toMatchObject({
      lastStatus: 'fail',
      lastError: 'quota exceeded',
    });
  });

  it('404 with { error } for a night with no file', async () => {
    const res = await createApp(config).request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorJson;
    expect(typeof body.error).toBe('string');
  });

  it('empty night is 200 with rows []', async () => {
    const res = await createApp(config).request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestJson;
    expect(body.rows).toEqual([]);
    expect(body.badLines).toBe(0);
  });

  it('bad-line night is 200, counts the bad line, keeps valid rows', async () => {
    const res = await createApp(config).request(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestJson;
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['lane/sync', 'notes/backup']);
  });
});

describe('page and JSON agree', () => {
  it('list the same jobs in the same order for every night with rows', async () => {
    for (const night of [GOOD, BAD]) {
      const app = createApp(config);
      const json = (await (await app.request(`/api/digest/${night}`)).json()) as DigestJson;
      const html = await (await app.request(`/digest/${night}`)).text();

      const positions = json.rows.map((r) => html.indexOf(r.job));
      for (const pos of positions) expect(pos).toBeGreaterThan(-1);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });
});
