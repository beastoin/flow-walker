import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findRunFile } from '../src/run-files.ts';

describe('findRunFile', () => {
  it('returns fixed name when it exists', () => {
    const d = mkdtempSync(join(tmpdir(), 'fw-rf-'));
    writeFileSync(join(d, 'run.json'), '{}');
    assert.equal(findRunFile(d, 'run.json'), join(d, 'run.json'));
  });
  it('finds timestamped variant', () => {
    const d = mkdtempSync(join(tmpdir(), 'fw-rf-'));
    writeFileSync(join(d, '20260330T100000Z-events.jsonl'), '');
    assert.equal(findRunFile(d, 'events.jsonl'), join(d, '20260330T100000Z-events.jsonl'));
  });
  it('returns latest timestamped variant when multiple exist', () => {
    const d = mkdtempSync(join(tmpdir(), 'fw-rf-'));
    writeFileSync(join(d, '20260330T100000Z-report.html'), 'old');
    writeFileSync(join(d, '20260330T110000Z-report.html'), 'new');
    const result = findRunFile(d, 'report.html');
    assert.equal(result, join(d, '20260330T110000Z-report.html'));
  });
  it('prefers fixed name over timestamped variants', () => {
    const d = mkdtempSync(join(tmpdir(), 'fw-rf-'));
    writeFileSync(join(d, 'run.json'), 'fixed');
    writeFileSync(join(d, '20260330T100000Z-run.json'), 'timestamped');
    assert.equal(findRunFile(d, 'run.json'), join(d, 'run.json'));
  });
  it('falls back to fixed path when no match found', () => {
    const d = mkdtempSync(join(tmpdir(), 'fw-rf-'));
    assert.equal(findRunFile(d, 'missing.txt'), join(d, 'missing.txt'));
  });
});
