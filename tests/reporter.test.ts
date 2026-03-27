import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildHtmlV2 } from '../src/reporter.ts';

describe('buildHtmlV2', () => {
  it('renders v2 VerifyResult correctly', () => {
    const v2Data = {
      flow: 'onboarding-chaos',
      mode: 'audit',
      result: 'fail' as const,
      steps: [
        { id: 'S1', name: 'screenshot', do: 'Take screenshot of welcome screen', outcome: 'pass' as const, events: [], expectations: [] },
        { id: 'S2', name: 'press-continue', do: 'Press continue button', outcome: 'fail' as const, events: [], expectations: [] },
      ],
      issues: [],
    };
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
    const data = {
      flow: 'login',
      mode: 'balanced',
      result: 'pass' as const,
      steps: [
        { id: 'S1', name: 'open', do: 'Open login page', outcome: 'pass' as const, events: [], expectations: [] },
      ],
      issues: [],
    };
    const html = buildHtmlV2(data);
    assert.ok(html.includes('1 pass'));
    assert.ok(!html.includes('1 fail'));
  });

  it('renders expectations badges', () => {
    const data = {
      flow: 'test',
      mode: 'strict',
      result: 'pass' as const,
      steps: [
        { id: 'S1', name: 'check', do: 'Verify elements', outcome: 'pass' as const, events: [],
          expectations: [{ milestone: 'login visible', met: true }] },
      ],
      issues: [],
    };
    const html = buildHtmlV2(data);
    assert.ok(html.includes('login visible'));
    assert.ok(html.includes('expect met'));
  });

  it('escapes HTML in flow name', () => {
    const data = {
      flow: '<script>alert("xss")</script>',
      mode: 'audit',
      result: 'pass' as const,
      steps: [{ id: 'S1', name: 'x', do: 'x', outcome: 'pass' as const, events: [], expectations: [] }],
      issues: [],
    };
    const html = buildHtmlV2(data);
    assert.ok(!html.includes('<script>alert'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('includes responsive CSS', () => {
    const data = {
      flow: 'test', mode: 'audit', result: 'pass' as const,
      steps: [{ id: 'S1', name: 'x', do: 'x', outcome: 'pass' as const, events: [], expectations: [] }],
      issues: [],
    };
    const html = buildHtmlV2(data);
    assert.ok(html.includes('@media (max-width: 768px)'));
  });
});
