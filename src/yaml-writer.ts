import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Flow, FlowStep, ScreenEdge, ScreenNode, FlowV2 } from './types.ts';
import type { NavigationGraph } from './graph.ts';
export function generateFlows(graph: NavigationGraph): Flow[] {
  const flows: Flow[] = [];
  const allTargets = new Set(graph.edges.map(e => e.target));
  const roots = [...graph.nodes.values()].filter(n => !allTargets.has(n.id));
  if (roots.length === 0 && graph.nodes.size > 0) roots.push(graph.nodes.values().next().value!);
  for (const root of roots) {
    const outEdges = graph.edgesFrom(root.id);
    if (outEdges.length === 0) { flows.push(buildSingleScreenFlow(root)); continue; }
    for (const edge of outEdges) {
      const targetNode = graph.nodes.get(edge.target);
      if (!targetNode) continue;
      flows.push(buildBranchFlow(root, edge, targetNode, graph));
    }
  }
  return flows;
}
function buildSingleScreenFlow(screen: ScreenNode): Flow {
  return { name: screen.name, description: `Screen: ${screen.name} (${screen.elementCount} interactive elements)`, setup: 'normal',
    steps: [{ name: `Snapshot ${screen.name}`, assert: { interactive_count: { min: Math.max(1, screen.elementCount - 2) } }, screenshot: screen.name }] };
}
function buildBranchFlow(root: ScreenNode, firstEdge: ScreenEdge, firstTarget: ScreenNode, graph: NavigationGraph): Flow {
  const steps: FlowStep[] = [];
  steps.push({ name: `Verify ${root.name}`, assert: { interactive_count: { min: Math.max(1, root.elementCount - 2) } }, screenshot: root.name });
  steps.push({ name: `Press ${firstEdge.element.text || firstEdge.element.type}`, press: { type: firstEdge.element.type, hint: firstEdge.element.text || undefined }, screenshot: firstTarget.name });
  steps.push({ name: `Verify ${firstTarget.name}`, assert: { interactive_count: { min: Math.max(1, firstTarget.elementCount - 2) } } });
  const subEdges = graph.edgesFrom(firstTarget.id);
  for (const subEdge of subEdges.slice(0, 3)) {
    const subTarget = graph.nodes.get(subEdge.target);
    if (!subTarget || subTarget.id === root.id) continue;
    steps.push({ name: `Press ${subEdge.element.text || subEdge.element.type}`, press: { type: subEdge.element.type, hint: subEdge.element.text || undefined }, screenshot: subTarget.name });
    steps.push({ name: `Back from ${subTarget.name}`, back: true });
  }
  steps.push({ name: `Back to ${root.name}`, back: true, assert: { interactive_count: { min: Math.max(1, root.elementCount - 2) } } });
  return { name: firstTarget.name, description: `${root.name} → ${firstTarget.name} navigation flow`, setup: 'normal', steps };
}
export function toYaml(flow: Flow): string {
  const lines: string[] = [];
  lines.push(`# E2E Flow: ${flow.name}`); lines.push(''); lines.push(`name: ${flow.name}`);
  lines.push(`description: ${flow.description}`); lines.push(`setup: ${flow.setup}`); lines.push(''); lines.push('steps:');
  for (const step of flow.steps) {
    lines.push(`  - name: ${step.name}`);
    if (step.press) { const parts = [`type: ${step.press.type}`]; if (step.press.hint) parts.push(`hint: "${step.press.hint}"`); lines.push(`    press: { ${parts.join(', ')} }`); }
    if (step.scroll) lines.push(`    scroll: ${step.scroll}`);
    if (step.back) lines.push(`    back: true`);
    if (step.assert) {
      const parts: string[] = [];
      if (step.assert.interactive_count) parts.push(`interactive_count: { min: ${step.assert.interactive_count.min} }`);
      if (step.assert.text) parts.push(`text: "${step.assert.text}"`);
      if (parts.length > 0) { lines.push(`    assert:`); for (const part of parts) lines.push(`      ${part}`); }
    }
    if (step.screenshot) lines.push(`    screenshot: ${step.screenshot}`);
  }
  return lines.join('\n') + '\n';
}
export function writeFlows(flows: Flow[], outputDir: string): string[] {
  mkdirSync(outputDir, { recursive: true });
  const written: string[] = [];
  for (const flow of flows) { const filename = `${flow.name}.yaml`; const filepath = join(outputDir, filename); writeFileSync(filepath, toYaml(flow)); written.push(filepath); }
  return written;
}
export function toYamlV2(flow: FlowV2): string {
  const lines: string[] = [];
  lines.push('version: 2'); lines.push(`name: ${flow.name}`);
  if (flow.description) lines.push(`description: ${flow.description}`);
  if (flow.app) lines.push(`app: ${flow.app}`);
  if (flow.appUrl) lines.push(`appUrl: ${flow.appUrl}`);
  if (flow.covers?.length) { lines.push('covers:'); for (const c of flow.covers) lines.push(`  - ${c}`); }
  if (flow.preconditions?.length) { lines.push('preconditions:'); for (const p of flow.preconditions) lines.push(`  - ${p}`); }
  if (flow.defaults) { lines.push('defaults:'); if (flow.defaults.timeout_ms) lines.push(`  timeout_ms: ${flow.defaults.timeout_ms}`); if (flow.defaults.retries) lines.push(`  retries: ${flow.defaults.retries}`); if (flow.defaults.vision) lines.push(`  vision: ${flow.defaults.vision}`); }
  lines.push(''); lines.push('steps:');
  for (const step of flow.steps) {
    lines.push(`  - id: ${step.id}`); if (step.name) lines.push(`    name: ${step.name}`); lines.push(`    do: ${step.do}`);
    if (step.anchors?.length) lines.push(`    anchors: [${step.anchors.join(', ')}]`);
    if (step.expect?.length) { lines.push('    expect:'); for (const e of step.expect) { lines.push(`      - milestone: ${e.milestone || 'check'}`); if (e.kind) lines.push(`        kind: ${e.kind}`); if (e.outcome) lines.push(`        outcome: ${e.outcome}`); if (e.min !== undefined) lines.push(`        min: ${e.min}`); if (e.values?.length) lines.push(`        values: [${e.values.join(', ')}]`); } }
    if (step.evidence?.length) { lines.push('    evidence:'); for (const e of step.evidence) { if (e.screenshot) lines.push(`      - screenshot: ${e.screenshot}`); } }
    if (step.note) lines.push(`    note: ${step.note}`);
  }
  return lines.join('\n') + '\n';
}
