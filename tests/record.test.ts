import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recordInit, recordStream, recordFinish, generateRecipe, compactTs } from '../src/record.ts';
import type { FlowV2 } from '../src/types.ts';
let tmpDir: string;
let flowFile: string;
function setup(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'fw-record-'));
  flowFile = join(tmpDir, 'flow.yaml');
  writeFileSync(flowFile, 'version: 2\nname: test\nsteps:\n  - id: S1\n    do: test\n');
}
describe('recordInit', () => {
  it('creates run directory with required files', () => { setup(); const r = recordInit({ flowPath: flowFile, outputDir: tmpDir });
    assert.ok(r.id); assert.ok(r.dir); assert.ok(existsSync(join(r.dir, 'flow.lock.yaml'))); assert.ok(existsSync(join(r.dir, 'run.meta.json'))); assert.ok(existsSync(join(r.dir, 'events.jsonl'))); });
  it('uses custom runId', () => { setup(); const r = recordInit({ flowPath: flowFile, outputDir: tmpDir, runId: 'custom123' }); assert.equal(r.id, 'custom123'); });
  it('meta has recording status', () => { setup(); const r = recordInit({ flowPath: flowFile, outputDir: tmpDir });
    const meta = JSON.parse(readFileSync(join(r.dir, 'run.meta.json'), 'utf-8')); assert.equal(meta.status, 'recording'); assert.ok(meta.startedAt); });
  it('flow.lock.yaml contains flow content', () => { setup(); const r = recordInit({ flowPath: flowFile, outputDir: tmpDir });
    const lock = readFileSync(join(r.dir, 'flow.lock.yaml'), 'utf-8'); assert.ok(lock.includes('version: 2')); });
});
describe('recordStream', () => {
  it('appends valid events', () => { setup(); const r = recordInit({ flowPath: flowFile, outputDir: tmpDir });
    const count = recordStream({ runId: r.id, runDir: tmpDir }, ['{"type":"step.start","step_id":"S1"}', '{"type":"step.end","step_id":"S1","status":"pass"}']);
    assert.equal(count, 2); });
  it('adds seq and ts', () => { setup(); const r = recordInit({ flowPath: flowFile, outputDir: tmpDir });
    recordStream({ runId: r.id, runDir: tmpDir }, ['{"type":"step.start","step_id":"S1"}']);
    const lines = readFileSync(join(r.dir, 'events.jsonl'), 'utf-8').trim().split('\n');
    const ev = JSON.parse(lines[0]); assert.equal(ev.seq, 0); assert.ok(ev.ts); });
  it('skips invalid events', () => { setup(); const r = recordInit({ flowPath: flowFile, outputDir: tmpDir });
    const count = recordStream({ runId: r.id, runDir: tmpDir }, ['not json', '{"type":"bogus"}', '{"type":"step.start"}']);
    assert.equal(count, 0); });
});
describe('recordFinish', () => {
  it('updates meta with status and eventCount', () => { setup(); const r = recordInit({ flowPath: flowFile, outputDir: tmpDir });
    recordStream({ runId: r.id, runDir: tmpDir }, ['{"type":"step.start","step_id":"S1"}', '{"type":"step.end","step_id":"S1","status":"pass"}']);
    recordFinish({ runId: r.id, runDir: tmpDir, status: 'pass' });
    const meta = JSON.parse(readFileSync(join(r.dir, 'run.meta.json'), 'utf-8'));
    assert.equal(meta.status, 'pass'); assert.ok(meta.finishedAt); assert.equal(meta.eventCount, 2); });

  it('detects missing assert events when flow has expect', () => {
    setup();
    const richFlow = join(tmpDir, 'rich.yaml');
    writeFileSync(richFlow, 'version: 2\nname: rich\nsteps:\n  - id: S1\n    do: check\n    expect:\n      - milestone: home-visible\n        kind: text_visible\n        values: [Home]\n');
    const r = recordInit({ flowPath: richFlow, outputDir: tmpDir });
    recordStream({ runId: r.id, runDir: tmpDir }, [
      '{"type":"step.start","step_id":"S1"}',
      '{"type":"artifact","step_id":"S1","path":"step-S1.webp"}',
      '{"type":"step.end","step_id":"S1","outcome":"pass"}',
    ]);
    const result = recordFinish({ runId: r.id, runDir: tmpDir, status: 'pass' });
    assert.ok(result.warnings);
    assert.ok(result.warnings!.some(w => w.includes('missing assert')));
  });

  it('detects missing artifact for judge steps', () => {
    setup();
    const judgeFlow = join(tmpDir, 'judge.yaml');
    writeFileSync(judgeFlow, 'version: 2\nname: judge\nsteps:\n  - id: S1\n    do: check\n    judge:\n      - prompt: Is home visible?\n        look_for: [home]\n');
    const r = recordInit({ flowPath: judgeFlow, outputDir: tmpDir });
    recordStream({ runId: r.id, runDir: tmpDir }, [
      '{"type":"step.start","step_id":"S1"}',
      '{"type":"step.end","step_id":"S1","outcome":"pass"}',
    ]);
    const result = recordFinish({ runId: r.id, runDir: tmpDir, status: 'pass' });
    assert.ok(result.warnings);
    assert.ok(result.warnings!.some(w => w.includes('missing artifact')));
  });

  it('no warnings when all expected events are present', () => {
    setup();
    const fullFlow = join(tmpDir, 'full.yaml');
    writeFileSync(fullFlow, 'version: 2\nname: full\nsteps:\n  - id: S1\n    do: check\n    expect:\n      - milestone: home\n        kind: text_visible\n    judge:\n      - prompt: Is home visible?\n');
    const r = recordInit({ flowPath: fullFlow, outputDir: tmpDir });
    recordStream({ runId: r.id, runDir: tmpDir }, [
      '{"type":"step.start","step_id":"S1"}',
      '{"type":"assert","step_id":"S1","milestone":"home","kind":"text_visible","passed":true}',
      '{"type":"artifact","step_id":"S1","path":"step-S1.webp"}',
      '{"type":"step.end","step_id":"S1","outcome":"pass"}',
    ]);
    const result = recordFinish({ runId: r.id, runDir: tmpDir, status: 'pass' });
    assert.ok(!result.warnings || result.warnings.length === 0);
  });
});

describe('compactTs', () => {
  it('converts ISO timestamp to compact form', () => {
    assert.equal(compactTs('2026-03-29T04:12:00.123Z'), '20260329T041200123Z');
    assert.equal(compactTs('2026-01-01T00:00:00Z'), '20260101T000000Z');
    assert.equal(compactTs('2026-12-31T23:59:59.999Z'), '20261231T235959999Z');
  });
});

describe('timestamp-based artifact naming', () => {
  it('renames artifact files with timestamp prefix', () => {
    setup();
    const r = recordInit({ flowPath: flowFile, outputDir: tmpDir });
    writeFileSync(join(r.dir, 'my-screenshot.webp'), 'fake-image-data');
    recordStream({ runId: r.id, runDir: tmpDir }, [
      '{"type":"step.start","step_id":"S1"}',
      '{"type":"artifact","step_id":"S1","path":"my-screenshot.webp"}',
    ]);
    const lines = readFileSync(join(r.dir, 'events.jsonl'), 'utf-8').trim().split('\n');
    const artifactEvent = JSON.parse(lines.find(l => l.includes('"artifact"'))!);
    assert.ok(artifactEvent.path.includes('-S1-my-screenshot.webp'), `path should be timestamped: ${artifactEvent.path}`);
    assert.ok(artifactEvent.path.match(/^\d{8}T\d+Z-/), `path should start with compact timestamp: ${artifactEvent.path}`);
    assert.ok(!existsSync(join(r.dir, 'my-screenshot.webp')), 'original file should be renamed');
    assert.ok(existsSync(join(r.dir, artifactEvent.path)), 'timestamped file should exist');
  });

  it('renames screenshot field on events', () => {
    setup();
    const r = recordInit({ flowPath: flowFile, outputDir: tmpDir });
    writeFileSync(join(r.dir, 'action-shot.webp'), 'fake-data');
    recordStream({ runId: r.id, runDir: tmpDir }, [
      '{"type":"action","step_id":"S1","screenshot":"action-shot.webp"}',
    ]);
    const lines = readFileSync(join(r.dir, 'events.jsonl'), 'utf-8').trim().split('\n');
    const actionEvent = JSON.parse(lines[0]);
    assert.ok(actionEvent.screenshot.includes('-S1-action-shot.webp'));
    assert.ok(existsSync(join(r.dir, actionEvent.screenshot)));
  });

  it('leaves path unchanged when file does not exist', () => {
    setup();
    const r = recordInit({ flowPath: flowFile, outputDir: tmpDir });
    recordStream({ runId: r.id, runDir: tmpDir }, [
      '{"type":"artifact","step_id":"S1","path":"nonexistent.webp"}',
    ]);
    const lines = readFileSync(join(r.dir, 'events.jsonl'), 'utf-8').trim().split('\n');
    const ev = JSON.parse(lines[0]);
    assert.equal(ev.path, 'nonexistent.webp', 'path should be unchanged when file missing');
  });

  it('timestamps sort chronologically across steps', () => {
    setup();
    const r = recordInit({ flowPath: flowFile, outputDir: tmpDir });
    writeFileSync(join(r.dir, 'first.webp'), 'data1');
    writeFileSync(join(r.dir, 'second.webp'), 'data2');
    recordStream({ runId: r.id, runDir: tmpDir }, [
      '{"type":"artifact","step_id":"S1","path":"first.webp","ts":"2026-03-29T10:00:00.100Z"}',
      '{"type":"artifact","step_id":"S1","path":"second.webp","ts":"2026-03-29T10:00:01.200Z"}',
    ]);
    const lines = readFileSync(join(r.dir, 'events.jsonl'), 'utf-8').trim().split('\n');
    const ev1 = JSON.parse(lines[0]);
    const ev2 = JSON.parse(lines[1]);
    assert.ok(ev1.path < ev2.path, `${ev1.path} should sort before ${ev2.path}`);
  });
});

describe('generateRecipe', () => {
  it('produces per-step event recipes', () => {
    const flow: FlowV2 = {
      version: 2, name: 'recipe-test',
      steps: [
        { id: 'S1', do: 'Open app', name: 'Launch' },
        { id: 'S2', do: 'Tap button', name: 'Action' },
      ],
    };
    const recipe = generateRecipe(flow);
    assert.equal(recipe.length, 2);
    assert.equal(recipe[0].id, 'S1');
    assert.equal(recipe[0].name, 'Launch');
    assert.ok(recipe[0].events.includes('step.start'));
    assert.ok(recipe[0].events.includes('step.end'));
    assert.ok(recipe[0].events.includes('action'));
  });

  it('recipe includes assert hints from expect field', () => {
    const flow: FlowV2 = {
      version: 2, name: 'recipe-assert',
      steps: [{
        id: 'S1', do: 'Verify counter',
        expect: [
          { kind: 'text_visible', milestone: 'counter', values: ['Counter: 2'] },
        ],
      }],
    };
    const recipe = generateRecipe(flow);
    const assertEvent = recipe[0].events.find(e => e.includes('assert'));
    assert.ok(assertEvent, 'recipe should include assert hint');
    assert.ok(assertEvent!.includes('text_visible'), 'assert should mention kind');
    assert.ok(assertEvent!.includes('Counter: 2'), 'assert should mention expected value');
  });

  it('recipe includes artifact for judge steps (auto-timestamped)', () => {
    const flow: FlowV2 = {
      version: 2, name: 'recipe-judge',
      steps: [{
        id: 'S1', do: 'Open home',
        judge: [{ prompt: 'Is home visible?', screenshot: 'step-S1' }],
      }],
    };
    const recipe = generateRecipe(flow);
    const artifactEvent = recipe[0].events.find(e => e.includes('artifact'));
    assert.ok(artifactEvent, 'recipe should include artifact for judge step');
    assert.ok(artifactEvent!.includes('auto-timestamped'), 'recipe should indicate auto-timestamping');
  });

  it('recipe includes agent-review hints for judge steps', () => {
    const flow: FlowV2 = {
      version: 2, name: 'recipe-agent-review',
      steps: [{
        id: 'S1', do: 'Open home',
        judge: [
          { prompt: 'Is home visible?' },
          { prompt: 'Are tabs present?' },
        ],
      }],
    };
    const recipe = generateRecipe(flow);
    const agentReviewEvents = recipe[0].events.filter(e => e.includes('agent-review'));
    assert.equal(agentReviewEvents.length, 2);
    assert.ok(agentReviewEvents[0].includes('prompt_idx: 0'));
    assert.ok(agentReviewEvents[1].includes('prompt_idx: 1'));
  });

  it('record init returns recipe when flow provided', () => {
    setup();
    const r = recordInit({ flowPath: flowFile, outputDir: tmpDir });
    assert.ok(r.recipe, 'init should return recipe');
    assert.equal(r.recipe!.length, 1);
    assert.equal(r.recipe![0].id, 'S1');
  });
});
