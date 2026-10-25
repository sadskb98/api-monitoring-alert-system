import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { USAGE, parseArgs, runIngest } from '../../src/cli/ingest-file.js';
import { Alert } from '../../src/models/Alert.js';
import { Batch } from '../../src/models/Batch.js';
import { createAlertWriter } from '../../src/services/llm/alertWriter.js';
import { createMonitorService } from '../../src/services/monitor.service.js';
import { useTestDb } from '../db.js';
import { captureLogger, testConfig } from '../helpers.js';

useTestDb();

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/sample-batch.json');

function sink() {
  let data = '';
  return {
    write: (chunk) => (data += chunk),
    get text() {
      return data;
    },
  };
}

function setup({ files = {}, notifier } = {}) {
  const config = testConfig();
  const monitorService = createMonitorService({
    config,
    alertWriter: createAlertWriter({ llm: config.llm, thresholds: config.thresholds, client: null }),
    ...(notifier ? { notifier } : {}),
  });
  const stdout = sink();
  const stderr = sink();
  const fakeRead = async (file) => {
    const name = path.basename(file);
    if (name in files) return files[name];
    return readFile(file, 'utf8');
  };
  const run = (file) =>
    runIngest(file, { monitorService, logger: captureLogger().log, readFile: fakeRead, stdout, stderr });
  return { run, stdout, stderr };
}

describe('parseArgs', () => {
  it('takes exactly one file path', () => {
    expect(parseArgs(['batch.json'])).toEqual({ file: 'batch.json' });
    expect(parseArgs([])).toEqual({ usage: true });
    expect(parseArgs(['a.json', 'b.json'])).toEqual({ usage: true });
    expect(parseArgs(['--help'])).toEqual({ usage: true });
    expect(USAGE).toMatch(/npm run ingest -- /);
  });
});

describe('runIngest', () => {
  it('ingests the sample file through the same pipeline as POST /monitor', async () => {
    const { run, stdout, stderr } = setup();
    expect(await run(SAMPLE)).toBe(0);

    const result = JSON.parse(stdout.text);
    expect(result).toMatchObject({
      received: 2,
      accepted: 2,
      findings: 1,
      alerts: { created: 1 },
      llm: { status: 'disabled' },
    });
    expect(result.items[0]).toMatchObject({ api_name: 'AppointmentAPI', severity: 'critical' });
    expect(stderr.text).toBe('');

    const batch = await Batch.findById(result.batch_id).lean();
    expect(batch).toMatchObject({
      source: 'file',
      request_id: expect.stringMatching(/^file-[0-9a-f-]{36}$/),
    });
    expect(await Alert.countDocuments({ status: 'active' })).toBe(1);
  });

  it('exits 1 with a readable message when the file does not exist', async () => {
    const { run, stderr } = setup();
    expect(await run('nope/missing.json')).toBe(1);
    expect(stderr.text).toBe('Cannot read nope/missing.json: file not found\n');
  });

  it('exits 1 on invalid JSON', async () => {
    const { run, stderr } = setup({ files: { 'bad.json': '[{"api_name": ' } });
    expect(await run('bad.json')).toBe(1);
    expect(stderr.text).toMatch(/^Cannot read bad\.json: .*JSON/);
  });

  it('exits 1 with the API error body when every record is invalid', async () => {
    const { run, stdout, stderr } = setup({ files: { 'empty.json': '[{"status_code": 200}]' } });
    expect(await run('empty.json')).toBe(1);
    expect(stdout.text).toBe('');
    expect(JSON.parse(stderr.text)).toMatchObject({
      error: { code: 'VALIDATION_ERROR', message: 'No valid observations in batch' },
    });
    expect(await Batch.countDocuments({})).toBe(0);
  });

  it('accepts a single observation object', async () => {
    const { run, stdout } = setup({
      files: {
        'one.json': JSON.stringify({
          api_name: 'X',
          response_time_ms: 9000,
          status_code: 200,
          records_returned: 1,
        }),
      },
    });
    expect(await run('one.json')).toBe(0);
    expect(JSON.parse(stdout.text).alerts.created).toBe(1);
  });

  it('waits for the digest email before returning', async () => {
    const order = [];
    const notifier = {
      notifyBatch: () => Promise.resolve(),
      idle: async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push('email done');
      },
    };
    const { run } = setup({ notifier });
    await run(SAMPLE).then(() => order.push('ingest returned'));
    expect(order).toEqual(['email done', 'ingest returned']);
  });
});
