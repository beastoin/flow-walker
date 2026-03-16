import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveSnapshot, loadSnapshot, computeFlowHash, deriveSnapshotPath } from '../src/snapshot.ts';
import { parseFlowV2 } from '../src/flow-parser.ts';
import { toYamlV2 } from '../src/yaml-writer.ts';

const FLOW_YAML = `version: 2
name: test-flow
steps:
  - id: S1
    name: Start
    do: open app
  - id: S2
    name: Press button
    do: press Login
  - id: S3
    name: Verify
    do: verify logged in
`;

function makeRunDir(events: Record<string, unknown>[], runId = 'test-run'): string {
  const dir = mkdtempSync(join(tmpdir(), 'fw-snap-'));
  const runDir = join(dir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
  writeFileSync(join(runDir, 'run.meta.json'), JSON.stringify({ id: runId }));
  return runDir;
}

function makeFlowFile(dir?: string, content = FLOW_YAML): string {
  const d = dir ?? mkdtempSync(join(tmpdir(), 'fw-snap-flow-'));
  const path = join(d, 'test-flow.yaml');
  writeFileSync(path, content);
  return path;
}

function sampleEvents(): Record<string, unknown>[] {
  const t0 = new Date('2026-01-01T00:00:00Z');
  return [
    { type: 'step.start', step_id: 'S1', ts: t0.toISOString() },
    { type: 'step.end', step_id: 'S1', ts: new Date(t0.getTime() + 2000).toISOString() },
    { type: 'step.start', step_id: 'S2', ts: new Date(t0.getTime() + 2500).toISOString() },
    { type: 'action', step_id: 'S2', command: 'press', element_ref: 'e5', element_text: 'Login', element_type: 'button', element_bounds: { x: 100, y: 200, width: 80, height: 40 }, ts: new Date(t0.getTime() + 3000).toISOString() },
    { type: 'step.end', step_id: 'S2', ts: new Date(t0.getTime() + 4000).toISOString() },
    { type: 'step.start', step_id: 'S3', ts: new Date(t0.getTime() + 4500).toISOString() },
    { type: 'step.end', step_id: 'S3', ts: new Date(t0.getTime() + 6000).toISOString() },
  ];
}

describe('computeFlowHash', () => {
  it('returns deterministic 16-char hex', () => {
    const h1 = computeFlowHash('hello');
    const h2 = computeFlowHash('hello');
    assert.equal(h1, h2);
    assert.equal(h1.length, 16);
    assert.match(h1, /^[0-9a-f]{16}$/);
  });
  it('changes when content changes', () => {
    assert.notEqual(computeFlowHash('a'), computeFlowHash('b'));
  });
});

describe('deriveSnapshotPath', () => {
  it('replaces .yaml with .snapshot.json', () => {
    assert.equal(deriveSnapshotPath('/flows/login.yaml'), '/flows/login.snapshot.json');
  });
  it('replaces .yml with .snapshot.json', () => {
    assert.equal(deriveSnapshotPath('/flows/login.yml'), '/flows/login.snapshot.json');
  });
});

describe('saveSnapshot', () => {
  it('creates snapshot file next to flow', () => {
    const flowPath = makeFlowFile();
    const runDir = makeRunDir(sampleEvents());
    saveSnapshot({ flowPath, runDir });
    const snapPath = deriveSnapshotPath(flowPath);
    assert.ok(existsSync(snapPath));
  });

  it('captures step data from events', () => {
    const flowPath = makeFlowFile();
    const runDir = makeRunDir(sampleEvents());
    const snap = saveSnapshot({ flowPath, runDir });
    assert.equal(snap.version, 1);
    assert.equal(snap.flow, 'test-flow');
    assert.ok(snap.flowHash);
    assert.equal(Object.keys(snap.steps).length, 3);
  });

  it('extracts action details: command, ref, text, bounds, center', () => {
    const flowPath = makeFlowFile();
    const runDir = makeRunDir(sampleEvents());
    const snap = saveSnapshot({ flowPath, runDir });
    const s2 = snap.steps['S2'];
    assert.equal(s2.kind, 'action');
    assert.equal(s2.command, 'press');
    assert.equal(s2.ref, 'e5');
    assert.equal(s2.text, 'Login');
    assert.equal(s2.type, 'button');
    assert.deepEqual(s2.bounds, { x: 100, y: 200, width: 80, height: 40 });
    assert.deepEqual(s2.center, { x: 140, y: 220 });
  });

  it('calculates duration from step.start to step.end', () => {
    const flowPath = makeFlowFile();
    const runDir = makeRunDir(sampleEvents());
    const snap = saveSnapshot({ flowPath, runDir });
    assert.equal(snap.steps['S1'].durationMs, 2000);
    assert.equal(snap.steps['S2'].durationMs, 1500); // 4000 - 2500
  });

  it('calculates waitAfterMs between steps', () => {
    const flowPath = makeFlowFile();
    const runDir = makeRunDir(sampleEvents());
    const snap = saveSnapshot({ flowPath, runDir });
    // S1 end at +2000, S2 start at +2500 => 500ms
    assert.equal(snap.steps['S1'].waitAfterMs, 500);
    // S2 end at +4000, S3 start at +4500 => 500ms
    assert.equal(snap.steps['S2'].waitAfterMs, 500);
  });

  it('determines verify steps: first + last + verify-only (default)', () => {
    const flowPath = makeFlowFile();
    const runDir = makeRunDir(sampleEvents());
    const snap = saveSnapshot({ flowPath, runDir });
    assert.ok(snap.verifySteps.includes('S1'));
    assert.ok(snap.verifySteps.includes('S3'));
  });

  it('uses flow-defined verify steps when provided', () => {
    const flowPath = makeFlowFile();
    const runDir = makeRunDir(sampleEvents());
    const snap = saveSnapshot({ flowPath, runDir, flowVerifySteps: ['S2', 'S3'] });
    assert.ok(snap.verifySteps.includes('S2'));
    assert.ok(snap.verifySteps.includes('S3'));
    // S1 is NOT included because flow explicitly defined verify steps
    assert.ok(!snap.verifySteps.includes('S1'));
  });

  it('flow-defined verify steps override first+last defaults', () => {
    const flowPath = makeFlowFile();
    const runDir = makeRunDir(sampleEvents());
    // Only mark S2 as verify — should NOT include S1 or S3
    const snap = saveSnapshot({ flowPath, runDir, flowVerifySteps: ['S2'] });
    assert.deepEqual(snap.verifySteps, ['S2']);
  });

  it('ignores flow verify steps not in events', () => {
    const flowPath = makeFlowFile();
    const runDir = makeRunDir(sampleEvents());
    const snap = saveSnapshot({ flowPath, runDir, flowVerifySteps: ['S2', 'S99'] });
    assert.ok(snap.verifySteps.includes('S2'));
    assert.ok(!snap.verifySteps.includes('S99'));
  });

  it('stores device info', () => {
    const flowPath = makeFlowFile();
    const runDir = makeRunDir(sampleEvents());
    const snap = saveSnapshot({ flowPath, runDir, device: 'Pixel7a', resolution: '1080x2400' });
    assert.equal(snap.device.model, 'Pixel7a');
    assert.equal(snap.device.resolution, '1080x2400');
  });

  it('calculates totalDurationMs', () => {
    const flowPath = makeFlowFile();
    const runDir = makeRunDir(sampleEvents());
    const snap = saveSnapshot({ flowPath, runDir });
    assert.equal(snap.totalDurationMs, 6000);
  });
});

describe('loadSnapshot', () => {
  it('returns explore mode when no snapshot exists', () => {
    const flowPath = makeFlowFile();
    const plan = loadSnapshot({ flowPath });
    assert.equal(plan.mode, 'explore');
    assert.equal(plan.valid, false);
    assert.equal(plan.reason, 'no snapshot file');
  });

  it('returns replay mode for valid snapshot', () => {
    const flowPath = makeFlowFile();
    const runDir = makeRunDir(sampleEvents());
    saveSnapshot({ flowPath, runDir });
    const plan = loadSnapshot({ flowPath });
    assert.equal(plan.mode, 'replay');
    assert.equal(plan.valid, true);
    assert.ok(plan.steps);
    assert.ok(plan.verifySteps);
    assert.ok(plan.totalDurationMs);
  });

  it('returns explore mode when flow changed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fw-snap-chg-'));
    const flowPath = join(dir, 'test-flow.yaml');
    writeFileSync(flowPath, FLOW_YAML);
    const runDir = makeRunDir(sampleEvents());
    saveSnapshot({ flowPath, runDir });
    // Modify the flow
    writeFileSync(flowPath, FLOW_YAML + '\n  - id: S4\n    name: Extra\n    do: extra step\n');
    const plan = loadSnapshot({ flowPath });
    assert.equal(plan.mode, 'explore');
    assert.equal(plan.reason, 'flow changed since snapshot');
  });

  it('returns explore mode on device mismatch', () => {
    const flowPath = makeFlowFile();
    const runDir = makeRunDir(sampleEvents());
    saveSnapshot({ flowPath, runDir, device: 'Pixel7a' });
    const plan = loadSnapshot({ flowPath, device: 'Pixel8' });
    assert.equal(plan.mode, 'explore');
    assert.ok(plan.reason!.includes('device mismatch'));
  });

  it('allows load when snapshot device is unknown', () => {
    const flowPath = makeFlowFile();
    const runDir = makeRunDir(sampleEvents());
    saveSnapshot({ flowPath, runDir }); // no device specified => 'unknown'
    const plan = loadSnapshot({ flowPath, device: 'AnyDevice' });
    assert.equal(plan.mode, 'replay');
  });

  it('replay plan contains step data with coordinates', () => {
    const flowPath = makeFlowFile();
    const runDir = makeRunDir(sampleEvents());
    saveSnapshot({ flowPath, runDir });
    const plan = loadSnapshot({ flowPath });
    assert.equal(plan.mode, 'replay');
    const s2 = plan.steps!['S2'];
    assert.equal(s2.command, 'press');
    assert.deepEqual(s2.center, { x: 140, y: 220 });
  });
});

describe('verify: true in flow YAML', () => {
  it('parseFlowV2 parses verify: true on steps', () => {
    const yaml = `version: 2
name: test
steps:
  - id: S1
    do: open app
    verify: true
  - id: S2
    do: press login
  - id: S3
    do: check result
    verify: true
`;
    const flow = parseFlowV2(yaml);
    assert.equal(flow.steps[0].verify, true);
    assert.equal(flow.steps[1].verify, undefined);
    assert.equal(flow.steps[2].verify, true);
  });

  it('toYamlV2 outputs verify: true', () => {
    const yaml = toYamlV2({
      version: 2, name: 'test',
      steps: [
        { id: 'S1', do: 'open app', verify: true },
        { id: 'S2', do: 'press login' },
      ],
    });
    assert.ok(yaml.includes('verify: true'));
    // verify only appears once (not on S2)
    assert.equal(yaml.split('verify: true').length - 1, 1);
  });
});
