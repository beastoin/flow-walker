import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Flow, FlowStep, ScreenEdge, ScreenNode } from './types.ts';
import type { NavigationGraph } from './graph.ts';

/**
 * Generate YAML flow files from a navigation graph.
 * Output matches sora's format: name, description, setup, steps[].
 */
export function generateFlows(graph: NavigationGraph): Flow[] {
  const flows: Flow[] = [];

  // Find root screens (screens with no incoming edges, or the first screen added)
  const allTargets = new Set(graph.edges.map(e => e.target));
  const roots = [...graph.nodes.values()].filter(n => !allTargets.has(n.id));

  // If no clear root, use the first node
  if (roots.length === 0 && graph.nodes.size > 0) {
    roots.push(graph.nodes.values().next().value!);
  }

  // For each root, generate flows for each outgoing path
  for (const root of roots) {
    const outEdges = graph.edgesFrom(root.id);

    if (outEdges.length === 0) {
      // Single-screen flow
      flows.push(buildSingleScreenFlow(root));
      continue;
    }

    // One flow per outgoing branch from root
    for (const edge of outEdges) {
      const targetNode = graph.nodes.get(edge.target);
      if (!targetNode) continue;

      const flow = buildBranchFlow(root, edge, targetNode, graph);
      flows.push(flow);
    }
  }

  return flows;
}

function buildSingleScreenFlow(screen: ScreenNode): Flow {
  return {
    name: screen.name,
    description: `Screen: ${screen.name} (${screen.elementCount} interactive elements)`,
    setup: 'normal',
    steps: [
      {
        name: `Snapshot ${screen.name}`,
        assert: { interactive_count: { min: Math.max(1, screen.elementCount - 2) } },
        screenshot: screen.name,
      },
    ],
  };
}

function buildBranchFlow(
  root: ScreenNode,
  firstEdge: ScreenEdge,
  firstTarget: ScreenNode,
  graph: NavigationGraph,
): Flow {
  const steps: FlowStep[] = [];
  const flowName = firstTarget.name;

  // Step 1: snapshot root screen
  steps.push({
    name: `Verify ${root.name}`,
    assert: { interactive_count: { min: Math.max(1, root.elementCount - 2) } },
    screenshot: root.name,
  });

  // Step 2: press to navigate
  steps.push({
    name: `Press ${firstEdge.element.text || firstEdge.element.type}`,
    press: {
      type: firstEdge.element.type,
      hint: firstEdge.element.text || undefined,
    },
    screenshot: firstTarget.name,
  });

  // Step 3: assert target screen
  steps.push({
    name: `Verify ${firstTarget.name}`,
    assert: { interactive_count: { min: Math.max(1, firstTarget.elementCount - 2) } },
  });

  // Follow one more level of edges from target (if any)
  const subEdges = graph.edgesFrom(firstTarget.id);
  for (const subEdge of subEdges.slice(0, 3)) { // cap at 3 sub-branches per flow
    const subTarget = graph.nodes.get(subEdge.target);
    if (!subTarget || subTarget.id === root.id) continue;

    steps.push({
      name: `Press ${subEdge.element.text || subEdge.element.type}`,
      press: {
        type: subEdge.element.type,
        hint: subEdge.element.text || undefined,
      },
      screenshot: subTarget.name,
    });

    steps.push({
      name: `Back from ${subTarget.name}`,
      back: true,
    });
  }

  // Final step: back to root
  steps.push({
    name: `Back to ${root.name}`,
    back: true,
    assert: { interactive_count: { min: Math.max(1, root.elementCount - 2) } },
  });

  return {
    name: flowName,
    description: `${root.name} → ${firstTarget.name} navigation flow`,
    setup: 'normal',
    steps,
  };
}

/** Serialize a Flow to YAML string (no library needed for this simple structure) */
export function toYaml(flow: Flow): string {
  const lines: string[] = [];

  lines.push(`# E2E Flow: ${flow.name}`);
  lines.push('');
  lines.push(`name: ${flow.name}`);
  lines.push(`description: ${flow.description}`);
  lines.push(`setup: ${flow.setup}`);
  lines.push('');
  lines.push('steps:');

  for (const step of flow.steps) {
    lines.push(`  - name: ${step.name}`);

    if (step.press) {
      const parts = [`type: ${step.press.type}`];
      if (step.press.hint) parts.push(`hint: "${step.press.hint}"`);
      lines.push(`    press: { ${parts.join(', ')} }`);
    }

    if (step.scroll) {
      lines.push(`    scroll: ${step.scroll}`);
    }

    if (step.back) {
      lines.push(`    back: true`);
    }

    if (step.assert) {
      const parts: string[] = [];
      if (step.assert.interactive_count) {
        parts.push(`interactive_count: { min: ${step.assert.interactive_count.min} }`);
      }
      if (step.assert.text) {
        parts.push(`text: "${step.assert.text}"`);
      }
      if (parts.length > 0) {
        lines.push(`    assert:`);
        for (const part of parts) {
          lines.push(`      ${part}`);
        }
      }
    }

    if (step.screenshot) {
      lines.push(`    screenshot: ${step.screenshot}`);
    }
  }

  return lines.join('\n') + '\n';
}

/** Write all flows to the output directory */
export function writeFlows(flows: Flow[], outputDir: string): string[] {
  mkdirSync(outputDir, { recursive: true });
  const written: string[] = [];

  for (const flow of flows) {
    const filename = `${flow.name}.yaml`;
    const filepath = join(outputDir, filename);
    writeFileSync(filepath, toYaml(flow));
    written.push(filepath);
  }

  return written;
}
