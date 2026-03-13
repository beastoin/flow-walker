import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrateFlowV1toV2 } from '../src/migrate.ts';
import { validateFlowV2 } from '../src/flow-v2-schema.ts';
import type { Flow } from '../src/types.ts';
const basicV1: Flow = { name: 'test', description: 'Test', setup: 'normal', steps: [
  { name: 'Press button', press: { type: 'button', hint: 'Settings' }, screenshot: 'home' },
  { name: 'Scroll down', scroll: 'down' },
  { name: 'Go back', back: true },
]};
describe('migrateFlowV1toV2', () => {
  it('produces valid v2 flow', () => { const v2 = migrateFlowV1toV2(basicV1); validateFlowV2(v2); assert.equal(v2.version, 2); });
  it('generates step IDs S1, S2, S3', () => { const v2 = migrateFlowV1toV2(basicV1); assert.equal(v2.steps[0].id, 'S1'); assert.equal(v2.steps[1].id, 'S2'); assert.equal(v2.steps[2].id, 'S3'); });
  it('preserves name and description', () => { const v2 = migrateFlowV1toV2(basicV1); assert.equal(v2.name, 'test'); assert.equal(v2.description, 'Test'); });
  it('converts press to do:', () => { const v2 = migrateFlowV1toV2(basicV1); assert.ok(v2.steps[0].do.includes('Settings')); assert.ok(v2.steps[0].do.length >= 5); });
  it('converts scroll to do:', () => { const v2 = migrateFlowV1toV2(basicV1); assert.ok(v2.steps[1].do.includes('Scroll')); });
  it('converts back to do:', () => { const v2 = migrateFlowV1toV2(basicV1); assert.ok(v2.steps[2].do.includes('back')); });
  it('does not contain legacy keys', () => { const v2 = migrateFlowV1toV2(basicV1); for (const s of v2.steps) { assert.ok(!('press' in s)); assert.ok(!('scroll' in s)); assert.ok(!('back' in s)); } });
  it('generates anchors from screenshot', () => { const v2 = migrateFlowV1toV2(basicV1); assert.ok(v2.steps[0].anchors?.includes('home')); });
  it('converts screenshot to evidence', () => { const v2 = migrateFlowV1toV2(basicV1); assert.ok(v2.steps[0].evidence?.length); });
  it('preserves metadata', () => {
    const v1: Flow = { ...basicV1, app: 'TestApp', appUrl: 'https://test.app', covers: ['lib/home.dart'], prerequisites: ['auth'] };
    const v2 = migrateFlowV1toV2(v1);
    assert.equal(v2.app, 'TestApp'); assert.equal(v2.appUrl, 'https://test.app');
    assert.deepEqual(v2.covers, ['lib/home.dart']); assert.deepEqual(v2.preconditions, ['auth']);
  });
  it('converts fill to do:', () => {
    const v1: Flow = { name: 'f', description: 'd', setup: 'normal', steps: [{ name: 'Fill', fill: { type: 'textfield', value: 'hello' } }] };
    const v2 = migrateFlowV1toV2(v1); assert.ok(v2.steps[0].do.includes('hello'));
  });
  it('converts assert to expect', () => {
    const v1: Flow = { name: 'a', description: 'd', setup: 'normal', steps: [{ name: 'Check', assert: { interactive_count: { min: 5 } } }] };
    const v2 = migrateFlowV1toV2(v1); assert.ok(v2.steps[0].expect?.length); assert.ok(v2.steps[0].do.includes('5'));
  });
  it('handles step with only name', () => {
    const v1: Flow = { name: 'n', description: 'd', setup: 'normal', steps: [{ name: 'Plain step' }] };
    const v2 = migrateFlowV1toV2(v1); assert.ok(v2.steps[0].do.length > 0);
  });
  it('preserves step name', () => { const v2 = migrateFlowV1toV2(basicV1); assert.equal(v2.steps[0].name, 'Press button'); });
  it('preserves step note', () => {
    const v1: Flow = { name: 'n', description: 'd', setup: 'normal', steps: [{ name: 'S', note: 'important' }] };
    const v2 = migrateFlowV1toV2(v1); assert.equal(v2.steps[0].note, 'important');
  });
});

describe('migrateFlowV1toV2 additional', () => {
  it('handles adb step', () => {
    const v1: Flow = { name: 'a', description: 'd', setup: 'normal', steps: [{ name: 'ADB', adb: 'shell input tap 100 200' }] };
    const v2 = migrateFlowV1toV2(v1);
    assert.ok(v2.steps[0].do.includes('ADB'));
  });
  it('handles wait step', () => {
    const v1: Flow = { name: 'w', description: 'd', setup: 'normal', steps: [{ name: 'Wait', wait: 2000 }] };
    const v2 = migrateFlowV1toV2(v1);
    assert.ok(v2.steps[0].do.includes('2000'));
  });
  it('handles text_not_visible assert', () => {
    const v1: Flow = { name: 'tnv', description: 'd', setup: 'normal', steps: [{ name: 'Check', assert: { text_not_visible: ['error'] } }] };
    const v2 = migrateFlowV1toV2(v1);
    assert.ok(v2.steps[0].do.includes('not visible'));
  });
  it('handles bottom_nav_tabs assert', () => {
    const v1: Flow = { name: 'bn', description: 'd', setup: 'normal', steps: [{ name: 'Check', assert: { bottom_nav_tabs: { min: 4 } } }] };
    const v2 = migrateFlowV1toV2(v1);
    assert.ok(v2.steps[0].do.includes('4'));
  });
  it('handles has_type assert', () => {
    const v1: Flow = { name: 'ht', description: 'd', setup: 'normal', steps: [{ name: 'Check', assert: { has_type: { type: 'button' } } }] };
    const v2 = migrateFlowV1toV2(v1);
    assert.ok(v2.steps[0].do.includes('button'));
  });
  it('empty anchors for step without screenshot or press', () => {
    const v1: Flow = { name: 'ea', description: 'd', setup: 'normal', steps: [{ name: 'Plain' }] };
    const v2 = migrateFlowV1toV2(v1);
    assert.deepEqual(v2.steps[0].anchors, []);
  });
  it('empty evidence for step without screenshot', () => {
    const v1: Flow = { name: 'ee', description: 'd', setup: 'normal', steps: [{ name: 'Plain' }] };
    const v2 = migrateFlowV1toV2(v1);
    assert.deepEqual(v2.steps[0].evidence, []);
  });
  it('press with position generates position in do', () => {
    const v1: Flow = { name: 'pp', description: 'd', setup: 'normal', steps: [{ name: 'Press', press: { type: 'button', position: 'rightmost' } }] };
    const v2 = migrateFlowV1toV2(v1);
    assert.ok(v2.steps[0].do.includes('rightmost'));
  });
  it('press with text generates anchor', () => {
    const v1: Flow = { name: 'pt', description: 'd', setup: 'normal', steps: [{ name: 'Press', press: { type: 'button', text: 'OK' } }] };
    const v2 = migrateFlowV1toV2(v1);
    assert.ok(v2.steps[0].anchors?.includes('OK'));
  });
});
