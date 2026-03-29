import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recordInit, recordStream, recordFinish, generateRecipe } from '../src/record.ts';
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

  it('recipe includes artifact for judge steps', () => {
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
    assert.ok(artifactEvent!.includes('screenshot'));
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
