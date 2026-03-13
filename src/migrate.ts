import type { Flow, FlowStep, FlowV2, FlowV2Step, FlowV2Expect, FlowV2Evidence } from './types.ts';
import { validateFlowV2 } from './flow-v2-schema.ts';

export function migrateFlowV1toV2(v1: Flow): FlowV2 {
  const v2: FlowV2 = {
    version: 2, name: v1.name, description: v1.description,
    steps: v1.steps.map((step, i) => {
      const s: FlowV2Step = {
        id: `S${i + 1}`, name: step.name, do: genDo(step),
        anchors: genAnchors(step), expect: convExpect(step), evidence: convEvidence(step),
      };
      if (step.note) s.note = step.note;
      return s;
    }),
  };
  if (v1.app) v2.app = v1.app;
  if (v1.appUrl) v2.appUrl = v1.appUrl;
  if (v1.covers) v2.covers = [...v1.covers];
  if (v1.prerequisites) v2.preconditions = [...v1.prerequisites];
  validateFlowV2(v2);
  return v2;
}

function genDo(step: FlowStep): string {
  const parts: string[] = [];
  if (step.press) {
    const target = step.press.hint || step.press.text || step.press.type || 'element';
    const pos = step.press.position ? ` (${step.press.position})` : '';
    parts.push(`Press the "${target}" ${step.press.type || 'element'}${pos}`);
  }
  if (step.fill) {
    const target = step.fill.text || step.fill.type || 'field';
    parts.push(`Fill "${target}" with "${step.fill.value}"`);
  }
  if (step.scroll) parts.push(`Scroll ${step.scroll}`);
  if (step.back) parts.push('Press back');
  if (step.adb) parts.push(`Run ADB: ${step.adb}`);
  if (step.wait) parts.push(`Wait ${step.wait}ms`);
  if (step.assert) {
    const a = step.assert;
    if (a.interactive_count) parts.push(`Verify at least ${a.interactive_count.min} interactive elements`);
    if (a.text) parts.push(`Verify text "${a.text}" is visible`);
    if (a.text_visible) parts.push(`Verify visible: ${a.text_visible.join(', ')}`);
    if (a.text_not_visible) parts.push(`Verify not visible: ${a.text_not_visible.join(', ')}`);
    if (a.bottom_nav_tabs) parts.push(`Verify at least ${a.bottom_nav_tabs.min} bottom nav tabs`);
    if (a.has_type) parts.push(`Verify element type "${a.has_type.type}" present`);
  }
  return parts.length > 0 ? parts.join('. ') : `Execute step: ${step.name}`;
}

function convExpect(step: FlowStep): FlowV2Expect[] {
  const expects: FlowV2Expect[] = [];
  if (step.assert) {
    if (step.assert.interactive_count) expects.push({ milestone: 'interactive-count-check', kind: 'element-count', min: step.assert.interactive_count.min, outcome: 'pass' });
    if (step.assert.text) expects.push({ milestone: 'text-visible', kind: 'text-check', values: [step.assert.text], outcome: 'pass' });
    if (step.assert.text_visible) expects.push({ milestone: 'text-visible', kind: 'text-check', values: step.assert.text_visible, outcome: 'pass' });
  }
  return expects;
}

function convEvidence(step: FlowStep): FlowV2Evidence[] {
  if (step.screenshot) return [{ screenshot: `${step.screenshot}.png` }];
  return [];
}

function genAnchors(step: FlowStep): string[] {
  const anchors: string[] = [];
  if (step.screenshot) anchors.push(step.screenshot);
  if (step.press?.text) anchors.push(step.press.text);
  if (step.press?.hint) anchors.push(step.press.hint);
  return anchors;
}
