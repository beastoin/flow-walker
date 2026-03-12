import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateRunResult } from '../src/run-schema.ts';
import type { RunResult } from '../src/run-schema.ts';

describe('validateRunResult', () => {
  const validRun: RunResult = {
    flow: 'tab-navigation',
    device: 'Pixel_7a',
    startedAt: '2026-03-12T10:00:00Z',
    duration: 17600,
    result: 'pass',
    steps: [
      {
        index: 0,
        name: 'Verify home tab',
        action: 'assert',
        status: 'pass',
        timestamp: 1000,
        duration: 2300,
        elementCount: 24,
        screenshot: 'step-1-home.png',
        assertion: { interactive_count: { min: 20, actual: 24 } },
      },
    ],
    video: 'recording.mp4',
    log: 'device.log',
  };

  it('accepts valid run result', () => {
    assert.equal(validateRunResult(validRun), true);
  });

  it('accepts run with fail status', () => {
    const failRun = { ...validRun, result: 'fail' as const };
    assert.equal(validateRunResult(failRun), true);
  });

  it('accepts run without video and log', () => {
    const { video, log, ...minimal } = validRun;
    assert.equal(validateRunResult(minimal), true);
  });

  it('accepts step with fail status', () => {
    const run = {
      ...validRun,
      steps: [{ ...validRun.steps[0], status: 'fail' as const, error: 'element not found' }],
    };
    assert.equal(validateRunResult(run), true);
  });

  it('accepts step with skip status', () => {
    const run = {
      ...validRun,
      steps: [{ ...validRun.steps[0], status: 'skip' as const }],
    };
    assert.equal(validateRunResult(run), true);
  });

  it('rejects null', () => {
    assert.equal(validateRunResult(null), false);
  });

  it('rejects non-object', () => {
    assert.equal(validateRunResult('string'), false);
  });

  it('rejects missing flow field', () => {
    const { flow, ...noFlow } = validRun;
    assert.equal(validateRunResult(noFlow), false);
  });

  it('rejects missing device field', () => {
    const { device, ...noDevice } = validRun;
    assert.equal(validateRunResult(noDevice), false);
  });

  it('rejects invalid result value', () => {
    assert.equal(validateRunResult({ ...validRun, result: 'unknown' }), false);
  });

  it('rejects non-array steps', () => {
    assert.equal(validateRunResult({ ...validRun, steps: 'not-array' }), false);
  });

  it('rejects step missing name', () => {
    const { name, ...noName } = validRun.steps[0];
    assert.equal(validateRunResult({ ...validRun, steps: [noName] }), false);
  });

  it('rejects step missing action', () => {
    const { action, ...noAction } = validRun.steps[0];
    assert.equal(validateRunResult({ ...validRun, steps: [noAction] }), false);
  });

  it('rejects step with invalid status', () => {
    const badStep = { ...validRun.steps[0], status: 'maybe' };
    assert.equal(validateRunResult({ ...validRun, steps: [badStep] }), false);
  });

  it('rejects step missing timestamp', () => {
    const { timestamp, ...noTs } = validRun.steps[0];
    assert.equal(validateRunResult({ ...validRun, steps: [noTs] }), false);
  });

  it('rejects step missing duration', () => {
    const { duration, ...noDur } = validRun.steps[0];
    assert.equal(validateRunResult({ ...validRun, steps: [noDur] }), false);
  });

  it('rejects step missing elementCount', () => {
    const { elementCount, ...noCount } = validRun.steps[0];
    assert.equal(validateRunResult({ ...validRun, steps: [noCount] }), false);
  });
});
