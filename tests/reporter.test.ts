import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildHtmlV2 } from '../src/reporter.ts';
import type { VerifyResult } from '../src/verify.ts';

// Helper to create minimal VerifyResult with defaults for new fields
function makeResult(partial: Record<string, unknown>): VerifyResult {
  return {
    schema: 'flow-walker.run.v3',
    automatedResult: 'pass',
    agentResult: 'pass',
    ...partial,
  } as VerifyResult;
}

describe('buildHtmlV2', () => {
  it('renders v2 VerifyResult correctly', () => {
    const v2Data = makeResult({
      flow: 'onboarding-chaos',
      mode: 'audit',
      result: 'fail' as const,
      steps: [
        { id: 'S1', name: 'screenshot', do: 'Take screenshot of welcome screen', outcome: 'pass' as const, events: [], expectations: [] },
        { id: 'S2', name: 'press-continue', do: 'Press continue button', outcome: 'fail' as const, events: [], expectations: [] },
      ],
      issues: [],
    });
    const html = buildHtmlV2(v2Data);
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('onboarding-chaos'));
    assert.ok(html.includes('audit'), 'should show mode');
    assert.ok(html.includes('1 pass'), 'should count 1 pass');
    assert.ok(html.includes('1 fail'), 'should count 1 fail');
    assert.ok(html.includes('S1'), 'should show step ID');
    assert.ok(html.includes('Take screenshot of welcome screen'), 'should show do text');
    assert.ok(!html.includes('undefined'), 'should NOT contain undefined');
  });

  it('renders all-pass flow', () => {
    const data = makeResult({
      flow: 'login',
      mode: 'balanced',
      result: 'pass' as const,
      steps: [
        { id: 'S1', name: 'open', do: 'Open login page', outcome: 'pass' as const, events: [], expectations: [] },
      ],
      issues: [],
    });
    const html = buildHtmlV2(data);
    assert.ok(html.includes('1 pass'));
    assert.ok(!html.includes('1 fail'));
  });

  it('renders automated checks with milestone', () => {
    const data = makeResult({
      flow: 'test',
      mode: 'strict',
      result: 'pass' as const,
      steps: [
        { id: 'S1', name: 'check', do: 'Verify elements', outcome: 'pass' as const, events: [],
          expectations: [],
          automated: {
            result: 'pass' as const,
            checks: [{ kind: 'milestone', expected: { milestone: 'login visible' }, actual: { found: true }, status: 'pass' as const, milestone: 'login visible' }],
          },
          agent: { result: 'pass' as const, prompts: [] },
        },
      ],
      issues: [],
    });
    const html = buildHtmlV2(data);
    assert.ok(html.includes('login visible'));
    assert.ok(html.includes('Automated'));
  });

  it('escapes HTML in flow name', () => {
    const data = makeResult({
      flow: '<script>alert("xss")</script>',
      mode: 'audit',
      result: 'pass' as const,
      steps: [{ id: 'S1', name: 'x', do: 'x', outcome: 'pass' as const, events: [], expectations: [] }],
      issues: [],
    });
    const html = buildHtmlV2(data);
    assert.ok(!html.includes('<script>alert'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('embeds JSON report data', () => {
    const data = makeResult({
      flow: 'embed-test', mode: 'audit', result: 'pass' as const,
      schema: 'flow-walker.run.v3',
      automatedResult: 'pass' as const,
      agentResult: 'pass' as const,
      steps: [{
        id: 'S1', name: 'x', do: 'x', claim: 'test claim',
        outcome: 'pass' as const, events: [], expectations: [],
        automated: { result: 'pass' as const, checks: [] },
        agent: { result: 'pass' as const, prompts: [] },
      }],
      issues: [],
    });
    const html = buildHtmlV2(data);
    assert.ok(html.includes('application/json'));
    assert.ok(html.includes('report-data'));
    const match = html.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/);
    assert.ok(match, 'should have embedded JSON script tag');
    const parsed = JSON.parse(match![1]);
    assert.equal(parsed.flow, 'embed-test');
    assert.equal(parsed.schema, 'flow-walker.run.v3');
  });

  it('displays claim as step headline', () => {
    const data = makeResult({
      flow: 'claim-display', mode: 'audit', result: 'pass' as const,
      steps: [{
        id: 'S1', name: 'step-name', do: 'Open settings page',
        claim: 'Settings page loads with all options',
        outcome: 'pass' as const, events: [], expectations: [],
        automated: { result: 'pass' as const, checks: [] },
        agent: { result: 'pass' as const, prompts: [] },
      }],
      issues: [],
    });
    const html = buildHtmlV2(data);
    assert.ok(html.includes('Settings page loads with all options'));
    assert.ok(html.includes('step-claim'));
  });

  it('renders automated checks section', () => {
    const data = makeResult({
      flow: 'auto-test', mode: 'balanced', result: 'pass' as const,
      steps: [{
        id: 'S1', name: 'verify', do: 'Check elements',
        outcome: 'pass' as const, events: [], expectations: [],
        automated: {
          result: 'pass' as const,
          checks: [{ kind: 'element-count', expected: { min: 5 }, actual: { count: 10 }, status: 'pass' as const }],
        },
        agent: { result: 'pass' as const, prompts: [] },
      }],
      issues: [],
    });
    const html = buildHtmlV2(data);
    assert.ok(html.includes('Automated'), 'should have Automated section');
    assert.ok(html.includes('Expected') || html.includes('expected'), 'should show expected column');
    assert.ok(html.includes('element-count'));
  });

  it('renders agent review section', () => {
    const data = makeResult({
      flow: 'agent-test', mode: 'balanced', result: 'pass' as const,
      steps: [{
        id: 'S1', name: 'check', do: 'Open home',
        outcome: 'pass' as const, events: [], expectations: [],
        automated: { result: 'pass' as const, checks: [] },
        agent: {
          result: 'pending' as const,
          prompts: [{ prompt: 'Is the home screen visible?', status: 'pending' as const, look_for: ['tab bar'] }],
        },
      }],
      issues: [],
    });
    const html = buildHtmlV2(data);
    assert.ok(html.includes('Agent Review') || html.includes('agent-section'), 'should have Agent Review section');
    assert.ok(html.includes('Is the home screen visible?'));
    assert.ok(html.includes('tab bar'));
  });

  it('includes responsive CSS', () => {
    const data = makeResult({
      flow: 'test', mode: 'audit', result: 'pass' as const,
      steps: [{ id: 'S1', name: 'x', do: 'x', outcome: 'pass' as const, events: [], expectations: [] }],
      issues: [],
    });
    const html = buildHtmlV2(data);
    assert.ok(html.includes('@media (max-width: 768px)'));
  });

  it('renders unverified badge with amber styling', () => {
    const data = makeResult({
      flow: 'unverified-test', mode: 'balanced', result: 'unverified' as const,
      automatedResult: 'no_evidence' as const,
      agentResult: 'pending' as const,
      steps: [{
        id: 'S1', name: 'check', do: 'Open home', outcome: 'pass' as const,
        events: [], expectations: [],
        automated: { result: 'no_evidence' as const, checks: [{ kind: 'text_visible', expected: {}, actual: {}, status: 'no_evidence' as const }] },
        agent: { result: 'pending' as const, prompts: [{ prompt: 'Is home visible?', status: 'pending' as const }] },
      }],
      issues: [],
    });
    const html = buildHtmlV2(data);
    assert.ok(html.includes('UNVERIFIED'), 'badge should say UNVERIFIED');
    assert.ok(html.includes('unverified'), 'should use unverified CSS class');
  });

  it('renders AUDIT badge when mode is audit', () => {
    const data = makeResult({
      flow: 'audit-badge', mode: 'audit', result: 'unverified' as const,
      steps: [{
        id: 'S1', name: 'x', do: 'x', outcome: 'pass' as const,
        events: [], expectations: [],
        automated: { result: 'no_evidence' as const, checks: [{ kind: 'text_visible', expected: {}, actual: {}, status: 'no_evidence' as const }] },
        agent: { result: 'pending' as const, prompts: [{ prompt: 'test', status: 'pending' as const }] },
      }],
      issues: [],
    });
    const html = buildHtmlV2(data);
    assert.ok(html.includes('AUDIT'), 'audit mode badge should say AUDIT');
  });
});
