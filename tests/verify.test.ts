import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyRun } from '../src/verify.ts';
import type { FlowV2 } from '../src/types.ts';
const flow: FlowV2 = { version: 2, name: 'vtest', steps: [
  { id: 'S1', do: 'Open home', expect: [{ milestone: 'home-visible', outcome: 'pass' }] },
  { id: 'S2', do: 'Press tab', expect: [{ milestone: 'tab-switched', outcome: 'pass' }] },
]};
function makeRunDir(events: string[]): string {
  const d = mkdtempSync(join(tmpdir(), 'fw-verify-'));
  writeFileSync(join(d, 'events.jsonl'), events.join('\n') + '\n');
  return d;
}
describe('verifyRun strict', () => {
  it('passes when all steps have pass events', () => {
    const d = makeRunDir([
      '{"type":"step.start","step_id":"S1","seq":0}','{"type":"assert","step_id":"S1","milestone":"home-visible","outcome":"pass","seq":1}','{"type":"step.end","step_id":"S1","status":"pass","seq":2}',
      '{"type":"step.start","step_id":"S2","seq":3}','{"type":"assert","step_id":"S2","milestone":"tab-switched","outcome":"pass","seq":4}','{"type":"step.end","step_id":"S2","status":"pass","seq":5}',
    ]);
    const r = verifyRun({ flow, runDir: d, mode: 'strict' }); assert.equal(r.result, 'pass');
  });
  it('fails when step is missing', () => {
    const d = makeRunDir(['{"type":"step.start","step_id":"S1","seq":0}','{"type":"step.end","step_id":"S1","status":"pass","seq":1}']);
    const r = verifyRun({ flow, runDir: d, mode: 'strict' }); assert.equal(r.result, 'fail');
  });
  it('fails on skipped step', () => {
    const d = makeRunDir([
      '{"type":"step.start","step_id":"S1","seq":0}','{"type":"step.end","step_id":"S1","status":"pass","seq":1}',
      '{"type":"step.start","step_id":"S2","seq":2}','{"type":"step.end","step_id":"S2","status":"skipped","seq":3}',
    ]);
    const r = verifyRun({ flow, runDir: d, mode: 'strict' }); assert.equal(r.result, 'fail');
  });
});
describe('verifyRun balanced', () => {
  it('passes with skipped steps', () => {
    const d = makeRunDir([
      '{"type":"step.start","step_id":"S1","seq":0}','{"type":"step.end","step_id":"S1","status":"pass","seq":1}',
      '{"type":"step.start","step_id":"S2","seq":2}','{"type":"step.end","step_id":"S2","status":"skipped","seq":3}',
    ]);
    const r = verifyRun({ flow, runDir: d, mode: 'balanced' }); assert.equal(r.result, 'pass');
  });
  it('passes with recovered steps', () => {
    const d = makeRunDir([
      '{"type":"step.start","step_id":"S1","seq":0}','{"type":"step.end","step_id":"S1","status":"pass","seq":1}',
      '{"type":"step.start","step_id":"S2","seq":2}','{"type":"step.end","step_id":"S2","status":"recovered","seq":3}',
    ]);
    const r = verifyRun({ flow, runDir: d, mode: 'balanced' }); assert.equal(r.result, 'pass');
  });
  it('fails on failed step', () => {
    const d = makeRunDir([
      '{"type":"step.start","step_id":"S1","seq":0}','{"type":"step.end","step_id":"S1","status":"pass","seq":1}',
      '{"type":"step.start","step_id":"S2","seq":2}','{"type":"step.end","step_id":"S2","status":"fail","seq":3}',
    ]);
    const r = verifyRun({ flow, runDir: d, mode: 'balanced' }); assert.equal(r.result, 'fail');
  });
});
describe('verifyRun audit', () => {
  it('always passes even with missing steps', () => {
    const d = makeRunDir(['{"type":"step.start","step_id":"S1","seq":0}','{"type":"step.end","step_id":"S1","status":"pass","seq":1}']);
    const r = verifyRun({ flow, runDir: d, mode: 'audit' }); assert.equal(r.result, 'pass');
  });
  it('always passes with empty events', () => {
    const d = makeRunDir([]);
    const r = verifyRun({ flow, runDir: d, mode: 'audit' }); assert.equal(r.result, 'pass');
  });
});
describe('verifyRun output', () => {
  it('writes run.json', () => {
    const d = makeRunDir(['{"type":"step.start","step_id":"S1","seq":0}','{"type":"step.end","step_id":"S1","status":"pass","seq":1}']);
    verifyRun({ flow, runDir: d, mode: 'balanced' });
    assert.ok(existsSync(join(d, 'run.json')));
  });
  it('includes flow name and mode', () => {
    const d = makeRunDir([]);
    const r = verifyRun({ flow, runDir: d, mode: 'audit' });
    assert.equal(r.flow, 'vtest'); assert.equal(r.mode, 'audit');
  });
  it('includes step results', () => {
    const d = makeRunDir([]);
    const r = verifyRun({ flow, runDir: d, mode: 'audit' });
    assert.equal(r.steps.length, 2); assert.equal(r.steps[0].id, 'S1');
  });
});

describe('verifyRun edge cases', () => {
  it('handles missing events file gracefully', () => {
    const d = mkdtempSync(join(tmpdir(), 'fw-verify-noev-'));
    const r = verifyRun({ flow, runDir: d, mode: 'audit' });
    assert.equal(r.result, 'pass');
  });
  it('strict fails on out-of-order steps', () => {
    const d = makeRunDir([
      '{"type":"step.start","step_id":"S2","seq":0}','{"type":"step.end","step_id":"S2","status":"pass","seq":1}',
      '{"type":"step.start","step_id":"S1","seq":2}','{"type":"step.end","step_id":"S1","status":"pass","seq":3}',
    ]);
    const r = verifyRun({ flow, runDir: d, mode: 'strict' });
    assert.ok(r.issues.length > 0);
  });
  it('strict detects unknown step_id', () => {
    const d = makeRunDir([
      '{"type":"step.start","step_id":"S1","seq":0}','{"type":"step.end","step_id":"S1","status":"pass","seq":1}',
      '{"type":"step.start","step_id":"S2","seq":2}','{"type":"step.end","step_id":"S2","status":"pass","seq":3}',
      '{"type":"step.start","step_id":"S99","seq":4}','{"type":"step.end","step_id":"S99","status":"pass","seq":5}',
    ]);
    const r = verifyRun({ flow, runDir: d, mode: 'strict' });
    assert.ok(r.issues.some(i => i.includes('S99')));
  });
  it('balanced fails on no events for a step', () => {
    const d = makeRunDir([]);
    const r = verifyRun({ flow, runDir: d, mode: 'balanced' });
    assert.equal(r.result, 'fail');
  });
  it('result steps have correct do field', () => {
    const d = makeRunDir([]);
    const r = verifyRun({ flow, runDir: d, mode: 'audit' });
    assert.equal(r.steps[0].do, 'Open home');
    assert.equal(r.steps[1].do, 'Press tab');
  });
  it('custom outputPath is used', () => {
    const d = makeRunDir([]);
    const customOut = join(d, 'custom-run.json');
    verifyRun({ flow, runDir: d, mode: 'audit', outputPath: customOut });
    assert.ok(existsSync(customOut));
  });
  it('custom eventsPath is used', () => {
    const d = mkdtempSync(join(tmpdir(), 'fw-verify-custom-'));
    const evPath = join(d, 'my-events.jsonl');
    writeFileSync(evPath, '{"type":"step.start","step_id":"S1","seq":0}\n{"type":"step.end","step_id":"S1","status":"pass","seq":1}\n');
    const r = verifyRun({ flow, runDir: d, mode: 'balanced', eventsPath: evPath });
    assert.equal(r.steps[0].outcome, 'pass');
  });
});
