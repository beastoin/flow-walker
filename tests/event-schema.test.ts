import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateEvent, EVENT_TYPES } from '../src/event-schema.ts';
describe('EVENT_TYPES', () => {
  it('has 8 types', () => { assert.equal(EVENT_TYPES.length, 8); });
  it('includes run.start and run.end', () => { assert.ok(EVENT_TYPES.includes('run.start')); assert.ok(EVENT_TYPES.includes('run.end')); });
  it('includes step.start and step.end', () => { assert.ok(EVENT_TYPES.includes('step.start')); assert.ok(EVENT_TYPES.includes('step.end')); });
  it('includes action, assert, artifact, note', () => { for (const t of ['action', 'assert', 'artifact', 'note']) assert.ok(EVENT_TYPES.includes(t as any)); });
});
describe('validateEvent', () => {
  it('accepts valid run.start', () => { assert.ok(validateEvent({ type: 'run.start' }).valid); });
  it('accepts valid step.start with step_id', () => { assert.ok(validateEvent({ type: 'step.start', step_id: 'S1' }).valid); });
  it('accepts valid action with step_id', () => { assert.ok(validateEvent({ type: 'action', step_id: 'S1' }).valid); });
  it('accepts valid note without step_id', () => { assert.ok(validateEvent({ type: 'note' }).valid); });
  it('rejects null', () => { assert.ok(!validateEvent(null).valid); });
  it('rejects empty object', () => { assert.ok(!validateEvent({}).valid); });
  it('rejects unknown type', () => { assert.ok(!validateEvent({ type: 'unknown' }).valid); });
  it('rejects step.start without step_id', () => { assert.ok(!validateEvent({ type: 'step.start' }).valid); });
  it('rejects action without step_id', () => { assert.ok(!validateEvent({ type: 'action' }).valid); });
  it('rejects assert without step_id', () => { assert.ok(!validateEvent({ type: 'assert' }).valid); });
});
