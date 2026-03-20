import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyRun } from '../src/verify.ts';

function setup(events: Record<string, unknown>[]): string {
  const tmp = mkdtempSync(join(tmpdir(), 'fw-va-'));
  writeFileSync(join(tmp, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n'));
  return tmp;
}

describe('verify audit mode result', () => {
  it('returns fail when a step has outcome=fail', () => {
    const tmp = setup([
      { type: 'step.start', step_id: 'S1' },
      { type: 'step.end', step_id: 'S1', outcome: 'pass' },
      { type: 'step.start', step_id: 'S2' },
      { type: 'step.end', step_id: 'S2', outcome: 'fail' },
    ]);
    const flow = { version: 2 as const, name: 'test', steps: [{ id: 'S1', do: 's1' }, { id: 'S2', do: 's2' }] };
    const r = verifyRun({ flow, runDir: tmp, mode: 'audit' });
    assert.equal(r.result, 'fail');
  });

  it('returns pass when all steps pass', () => {
    const tmp = setup([
      { type: 'step.start', step_id: 'S1' },
      { type: 'step.end', step_id: 'S1', outcome: 'pass' },
      { type: 'step.start', step_id: 'S2' },
      { type: 'step.end', step_id: 'S2', outcome: 'pass' },
    ]);
    const flow = { version: 2 as const, name: 'test', steps: [{ id: 'S1', do: 's1' }, { id: 'S2', do: 's2' }] };
    const r = verifyRun({ flow, runDir: tmp, mode: 'audit' });
    assert.equal(r.result, 'pass');
  });

  it('returns pass when steps are pass or skipped', () => {
    const tmp = setup([
      { type: 'step.start', step_id: 'S1' },
      { type: 'step.end', step_id: 'S1', outcome: 'pass' },
      { type: 'step.start', step_id: 'S2' },
      { type: 'step.end', step_id: 'S2', outcome: 'skipped' },
    ]);
    const flow = { version: 2 as const, name: 'test', steps: [{ id: 'S1', do: 's1' }, { id: 'S2', do: 's2' }] };
    const r = verifyRun({ flow, runDir: tmp, mode: 'audit' });
    assert.equal(r.result, 'pass');
  });

  it('returns pass when steps are pass or recovered', () => {
    const tmp = setup([
      { type: 'step.start', step_id: 'S1' },
      { type: 'step.end', step_id: 'S1', outcome: 'recovered' },
    ]);
    const flow = { version: 2 as const, name: 'test', steps: [{ id: 'S1', do: 's1' }] };
    const r = verifyRun({ flow, runDir: tmp, mode: 'audit' });
    assert.equal(r.result, 'pass');
  });

  it('defaults missing steps to skipped in audit mode', () => {
    const tmp = setup([
      { type: 'step.start', step_id: 'S1' },
      { type: 'step.end', step_id: 'S1', outcome: 'pass' },
    ]);
    const flow = { version: 2 as const, name: 'test', steps: [{ id: 'S1', do: 's1' }, { id: 'S2', do: 's2' }] };
    const r = verifyRun({ flow, runDir: tmp, mode: 'audit' });
    assert.equal(r.steps[1].outcome, 'skipped');
    assert.equal(r.result, 'pass');
  });
});

describe('verify outcome normalization', () => {
  it('normalizes "skip" to "skipped"', () => {
    const tmp = setup([
      { type: 'step.start', step_id: 'S1' },
      { type: 'step.end', step_id: 'S1', outcome: 'skip' },
    ]);
    const flow = { version: 2 as const, name: 'test', steps: [{ id: 'S1', do: 's1' }] };
    const r = verifyRun({ flow, runDir: tmp, mode: 'audit' });
    assert.equal(r.steps[0].outcome, 'skipped');
  });

  it('normalizes "partial" to "fail"', () => {
    const tmp = setup([
      { type: 'step.start', step_id: 'S1' },
      { type: 'step.end', step_id: 'S1', outcome: 'partial' },
    ]);
    const flow = { version: 2 as const, name: 'test', steps: [{ id: 'S1', do: 's1' }] };
    const r = verifyRun({ flow, runDir: tmp, mode: 'audit' });
    assert.equal(r.steps[0].outcome, 'fail');
  });

  it('normalizes unknown values to "fail"', () => {
    const tmp = setup([
      { type: 'step.start', step_id: 'S1' },
      { type: 'step.end', step_id: 'S1', outcome: 'bogus' },
    ]);
    const flow = { version: 2 as const, name: 'test', steps: [{ id: 'S1', do: 's1' }] };
    const r = verifyRun({ flow, runDir: tmp, mode: 'audit' });
    assert.equal(r.steps[0].outcome, 'fail');
  });

  it('adds normalization issue for non-standard values', () => {
    const tmp = setup([
      { type: 'step.start', step_id: 'S1' },
      { type: 'step.end', step_id: 'S1', outcome: 'partial' },
    ]);
    const flow = { version: 2 as const, name: 'test', steps: [{ id: 'S1', do: 's1' }] };
    const r = verifyRun({ flow, runDir: tmp, mode: 'audit' });
    assert.ok(r.issues.some(i => i.includes('partial') && i.includes('normalized')));
  });
});

describe('verify expectation checking', () => {
  it('text_visible met=false when assert passed=false', () => {
    const tmp = setup([
      { type: 'step.start', step_id: 'S1' },
      { type: 'assert', step_id: 'S1', kind: 'text_visible', passed: false },
      { type: 'step.end', step_id: 'S1', outcome: 'fail' },
    ]);
    const flow = { version: 2 as const, name: 'test', steps: [{ id: 'S1', do: 'check', expect: [{ kind: 'text_visible', values: ['Hello'] }] }] };
    const r = verifyRun({ flow, runDir: tmp, mode: 'audit' });
    const exp = r.steps[0].expectations[0] as Record<string, unknown>;
    assert.equal(exp.met, false);
  });

  it('text_visible met=true when assert passed=true', () => {
    const tmp = setup([
      { type: 'step.start', step_id: 'S1' },
      { type: 'assert', step_id: 'S1', kind: 'text_visible', passed: true },
      { type: 'step.end', step_id: 'S1', outcome: 'pass' },
    ]);
    const flow = { version: 2 as const, name: 'test', steps: [{ id: 'S1', do: 'check', expect: [{ kind: 'text_visible', values: ['Hello'] }] }] };
    const r = verifyRun({ flow, runDir: tmp, mode: 'audit' });
    const exp = r.steps[0].expectations[0] as Record<string, unknown>;
    assert.equal(exp.met, true);
  });

  it('interactive_count met=false when assert passed=false', () => {
    const tmp = setup([
      { type: 'step.start', step_id: 'S1' },
      { type: 'assert', step_id: 'S1', kind: 'interactive_count', passed: false, actual: 2 },
      { type: 'step.end', step_id: 'S1', outcome: 'fail' },
    ]);
    const flow = { version: 2 as const, name: 'test', steps: [{ id: 'S1', do: 'check', expect: [{ kind: 'interactive_count', min: 5 }] }] };
    const r = verifyRun({ flow, runDir: tmp, mode: 'audit' });
    const exp = r.steps[0].expectations[0] as Record<string, unknown>;
    assert.equal(exp.met, false);
  });

  it('text_visible met=true when no assert event (trust agent)', () => {
    const tmp = setup([
      { type: 'step.start', step_id: 'S1' },
      { type: 'step.end', step_id: 'S1', outcome: 'pass' },
    ]);
    const flow = { version: 2 as const, name: 'test', steps: [{ id: 'S1', do: 'check', expect: [{ kind: 'text_visible', values: ['Hello'] }] }] };
    const r = verifyRun({ flow, runDir: tmp, mode: 'audit' });
    const exp = r.steps[0].expectations[0] as Record<string, unknown>;
    assert.equal(exp.met, true);
  });
});

describe('verify issues in audit mode', () => {
  it('populates issues for failed steps', () => {
    const tmp = setup([
      { type: 'step.start', step_id: 'S1' },
      { type: 'step.end', step_id: 'S1', outcome: 'fail' },
    ]);
    const flow = { version: 2 as const, name: 'test', steps: [{ id: 'S1', do: 's1' }] };
    const r = verifyRun({ flow, runDir: tmp, mode: 'audit' });
    assert.ok(r.issues.length > 0);
    assert.ok(r.issues.some(i => i.includes('S1') && i.includes('fail')));
  });

  it('includes step.end summary in issue', () => {
    const tmp = setup([
      { type: 'step.start', step_id: 'S1' },
      { type: 'step.end', step_id: 'S1', outcome: 'fail', summary: 'Element not found' },
    ]);
    const flow = { version: 2 as const, name: 'test', steps: [{ id: 'S1', do: 's1' }] };
    const r = verifyRun({ flow, runDir: tmp, mode: 'audit' });
    assert.ok(r.issues.some(i => i.includes('Element not found')));
  });

  it('no issues when all steps pass', () => {
    const tmp = setup([
      { type: 'step.start', step_id: 'S1' },
      { type: 'step.end', step_id: 'S1', outcome: 'pass' },
    ]);
    const flow = { version: 2 as const, name: 'test', steps: [{ id: 'S1', do: 's1' }] };
    const r = verifyRun({ flow, runDir: tmp, mode: 'audit' });
    assert.equal(r.issues.length, 0);
  });
});
