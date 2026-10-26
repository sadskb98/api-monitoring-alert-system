import { describe, expect, it, vi } from 'vitest';
import { USAGE, isConfirmation, parseArgs, runReset } from '../../src/cli/db-reset.js';
import { Alert } from '../../src/models/Alert.js';
import { Batch } from '../../src/models/Batch.js';
import { useTestDb } from '../db.js';
import { SPEC_EXAMPLE } from '../fixtures.js';
import { runBatch } from '../pipeline.js';

useTestDb();

function sink() {
  let data = '';
  return {
    write: (chunk) => (data += chunk),
    get text() {
      return data;
    },
  };
}

async function seed() {
  await runBatch(SPEC_EXAMPLE);
  await Batch.create({ source: 'http', received: 2, accepted: 2, rejected: 0, findings: 1 });
}

async function counts() {
  return { alerts: await Alert.countDocuments(), batches: await Batch.countDocuments() };
}

function reset(options) {
  const stdout = sink();
  const stderr = sink();
  const run = runReset({ env: 'development', yes: false, confirm: vi.fn(), stdout, stderr, ...options });
  return { run, stdout, stderr };
}

describe('parseArgs / isConfirmation', () => {
  it('accepts no arguments or --yes / -y only', () => {
    expect(parseArgs([])).toEqual({ yes: false });
    expect(parseArgs(['--yes'])).toEqual({ yes: true });
    expect(parseArgs(['-y'])).toEqual({ yes: true });
    expect(parseArgs(['--force'])).toEqual({ usage: true });
    expect(USAGE).toMatch(/npm run db:reset/);
  });

  it('only "yes" or "y" confirms', () => {
    expect(isConfirmation(' YES ')).toBe(true);
    expect(isConfirmation('y')).toBe(true);
    for (const answer of ['', 'no', 'yes please', undefined]) expect(isConfirmation(answer)).toBe(false);
  });
});

describe('runReset', () => {
  it('refuses in production and deletes nothing', async () => {
    await seed();
    const { run, stderr } = reset({ env: 'production', yes: true });
    expect(await run).toBe(1);
    expect(stderr.text).toBe('Refusing to reset: NODE_ENV=production.\n');
    expect(await counts()).toEqual({ alerts: 1, batches: 1 });
  });

  it('asks first and aborts unless confirmed', async () => {
    await seed();
    const confirm = vi.fn(async () => false);
    const { run, stdout } = reset({ confirm });
    expect(await run).toBe(1);
    expect(confirm).toHaveBeenCalledWith(
      expect.stringMatching(/^Delete 1 alert\(s\) and 1 batch\(es\) from database/),
    );
    expect(stdout.text).toBe('Aborted; nothing was deleted.\n');
    expect(await counts()).toEqual({ alerts: 1, batches: 1 });
  });

  it('deletes all alerts and batches once confirmed', async () => {
    await seed();
    const { run, stdout } = reset({ confirm: async () => true });
    expect(await run).toBe(0);
    expect(stdout.text).toMatch(/^Deleted 1 alert\(s\) and 1 batch\(es\) from database/);
    expect(await counts()).toEqual({ alerts: 0, batches: 0 });
  });

  it('skips the prompt with --yes', async () => {
    await seed();
    const confirm = vi.fn();
    const { run } = reset({ yes: true, confirm });
    expect(await run).toBe(0);
    expect(confirm).not.toHaveBeenCalled();
    expect(await counts()).toEqual({ alerts: 0, batches: 0 });
  });

  it('keeps the unique active-alert index (documents deleted, not the collection)', async () => {
    await seed();
    await reset({ yes: true }).run;
    const indexes = await Alert.collection.indexes();
    expect(indexes.map((i) => i.name)).toContain('uniq_active_fingerprint');
  });
});
