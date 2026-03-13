import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateFlowV2, buildScaffoldFlow } from '../src/flow-v2-schema.ts';
import type { FlowV2 } from '../src/types.ts';
const validFlow: FlowV2 = { version: 2, name: 'test', steps: [{ id: 'S1', do: 'Open home', anchors: ['home'], expect: [{ milestone: 'home-visible', outcome: 'pass' }], evidence: [{ screenshot: 'home.png' }] }] };
describe('validateFlowV2', () => {
  it('accepts valid flow', () => { validateFlowV2(validFlow); });
  it('rejects missing version', () => { assert.throws(() => validateFlowV2({ ...validFlow, version: 1 as 2 })); });
  it('rejects missing name', () => { assert.throws(() => validateFlowV2({ ...validFlow, name: '' })); });
  it('rejects empty steps', () => { assert.throws(() => validateFlowV2({ ...validFlow, steps: [] })); });
  it('rejects step without id', () => { assert.throws(() => validateFlowV2({ ...validFlow, steps: [{ id: '', do: 'test' }] })); });
  it('rejects step without do', () => { assert.throws(() => validateFlowV2({ ...validFlow, steps: [{ id: 'S1', do: '' }] })); });
  it('rejects duplicate step ids', () => { assert.throws(() => validateFlowV2({ ...validFlow, steps: [{ id: 'S1', do: 'a' }, { id: 'S1', do: 'b' }] })); });
  it('rejects legacy press key', () => { const bad = { ...validFlow, steps: [{ id: 'S1', do: 'test', press: { ref: '@e1' } } as any] }; assert.throws(() => validateFlowV2(bad)); });
  it('rejects legacy fill key', () => { const bad = { ...validFlow, steps: [{ id: 'S1', do: 'test', fill: { value: 'x' } } as any] }; assert.throws(() => validateFlowV2(bad)); });
  it('rejects legacy scroll key', () => { const bad = { ...validFlow, steps: [{ id: 'S1', do: 'test', scroll: 'down' } as any] }; assert.throws(() => validateFlowV2(bad)); });
  it('rejects legacy back key', () => { const bad = { ...validFlow, steps: [{ id: 'S1', do: 'test', back: true } as any] }; assert.throws(() => validateFlowV2(bad)); });
});
describe('buildScaffoldFlow', () => {
  it('generates valid scaffold', () => { const f = buildScaffoldFlow('test'); validateFlowV2(f); assert.equal(f.version, 2); assert.equal(f.name, 'test'); assert.equal(f.steps.length, 1); assert.equal(f.steps[0].id, 'S1'); });
  it('includes anchors', () => { const f = buildScaffoldFlow('login'); assert.ok(f.steps[0].anchors?.includes('login')); });
  it('includes expect', () => { const f = buildScaffoldFlow('x'); assert.ok(f.steps[0].expect?.length); });
  it('includes evidence', () => { const f = buildScaffoldFlow('y'); assert.ok(f.steps[0].evidence?.length); });
});
