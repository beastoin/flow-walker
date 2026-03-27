import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ScreenEdge, ScreenNode, FlowV2 } from './types.ts';
import type { NavigationGraph } from './graph.ts';
export function writeFlowsV2(flows: FlowV2[], outputDir: string): string[] {
  mkdirSync(outputDir, { recursive: true });
  const written: string[] = [];
  for (const flow of flows) { const filename = `${flow.name}.yaml`; const filepath = join(outputDir, filename); writeFileSync(filepath, toYamlV2(flow)); written.push(filepath); }
  return written;
}
export function generateFlowsV2(graph: NavigationGraph): FlowV2[] {
  const flows: FlowV2[] = [];
  const allTargets = new Set(graph.edges.map(e => e.target));
  const roots = [...graph.nodes.values()].filter(n => !allTargets.has(n.id));
  if (roots.length === 0 && graph.nodes.size > 0) roots.push(graph.nodes.values().next().value!);
  for (const root of roots) {
    const outEdges = graph.edgesFrom(root.id);
    if (outEdges.length === 0) { flows.push(buildSingleScreenFlowV2(root)); continue; }
    for (const edge of outEdges) {
      const targetNode = graph.nodes.get(edge.target);
      if (!targetNode) continue;
      flows.push(buildBranchFlowV2(root, edge, targetNode, graph));
    }
  }
  return flows;
}
function buildSingleScreenFlowV2(screen: ScreenNode): FlowV2 {
  return {
    version: 2, name: screen.name,
    description: `Verify ${screen.name} screen loads`,
    steps: [{
      id: 'S1', name: `Verify ${screen.name}`,
      do: `Verify the ${screen.name} screen is loaded with at least ${Math.max(1, screen.elementCount - 2)} interactive elements`,
      expect: [{ milestone: `${screen.name}-visible`, outcome: 'pass', kind: 'element-count', min: Math.max(1, screen.elementCount - 2) }],
    }],
  };
}
function buildBranchFlowV2(root: ScreenNode, firstEdge: ScreenEdge, firstTarget: ScreenNode, graph: NavigationGraph): FlowV2 {
  const steps: FlowV2['steps'] = [];
  let stepNum = 1;
  // S1: Verify root
  steps.push({
    id: `S${stepNum++}`, name: `Verify ${root.name}`,
    do: `Verify the ${root.name} screen is loaded`,
    expect: [{ milestone: `${root.name}-visible`, outcome: 'pass' }],
  });
  // S2: Navigate to target
  const pressLabel = firstEdge.element.text || firstEdge.element.type;
  steps.push({
    id: `S${stepNum++}`, name: `Open ${firstTarget.name}`,
    do: `Press the "${pressLabel}" ${firstEdge.element.type}`,
    expect: [{ milestone: `${firstTarget.name}-visible`, outcome: 'pass' }],
  });
  // S3: Verify target
  steps.push({
    id: `S${stepNum++}`, name: `Verify ${firstTarget.name}`,
    do: `Verify at least ${Math.max(1, firstTarget.elementCount - 2)} interactive elements on ${firstTarget.name}`,
    expect: [{ milestone: `${firstTarget.name}-interactive`, outcome: 'pass', kind: 'element-count', min: Math.max(1, firstTarget.elementCount - 2) }],
  });
  // Explore sub-edges (max 3)
  const subEdges = graph.edgesFrom(firstTarget.id);
  for (const subEdge of subEdges.slice(0, 3)) {
    const subTarget = graph.nodes.get(subEdge.target);
    if (!subTarget || subTarget.id === root.id) continue;
    const subLabel = subEdge.element.text || subEdge.element.type;
    steps.push({
      id: `S${stepNum++}`, name: `Open ${subTarget.name}`,
      do: `Press the "${subLabel}" ${subEdge.element.type}`,
      expect: [{ milestone: `${subTarget.name}-visible`, outcome: 'pass' }],
    });
    steps.push({
      id: `S${stepNum++}`, name: `Back from ${subTarget.name}`,
      do: `Press back to return to ${firstTarget.name}`,
      expect: [{ milestone: `returned-to-${firstTarget.name}`, outcome: 'pass' }],
    });
  }
  // Return to root
  steps.push({
    id: `S${stepNum++}`, name: `Return to ${root.name}`,
    do: `Press back to return to ${root.name}`,
    expect: [{ milestone: `${root.name}-returned`, outcome: 'pass' }],
  });
  return {
    version: 2, name: firstTarget.name,
    description: `${root.name} → ${firstTarget.name} navigation flow`,
    steps,
  };
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
    if (step.verify) lines.push(`    verify: true`);
    if (step.note) lines.push(`    note: ${step.note}`);
  }
  return lines.join('\n') + '\n';
}
