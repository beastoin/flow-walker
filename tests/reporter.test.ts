import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildHtmlV2, generateReportV2 } from '../src/reporter.ts';
import type { LogEntry } from '../src/reporter.ts';
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

  it('finds screenshots from screenshot field on action events', () => {
    const data = makeResult({
      flow: 'screenshot-field', mode: 'audit', result: 'pass' as const,
      steps: [{
        id: 'S1', name: 'check', do: 'Open sync page', outcome: 'pass' as const,
        events: [
          { type: 'action', step_id: 'S1', screenshot: 's1-pending-wal.webp' },
        ],
        expectations: [],
      }],
      issues: [],
    });
    // Provide screenshot data as if loaded from file
    const screenshots = new Map<string, string>();
    screenshots.set('s1-pending-wal.webp', 'AAAA'); // fake base64
    const stepMap = new Map<string, string>();
    stepMap.set('S1', 's1-pending-wal.webp');
    const html = buildHtmlV2(data, screenshots, '', 0, stepMap);
    assert.ok(html.includes('data:image/webp;base64,AAAA'), 'should embed screenshot from screenshot field');
  });

  it('finds screenshots from artifact events with any filename', () => {
    const data = makeResult({
      flow: 'artifact-any-name', mode: 'audit', result: 'pass' as const,
      steps: [{
        id: 'S1', name: 'check', do: 'Open page', outcome: 'pass' as const,
        events: [
          { type: 'artifact', step_id: 'S1', path: 'my-custom-screenshot.webp' },
        ],
        expectations: [],
      }],
      issues: [],
    });
    const screenshots = new Map<string, string>();
    screenshots.set('my-custom-screenshot.webp', 'BBBB');
    const stepMap = new Map<string, string>();
    stepMap.set('S1', 'my-custom-screenshot.webp');
    const html = buildHtmlV2(data, screenshots, '', 0, stepMap);
    assert.ok(html.includes('data:image/webp;base64,BBBB'), 'should embed screenshot from artifact with custom name');
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

  it('renders log timeline from note events', () => {
    const data = makeResult({
      flow: 'sync-test', mode: 'audit', result: 'pass' as const,
      steps: [{
        id: 'S1', name: 'sync', do: 'Trigger sync', outcome: 'pass' as const,
        events: [], expectations: [],
      }],
      issues: [],
    });
    const timeline: LogEntry[] = [
      { ts: '2026-03-30T10:00:01.200Z', source: 'app', message: 'SyncProvider: POST /v2/sync-local-files', stepId: 'S1' },
      { ts: '2026-03-30T10:00:01.350Z', source: 'backend', message: 'POST /v2/sync-local-files 202 Accepted', stepId: 'S1' },
      { ts: '2026-03-30T10:00:02.100Z', source: 'backend', message: 'VAD: 2 segments detected', stepId: 'S1' },
      { ts: '2026-03-30T10:00:05.000Z', source: 'backend', message: 'Deepgram transcription complete', stepId: 'S1' },
      { ts: '2026-03-30T10:00:06.200Z', source: 'app', message: 'SyncProvider: response received', stepId: 'S1' },
    ];
    const html = buildHtmlV2(data, new Map(), '', 0, new Map(), timeline);
    assert.ok(html.includes('Log Timeline'), 'should have Log Timeline section');
    assert.ok(html.includes('SyncProvider: POST /v2/sync-local-files'), 'should show app log');
    assert.ok(html.includes('202 Accepted'), 'should show backend log');
    assert.ok(html.includes('VAD: 2 segments'), 'should show VAD log');
    assert.ok(html.includes('log-src-app'), 'should have app source CSS class');
    assert.ok(html.includes('log-src-backend'), 'should have backend source CSS class');
    assert.ok(html.includes('+0.00s'), 'should show relative timestamp for first entry');
    assert.ok(html.includes('+0.15s'), 'should show relative timestamp for second entry');
  });

  it('omits log timeline when no note events have source', () => {
    const data = makeResult({
      flow: 'no-logs', mode: 'audit', result: 'pass' as const,
      steps: [{
        id: 'S1', name: 'x', do: 'x', outcome: 'pass' as const,
        events: [], expectations: [],
      }],
      issues: [],
    });
    const html = buildHtmlV2(data, new Map(), '', 0, new Map(), []);
    assert.ok(!html.includes('Log Timeline'), 'should NOT have Log Timeline when empty');
  });

  it('renders error-level log entries with error styling', () => {
    const data = makeResult({
      flow: 'error-log', mode: 'audit', result: 'pass' as const,
      steps: [{
        id: 'S1', name: 'x', do: 'x', outcome: 'pass' as const,
        events: [], expectations: [],
      }],
      issues: [],
    });
    const timeline: LogEntry[] = [
      { ts: '2026-03-30T10:00:00Z', source: 'backend', message: 'Connection refused', level: 'error' },
      { ts: '2026-03-30T10:00:01Z', source: 'app', message: 'Retry scheduled', level: 'warn' },
    ];
    const html = buildHtmlV2(data, new Map(), '', 0, new Map(), timeline);
    assert.ok(html.includes('log-error'), 'should have error CSS class');
    assert.ok(html.includes('log-warn'), 'should have warn CSS class');
    assert.ok(html.includes('Connection refused'));
  });

  it('renders citations with clickable links to raw log lines', () => {
    const data = makeResult({
      flow: 'cite-test', mode: 'audit', result: 'pass' as const,
      steps: [{
        id: 'S1', name: 'x', do: 'x', outcome: 'pass' as const,
        events: [], expectations: [],
      }],
      issues: [],
    });
    const timeline: LogEntry[] = [
      { ts: '2026-03-30T10:00:00Z', source: 'backend', message: 'POST /v2/sync 202', cite: 'backend.log:42' },
      { ts: '2026-03-30T10:00:01Z', source: 'app', message: 'State changed', cite: 'app.log:15' },
    ];
    const html = buildHtmlV2(data, new Map(), '', 0, new Map(), timeline);
    assert.ok(html.includes('backend.log:42'), 'should show citation text');
    assert.ok(html.includes('app.log:15'), 'should show app citation');
    assert.ok(html.includes('backend-log-L42'), 'should have anchor link');
    assert.ok(html.includes('log-cite'), 'should have cite CSS class');
  });

  it('renders raw log sections with line numbers and anchors', () => {
    const data = makeResult({
      flow: 'rawlog-test', mode: 'audit', result: 'pass' as const,
      steps: [{
        id: 'S1', name: 'x', do: 'x', outcome: 'pass' as const,
        events: [], expectations: [],
      }],
      issues: [],
    });
    const rawLogs = new Map<string, string>();
    rawLogs.set('backend.log', '2026-03-30T10:00:01Z POST /v2/sync 202\n2026-03-30T10:00:02Z VAD processing\n2026-03-30T10:00:03Z Job complete');
    const html = buildHtmlV2(data, new Map(), '', 0, new Map(), [], rawLogs);
    assert.ok(html.includes('Raw Logs'), 'should have Raw Logs section');
    assert.ok(html.includes('backend.log'), 'should show filename');
    assert.ok(html.includes('backend-log-L1'), 'should have line anchor for L1');
    assert.ok(html.includes('backend-log-L2'), 'should have line anchor for L2');
    assert.ok(html.includes('POST /v2/sync 202'), 'should show log content');
    assert.ok(html.includes('3 lines'), 'should show line count');
  });

  it('shows source summary in timeline header', () => {
    const data = makeResult({
      flow: 'summary-test', mode: 'audit', result: 'pass' as const,
      steps: [{
        id: 'S1', name: 'x', do: 'x', outcome: 'pass' as const,
        events: [], expectations: [],
      }],
      issues: [],
    });
    const timeline: LogEntry[] = [
      { ts: '2026-03-30T10:00:00Z', source: 'app', message: 'msg1' },
      { ts: '2026-03-30T10:00:01Z', source: 'backend', message: 'msg2' },
      { ts: '2026-03-30T10:00:02Z', source: 'app', message: 'msg3' },
    ];
    const html = buildHtmlV2(data, new Map(), '', 0, new Map(), timeline);
    assert.ok(html.includes('3 entries'), 'should show entry count');
    assert.ok(html.includes('timeline-meta'), 'should have meta section');
  });
});

describe('generateReportV2 enriches run.json', () => {
  it('writes logTimeline and duration back to run.json', () => {
    const d = mkdtempSync(join(tmpdir(), 'fw-report-enrich-'));
    const runData: VerifyResult = makeResult({
      flow: 'enrich-test', mode: 'audit', result: 'pass' as const,
      steps: [{
        id: 'S1', name: 'sync', do: 'Trigger sync', outcome: 'pass' as const,
        events: [
          { type: 'step.start', step_id: 'S1', ts: '2026-03-30T10:00:00.000Z', seq: 0 },
          { type: 'note', step_id: 'S1', source: 'app', message: 'SyncProvider started', ts: '2026-03-30T10:00:01.000Z', seq: 1 },
          { type: 'note', step_id: 'S1', source: 'backend', message: 'POST received', ts: '2026-03-30T10:00:02.000Z', seq: 2 },
          { type: 'step.end', step_id: 'S1', ts: '2026-03-30T10:00:05.000Z', seq: 3 },
        ],
        expectations: [],
      }],
      issues: [],
    });
    // Write run.json and meta
    writeFileSync(join(d, 'run.json'), JSON.stringify(runData));
    writeFileSync(join(d, 'run.meta.json'), JSON.stringify({ startedAt: '2026-03-30T10:00:00Z' }));
    generateReportV2(runData, d);
    const enriched = JSON.parse(readFileSync(join(d, 'run.json'), 'utf-8'));
    assert.equal(enriched.duration, 5000, 'should have duration in ms');
    assert.ok(Array.isArray(enriched.logTimeline), 'should have logTimeline array');
    assert.equal(enriched.logTimeline.length, 2, 'should have 2 note events in timeline');
    assert.equal(enriched.logTimeline[0].source, 'app');
    assert.equal(enriched.logTimeline[1].source, 'backend');
  });

  it('writes screenshots map to run.json', () => {
    const d = mkdtempSync(join(tmpdir(), 'fw-report-ss-'));
    const runData: VerifyResult = makeResult({
      flow: 'ss-test', mode: 'audit', result: 'pass' as const,
      steps: [{
        id: 'S1', name: 'x', do: 'x', outcome: 'pass' as const,
        events: [
          { type: 'step.start', step_id: 'S1', ts: '2026-03-30T10:00:00Z', seq: 0 },
          { type: 'artifact', step_id: 'S1', path: 'step-S1.webp', seq: 1, ts: '2026-03-30T10:00:01Z' },
          { type: 'step.end', step_id: 'S1', ts: '2026-03-30T10:00:02Z', seq: 2 },
        ],
        expectations: [],
      }],
      issues: [],
    });
    // Create a fake screenshot file
    writeFileSync(join(d, 'step-S1.webp'), Buffer.from('RIFF\x00\x00\x00\x00WEBP'));
    writeFileSync(join(d, 'run.json'), JSON.stringify(runData));
    writeFileSync(join(d, 'run.meta.json'), JSON.stringify({}));
    generateReportV2(runData, d);
    const enriched = JSON.parse(readFileSync(join(d, 'run.json'), 'utf-8'));
    assert.ok(enriched.screenshots, 'should have screenshots map');
    assert.equal(enriched.screenshots.S1, 'step-S1.webp', 'should map S1 to filename');
  });

  it('does not add logTimeline when no notes or logs exist', () => {
    const d = mkdtempSync(join(tmpdir(), 'fw-report-nolog-'));
    const runData: VerifyResult = makeResult({
      flow: 'nolog-test', mode: 'audit', result: 'pass' as const,
      steps: [{
        id: 'S1', name: 'x', do: 'x', outcome: 'pass' as const,
        events: [
          { type: 'step.start', step_id: 'S1', ts: '2026-03-30T10:00:00Z', seq: 0 },
          { type: 'step.end', step_id: 'S1', ts: '2026-03-30T10:00:01Z', seq: 1 },
        ],
        expectations: [],
      }],
      issues: [],
    });
    writeFileSync(join(d, 'run.json'), JSON.stringify(runData));
    writeFileSync(join(d, 'run.meta.json'), JSON.stringify({}));
    generateReportV2(runData, d);
    const enriched = JSON.parse(readFileSync(join(d, 'run.json'), 'utf-8'));
    assert.equal(enriched.logTimeline, undefined, 'should not add empty logTimeline');
  });
});
