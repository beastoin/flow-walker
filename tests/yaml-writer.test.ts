import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateFlows, toYaml } from '../src/yaml-writer.ts';
import { NavigationGraph } from '../src/graph.ts';
import type { Flow } from '../src/types.ts';

describe('generateFlows', () => {
  it('generates a single-screen flow for isolated nodes', () => {
    const g = new NavigationGraph();
    g.addScreen('abc', 'home', ['button'], 5);

    const flows = generateFlows(g);
    assert.equal(flows.length, 1);
    assert.equal(flows[0].name, 'home');
    assert.equal(flows[0].setup, 'normal');
    assert.ok(flows[0].steps.length >= 1);
  });

  it('generates one flow per outgoing branch from root', () => {
    const g = new NavigationGraph();
    g.addScreen('root', 'home', ['button'], 5);
    g.addScreen('a', 'settings', ['button'], 8);
    g.addScreen('b', 'profile', ['button'], 4);

    g.addEdge('root', 'a', { ref: '@e1', type: 'button', text: 'Settings' });
    g.addEdge('root', 'b', { ref: '@e2', type: 'button', text: 'Profile' });

    const flows = generateFlows(g);
    assert.equal(flows.length, 2);

    const names = flows.map(f => f.name).sort();
    assert.deepEqual(names, ['profile', 'settings']);
  });

  it('includes press, assert, back, and screenshot steps', () => {
    const g = new NavigationGraph();
    g.addScreen('root', 'home', ['button'], 5);
    g.addScreen('a', 'settings', ['button'], 8);
    g.addEdge('root', 'a', { ref: '@e1', type: 'button', text: 'Settings' });

    const flows = generateFlows(g);
    const flow = flows[0];
    const stepNames = flow.steps.map(s => s.name);

    // Should have: verify root, press to settings, verify settings, back to root
    assert.ok(stepNames.some(n => n.includes('Verify home')));
    assert.ok(stepNames.some(n => n.includes('Press')));
    assert.ok(stepNames.some(n => n.includes('Back')));

    // Check assert exists on verify steps
    const verifyStep = flow.steps.find(s => s.name.includes('Verify home'));
    assert.ok(verifyStep?.assert?.interactive_count);

    // Check screenshot exists
    const screenshotSteps = flow.steps.filter(s => s.screenshot);
    assert.ok(screenshotSteps.length >= 1);
  });

  it('generates valid flow with correct structure fields', () => {
    const g = new NavigationGraph();
    g.addScreen('r', 'home', ['button'], 3);
    g.addScreen('s', 'settings', ['button'], 5);
    g.addEdge('r', 's', { ref: '@e1', type: 'button', text: 'Go' });

    const flows = generateFlows(g);
    const flow = flows[0];

    // All flows must have name, description, setup, steps
    assert.ok(flow.name);
    assert.ok(flow.description);
    assert.equal(flow.setup, 'normal');
    assert.ok(Array.isArray(flow.steps));
    assert.ok(flow.steps.length > 0);

    // Each step must have a name
    for (const step of flow.steps) {
      assert.ok(step.name, 'every step must have a name');
    }
  });
});

describe('toYaml', () => {
  it('produces valid YAML with name: and steps: fields', () => {
    const flow: Flow = {
      name: 'settings-nav',
      description: 'Home → Settings navigation',
      setup: 'normal',
      steps: [
        { name: 'Verify home', assert: { interactive_count: { min: 3 } }, screenshot: 'home' },
        { name: 'Press Settings', press: { type: 'button', hint: 'Settings gear' } },
        { name: 'Back to home', back: true },
      ],
    };

    const yaml = toYaml(flow);

    // Check required YAML fields
    assert.ok(yaml.includes('name: settings-nav'));
    assert.ok(yaml.includes('description: Home → Settings navigation'));
    assert.ok(yaml.includes('setup: normal'));
    assert.ok(yaml.includes('steps:'));

    // Check step structure
    assert.ok(yaml.includes('- name: Verify home'));
    assert.ok(yaml.includes('interactive_count: { min: 3 }'));
    assert.ok(yaml.includes('screenshot: home'));
    assert.ok(yaml.includes('press: { type: button, hint: "Settings gear" }'));
    assert.ok(yaml.includes('back: true'));
  });

  it('outputs E2E Flow comment header', () => {
    const flow: Flow = {
      name: 'test',
      description: 'A test flow',
      setup: 'normal',
      steps: [{ name: 'Step 1' }],
    };

    const yaml = toYaml(flow);
    assert.ok(yaml.startsWith('# E2E Flow:'));
  });

  it('handles flow with assert text field', () => {
    const flow: Flow = {
      name: 'chat',
      description: 'Chat flow',
      setup: 'normal',
      steps: [{ name: 'Verify', assert: { text: 'Conversations' } }],
    };

    const yaml = toYaml(flow);
    assert.ok(yaml.includes('text: "Conversations"'));
  });

  it('handles scroll steps', () => {
    const flow: Flow = {
      name: 'scroll',
      description: 'Scroll test',
      setup: 'normal',
      steps: [{ name: 'Scroll down', scroll: 'down' }],
    };

    const yaml = toYaml(flow);
    assert.ok(yaml.includes('scroll: down'));
  });
});
