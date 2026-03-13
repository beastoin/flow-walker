import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recordInit, recordStream, recordFinish } from '../src/record.ts';
let tmpDir: string;
let flowFile: string;
function setup(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'fw-record-'));
  flowFile = join(tmpDir, 'flow.yaml');
  writeFileSync(flowFile, 'version: 2\nname: test\nsteps:\n  - id: S1\n    do: test\n');
}
describe('recordInit', () => {
  it('creates run directory with required files', () => { setup(); const r = recordInit({ flowPath: flowFile, outputDir: tmpDir });
    assert.ok(r.id); assert.ok(r.dir); assert.ok(existsSync(join(r.dir, 'flow.lock.yaml'))); assert.ok(existsSync(join(r.dir, 'run.meta.json'))); assert.ok(existsSync(join(r.dir, 'events.jsonl'))); });
  it('uses custom runId', () => { setup(); const r = recordInit({ flowPath: flowFile, outputDir: tmpDir, runId: 'custom123' }); assert.equal(r.id, 'custom123'); });
  it('meta has recording status', () => { setup(); const r = recordInit({ flowPath: flowFile, outputDir: tmpDir });
    const meta = JSON.parse(readFileSync(join(r.dir, 'run.meta.json'), 'utf-8')); assert.equal(meta.status, 'recording'); assert.ok(meta.startedAt); });
  it('flow.lock.yaml contains flow content', () => { setup(); const r = recordInit({ flowPath: flowFile, outputDir: tmpDir });
    const lock = readFileSync(join(r.dir, 'flow.lock.yaml'), 'utf-8'); assert.ok(lock.includes('version: 2')); });
});
describe('recordStream', () => {
  it('appends valid events', () => { setup(); const r = recordInit({ flowPath: flowFile, outputDir: tmpDir });
    const count = recordStream({ runId: r.id, runDir: tmpDir }, ['{"type":"step.start","step_id":"S1"}', '{"type":"step.end","step_id":"S1","status":"pass"}']);
    assert.equal(count, 2); });
  it('adds seq and ts', () => { setup(); const r = recordInit({ flowPath: flowFile, outputDir: tmpDir });
    recordStream({ runId: r.id, runDir: tmpDir }, ['{"type":"step.start","step_id":"S1"}']);
    const lines = readFileSync(join(r.dir, 'events.jsonl'), 'utf-8').trim().split('\n');
    const ev = JSON.parse(lines[0]); assert.equal(ev.seq, 0); assert.ok(ev.ts); });
  it('skips invalid events', () => { setup(); const r = recordInit({ flowPath: flowFile, outputDir: tmpDir });
    const count = recordStream({ runId: r.id, runDir: tmpDir }, ['not json', '{"type":"bogus"}', '{"type":"step.start"}']);
    assert.equal(count, 0); });
});
describe('recordFinish', () => {
  it('updates meta with status and eventCount', () => { setup(); const r = recordInit({ flowPath: flowFile, outputDir: tmpDir });
    recordStream({ runId: r.id, runDir: tmpDir }, ['{"type":"step.start","step_id":"S1"}', '{"type":"step.end","step_id":"S1","status":"pass"}']);
    recordFinish({ runId: r.id, runDir: tmpDir, status: 'pass' });
    const meta = JSON.parse(readFileSync(join(r.dir, 'run.meta.json'), 'utf-8'));
    assert.equal(meta.status, 'pass'); assert.ok(meta.finishedAt); assert.equal(meta.eventCount, 2); });
});
