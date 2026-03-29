import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyRun, recheckRun, generateAgentPrompts } from '../src/verify.ts';
import type { FlowV2 } from '../src/types.ts';

describe('two-tier verification', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verify-tiers-'));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  const basicFlow: FlowV2 = {
    version: 2, name: 'test-flow',
    steps: [
      { id: 'S1', do: 'Open settings', claim: 'Settings page loads' },
      { id: 'S2', do: 'Toggle dark mode', claim: 'Theme changes to dark' },
    ],
  };

  it('produces automated and agent fields per step', () => {
    writeFileSync(join(tmpDir, 'events.jsonl'), [
      JSON.stringify({ type: 'step.start', step_id: 'S1', ts: '2024-01-01T00:00:00Z' }),
      JSON.stringify({ type: 'step.end', step_id: 'S1', outcome: 'pass', ts: '2024-01-01T00:00:01Z' }),
      JSON.stringify({ type: 'step.start', step_id: 'S2', ts: '2024-01-01T00:00:02Z' }),
      JSON.stringify({ type: 'step.end', step_id: 'S2', outcome: 'pass', ts: '2024-01-01T00:00:03Z' }),
    ].join('\n'));
    const result = verifyRun({ flow: basicFlow, runDir: tmpDir, mode: 'balanced' });
    assert.equal(result.result, 'pass');
    assert.equal(result.schema, 'flow-walker.run.v3');
    for (const step of result.steps) {
      assert.ok(step.automated, 'step should have automated field');
      assert.ok(step.agent, 'step should have agent field');
      assert.equal(step.automated.result, 'pass');
      assert.equal(step.agent.result, 'pass'); // no judge = auto-pass
    }
  });

  it('claim field populates step result', () => {
    writeFileSync(join(tmpDir, 'events.jsonl'), [
      JSON.stringify({ type: 'step.end', step_id: 'S1', outcome: 'pass' }),
      JSON.stringify({ type: 'step.end', step_id: 'S2', outcome: 'pass' }),
    ].join('\n'));
    const result = verifyRun({ flow: basicFlow, runDir: tmpDir, mode: 'audit' });
    assert.equal(result.steps[0].claim, 'Settings page loads');
    assert.equal(result.steps[1].claim, 'Theme changes to dark');
  });

  it('automated checks from expect with pass/fail/no_evidence', () => {
    const flow: FlowV2 = {
      version: 2, name: 'auto-checks',
      steps: [{
        id: 'S1', do: 'Verify', claim: 'Elements present',
        expect: [
          { kind: 'screen-match', milestone: 'home-visible' },
          { kind: 'element-count', min: 5 },
        ],
      }],
    };
    writeFileSync(join(tmpDir, 'events.jsonl'), [
      JSON.stringify({ type: 'step.start', step_id: 'S1' }),
      JSON.stringify({ type: 'assert', step_id: 'S1', milestone: 'home-visible', passed: true }),
      JSON.stringify({ type: 'step.end', step_id: 'S1', outcome: 'pass' }),
    ].join('\n'));
    const result = verifyRun({ flow, runDir: tmpDir, mode: 'balanced' });
    const auto = result.steps[0].automated;
    assert.equal(auto.checks.length, 2);
    assert.equal(auto.checks[0].status, 'pass'); // milestone found
    assert.equal(auto.checks[1].status, 'no_evidence'); // no assert event for element-count
    assert.equal(auto.result, 'no_evidence'); // overall: some no_evidence
    assert.equal(result.automatedResult, 'no_evidence');
  });

  it('automated check stores expected and actual values', () => {
    const flow: FlowV2 = {
      version: 2, name: 'actual-values',
      steps: [{
        id: 'S1', do: 'Check count',
        expect: [{ kind: 'element-count', min: 10 }],
      }],
    };
    writeFileSync(join(tmpDir, 'events.jsonl'), [
      JSON.stringify({ type: 'assert', step_id: 'S1', kind: 'element-count', passed: false, count: 3, actual: 3 }),
      JSON.stringify({ type: 'step.end', step_id: 'S1', outcome: 'fail' }),
    ].join('\n'));
    const result = verifyRun({ flow, runDir: tmpDir, mode: 'balanced' });
    const check = result.steps[0].automated.checks[0];
    assert.equal(check.status, 'fail');
    assert.deepEqual(check.expected, { kind: 'element-count', min: 10 });
    assert.ok('count' in check.actual || 'value' in check.actual);
  });

  it('agent prompts from judge field', () => {
    const flow: FlowV2 = {
      version: 2, name: 'agent-test',
      steps: [{
        id: 'S1', do: 'Open home', claim: 'Home visible',
        judge: [{
          prompt: 'Does the screenshot show a home screen?',
          screenshot: 'step-S1',
          look_for: ['tab bar', 'home icon'],
          fail_if: ['error dialog'],
        }],
      }],
    };
    writeFileSync(join(tmpDir, 'events.jsonl'), [
      JSON.stringify({ type: 'step.end', step_id: 'S1', outcome: 'pass' }),
    ].join('\n'));
    const result = verifyRun({ flow, runDir: tmpDir, mode: 'balanced' });
    assert.equal(result.steps[0].agent.result, 'pending');
    assert.equal(result.steps[0].agent.prompts.length, 1);
    assert.equal(result.steps[0].agent.prompts[0].prompt, 'Does the screenshot show a home screen?');
    assert.deepEqual(result.steps[0].agent.prompts[0].look_for, ['tab bar', 'home icon']);
    assert.deepEqual(result.steps[0].agent.prompts[0].fail_if, ['error dialog']);
    assert.equal(result.agentResult, 'pending');
  });

  it('recheckRun re-evaluates from stored run.json', () => {
    // First create a run
    writeFileSync(join(tmpDir, 'events.jsonl'), [
      JSON.stringify({ type: 'step.end', step_id: 'S1', outcome: 'pass' }),
      JSON.stringify({ type: 'step.end', step_id: 'S2', outcome: 'pass' }),
    ].join('\n'));
    verifyRun({ flow: basicFlow, runDir: tmpDir, mode: 'audit' });
    assert.ok(existsSync(join(tmpDir, 'run.json')));

    // Recheck from stored data
    const rechecked = recheckRun({ flow: basicFlow, runDir: tmpDir });
    assert.equal(rechecked.result, 'pass');
    assert.equal(rechecked.steps.length, 2);
  });

  it('recheckRun falls back to verifyRun when no run.json', () => {
    writeFileSync(join(tmpDir, 'events.jsonl'), [
      JSON.stringify({ type: 'step.end', step_id: 'S1', outcome: 'pass' }),
      JSON.stringify({ type: 'step.end', step_id: 'S2', outcome: 'fail' }),
    ].join('\n'));
    const result = recheckRun({ flow: basicFlow, runDir: tmpDir });
    assert.equal(result.result, 'fail');
  });

  it('generateAgentPrompts produces structured prompt packets', () => {
    const flow: FlowV2 = {
      version: 2, name: 'prompt-gen',
      steps: [
        { id: 'S1', do: 'Open home', claim: 'Home visible',
          judge: [{ prompt: 'Is the home screen visible?', screenshot: 'step-S1', look_for: ['tabs'] }] },
        { id: 'S2', do: 'Go to settings' }, // no judge
      ],
    };
    // Create a run.json first
    writeFileSync(join(tmpDir, 'events.jsonl'), [
      JSON.stringify({ type: 'step.end', step_id: 'S1', outcome: 'pass' }),
      JSON.stringify({ type: 'step.end', step_id: 'S2', outcome: 'pass' }),
    ].join('\n'));
    verifyRun({ flow, runDir: tmpDir, mode: 'audit' });

    const prompts = generateAgentPrompts({ flow, runDir: tmpDir });
    assert.equal(prompts.length, 1); // only S1 has judge
    const p = prompts[0] as Record<string, unknown>;
    assert.ok(p.step);
    assert.ok(p.check);
    const check = p.check as Record<string, unknown>;
    assert.equal(check.question, 'Is the home screen visible?');
    assert.deepEqual(check.lookFor, ['tabs']);
  });

  it('overall agentResult is pass when no steps have judge', () => {
    writeFileSync(join(tmpDir, 'events.jsonl'), [
      JSON.stringify({ type: 'step.end', step_id: 'S1', outcome: 'pass' }),
      JSON.stringify({ type: 'step.end', step_id: 'S2', outcome: 'pass' }),
    ].join('\n'));
    const result = verifyRun({ flow: basicFlow, runDir: tmpDir, mode: 'balanced' });
    assert.equal(result.agentResult, 'pass');
  });

  it('returns unverified when all automated=no_evidence and all agent=pending', () => {
    const flow: FlowV2 = {
      version: 2, name: 'unverified-test',
      steps: [{
        id: 'S1', do: 'Open home', claim: 'Home visible',
        expect: [{ kind: 'text_visible', milestone: 'home-text', values: ['Home'] }],
        judge: [{ prompt: 'Is home visible?', screenshot: 'step-S1', look_for: ['home'] }],
      }],
    };
    writeFileSync(join(tmpDir, 'events.jsonl'), [
      JSON.stringify({ type: 'step.start', step_id: 'S1' }),
      JSON.stringify({ type: 'artifact', step_id: 'S1', path: 'step-S1.webp' }),
      JSON.stringify({ type: 'step.end', step_id: 'S1', outcome: 'pass' }),
    ].join('\n'));
    const result = verifyRun({ flow, runDir: tmpDir, mode: 'audit' });
    assert.equal(result.result, 'unverified');
    assert.equal(result.automatedResult, 'no_evidence');
    assert.equal(result.agentResult, 'pending');
  });

  it('returns pass when automated checks pass and no agent prompts', () => {
    const flow: FlowV2 = {
      version: 2, name: 'pass-test',
      steps: [{
        id: 'S1', do: 'Check elements',
        expect: [{ kind: 'screen-match', milestone: 'home' }],
      }],
    };
    writeFileSync(join(tmpDir, 'events.jsonl'), [
      JSON.stringify({ type: 'assert', step_id: 'S1', milestone: 'home', passed: true }),
      JSON.stringify({ type: 'step.end', step_id: 'S1', outcome: 'pass' }),
    ].join('\n'));
    const result = verifyRun({ flow, runDir: tmpDir, mode: 'balanced' });
    assert.equal(result.result, 'pass');
  });

  it('agent-review event resolves pending prompt to pass', () => {
    const flow: FlowV2 = {
      version: 2, name: 'agent-review-test',
      steps: [{
        id: 'S1', do: 'Open home', claim: 'Home visible',
        judge: [{ prompt: 'Is home visible?', screenshot: 'step-S1', look_for: ['home'] }],
      }],
    };
    writeFileSync(join(tmpDir, 'events.jsonl'), [
      JSON.stringify({ type: 'step.start', step_id: 'S1' }),
      JSON.stringify({ type: 'artifact', step_id: 'S1', path: 'step-S1.webp' }),
      JSON.stringify({ type: 'agent-review', step_id: 'S1', prompt_idx: 0, verdict: 'pass', reason: 'Home tab bar visible' }),
      JSON.stringify({ type: 'step.end', step_id: 'S1', outcome: 'pass' }),
    ].join('\n'));
    const result = verifyRun({ flow, runDir: tmpDir, mode: 'balanced' });
    assert.equal(result.steps[0].agent.result, 'pass');
    assert.equal(result.steps[0].agent.prompts[0].status, 'pass');
    assert.equal(result.agentResult, 'pass');
  });

  it('agent-review event with verdict=fail marks prompt as fail', () => {
    const flow: FlowV2 = {
      version: 2, name: 'agent-review-fail',
      steps: [{
        id: 'S1', do: 'Open home',
        judge: [{ prompt: 'Is home visible?' }],
      }],
    };
    writeFileSync(join(tmpDir, 'events.jsonl'), [
      JSON.stringify({ type: 'agent-review', step_id: 'S1', prompt_idx: 0, verdict: 'fail', reason: 'Error dialog shown' }),
      JSON.stringify({ type: 'step.end', step_id: 'S1', outcome: 'pass' }),
    ].join('\n'));
    const result = verifyRun({ flow, runDir: tmpDir, mode: 'balanced' });
    assert.equal(result.steps[0].agent.result, 'fail');
    assert.equal(result.steps[0].agent.prompts[0].status, 'fail');
  });

  it('agent-review resolves unverified to pass when automated also passes', () => {
    const flow: FlowV2 = {
      version: 2, name: 'full-verify',
      steps: [{
        id: 'S1', do: 'Check home', claim: 'Home visible',
        expect: [{ kind: 'screen-match', milestone: 'home' }],
        judge: [{ prompt: 'Is home visible?', screenshot: 'step-S1' }],
      }],
    };
    writeFileSync(join(tmpDir, 'events.jsonl'), [
      JSON.stringify({ type: 'assert', step_id: 'S1', milestone: 'home', passed: true }),
      JSON.stringify({ type: 'agent-review', step_id: 'S1', prompt_idx: 0, verdict: 'pass' }),
      JSON.stringify({ type: 'step.end', step_id: 'S1', outcome: 'pass' }),
    ].join('\n'));
    const result = verifyRun({ flow, runDir: tmpDir, mode: 'balanced' });
    assert.equal(result.result, 'pass');
    assert.equal(result.automatedResult, 'pass');
    assert.equal(result.agentResult, 'pass');
  });
});
