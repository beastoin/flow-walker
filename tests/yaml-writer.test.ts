import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateFlowsV2, toYamlV2 } from '../src/yaml-writer.ts';
import { NavigationGraph } from '../src/graph.ts';
import type { FlowV2 } from '../src/types.ts';

describe('generateFlowsV2', () => {
  it('generates a single-screen flow for isolated nodes', () => {
    const g = new NavigationGraph();
    g.addScreen('abc', 'home', ['button'], 5);

    const flows = generateFlowsV2(g);
    assert.equal(flows.length, 1);
    assert.equal(flows[0].version, 2);
    assert.equal(flows[0].name, 'home');
    assert.ok(flows[0].steps.length >= 1);
    assert.ok(flows[0].steps[0].id);
    assert.ok(flows[0].steps[0].do);
  });

  it('generates one flow per outgoing branch from root', () => {
    const g = new NavigationGraph();
    g.addScreen('root', 'home', ['button'], 5);
    g.addScreen('a', 'settings', ['button'], 8);
    g.addScreen('b', 'profile', ['button'], 4);

    g.addEdge('root', 'a', { ref: '@e1', type: 'button', text: 'Settings' });
    g.addEdge('root', 'b', { ref: '@e2', type: 'button', text: 'Profile' });

    const flows = generateFlowsV2(g);
    assert.equal(flows.length, 2);

    const names = flows.map(f => f.name).sort();
    assert.deepEqual(names, ['profile', 'settings']);
  });

  it('includes do, expect, and step IDs', () => {
    const g = new NavigationGraph();
    g.addScreen('root', 'home', ['button'], 5);
    g.addScreen('a', 'settings', ['button'], 8);
    g.addEdge('root', 'a', { ref: '@e1', type: 'button', text: 'Settings' });

    const flows = generateFlowsV2(g);
    const flow = flows[0];

    // All steps must have id and do
    for (const step of flow.steps) {
      assert.ok(step.id, 'every step must have an id');
      assert.ok(step.do, 'every step must have a do');
    }

    // Should have expect on steps
    const stepsWithExpect = flow.steps.filter(s => s.expect && s.expect.length > 0);
    assert.ok(stepsWithExpect.length > 0, 'at least one step should have expectations');
  });

  it('generates valid v2 flow structure', () => {
    const g = new NavigationGraph();
    g.addScreen('r', 'home', ['button'], 3);
    g.addScreen('s', 'settings', ['button'], 5);
    g.addEdge('r', 's', { ref: '@e1', type: 'button', text: 'Go' });

    const flows = generateFlowsV2(g);
    const flow = flows[0];

    assert.equal(flow.version, 2);
    assert.ok(flow.name);
    assert.ok(flow.description);
    assert.ok(Array.isArray(flow.steps));
    assert.ok(flow.steps.length > 0);
  });
});

describe('toYamlV2', () => {
  it('produces valid v2 YAML with version, name, and steps', () => {
    const flow: FlowV2 = {
      version: 2,
      name: 'settings-nav',
      description: 'Home to Settings navigation',
      steps: [
        { id: 'S1', name: 'Verify home', do: 'Verify the home screen is loaded',
          expect: [{ milestone: 'home-visible', outcome: 'pass' }] },
        { id: 'S2', name: 'Open settings', do: 'Press the Settings button',
          expect: [{ milestone: 'settings-visible', outcome: 'pass' }] },
        { id: 'S3', name: 'Return', do: 'Press back to return to home' },
      ],
    };

    const yaml = toYamlV2(flow);
    assert.ok(yaml.includes('version: 2'));
    assert.ok(yaml.includes('name: settings-nav'));
    assert.ok(yaml.includes('description: Home to Settings navigation'));
    assert.ok(yaml.includes('steps:'));
    assert.ok(yaml.includes('- id: S1'));
    assert.ok(yaml.includes('do: Verify the home screen is loaded'));
    assert.ok(yaml.includes('milestone: home-visible'));
  });

  it('includes covers and preconditions', () => {
    const flow: FlowV2 = {
      version: 2,
      name: 'test',
      covers: ['file1.dart', 'file2.dart'],
      preconditions: ['User logged in'],
      steps: [{ id: 'S1', do: 'Check' }],
    };

    const yaml = toYamlV2(flow);
    assert.ok(yaml.includes('covers:'));
    assert.ok(yaml.includes('- file1.dart'));
    assert.ok(yaml.includes('preconditions:'));
    assert.ok(yaml.includes('- User logged in'));
  });

  it('includes defaults block', () => {
    const flow: FlowV2 = {
      version: 2,
      name: 'test',
      defaults: { timeout_ms: 30000, retries: 2 },
      steps: [{ id: 'S1', do: 'Check' }],
    };

    const yaml = toYamlV2(flow);
    assert.ok(yaml.includes('defaults:'));
    assert.ok(yaml.includes('timeout_ms: 30000'));
    assert.ok(yaml.includes('retries: 2'));
  });

  it('includes anchors, evidence, verify, note', () => {
    const flow: FlowV2 = {
      version: 2,
      name: 'test',
      steps: [{
        id: 'S1', do: 'Check home',
        anchors: ['Settings', 'Profile'],
        evidence: [{ screenshot: 'home' }],
        verify: true,
        note: 'Important step',
      }],
    };

    const yaml = toYamlV2(flow);
    assert.ok(yaml.includes('anchors: [Settings, Profile]'));
    assert.ok(yaml.includes('- screenshot: home'));
    assert.ok(yaml.includes('verify: true'));
    assert.ok(yaml.includes('note: Important step'));
  });
});
