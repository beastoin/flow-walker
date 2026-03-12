import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NavigationGraph } from '../src/graph.ts';

describe('NavigationGraph', () => {
  it('adds screens and tracks visit count', () => {
    const g = new NavigationGraph();
    g.addScreen('abc123', 'home', ['button', 'textfield'], 5);
    assert.equal(g.screenCount(), 1);
    assert.equal(g.visitCount('abc123'), 1);

    g.addScreen('abc123', 'home', ['button', 'textfield'], 5);
    assert.equal(g.screenCount(), 1);
    assert.equal(g.visitCount('abc123'), 2);
  });

  it('hasScreen returns correct state', () => {
    const g = new NavigationGraph();
    assert.equal(g.hasScreen('abc'), false);
    g.addScreen('abc', 'home', [], 0);
    assert.equal(g.hasScreen('abc'), true);
  });

  it('adds edges between screens', () => {
    const g = new NavigationGraph();
    g.addScreen('a', 'home', [], 3);
    g.addScreen('b', 'settings', [], 5);
    g.addEdge('a', 'b', { ref: '@e1', type: 'button', text: 'Settings' });

    assert.equal(g.edges.length, 1);
    assert.equal(g.edges[0].source, 'a');
    assert.equal(g.edges[0].target, 'b');
  });

  it('deduplicates identical edges', () => {
    const g = new NavigationGraph();
    g.addScreen('a', 'home', [], 3);
    g.addScreen('b', 'settings', [], 5);

    const el = { ref: '@e1', type: 'button', text: 'Settings' };
    g.addEdge('a', 'b', el);
    g.addEdge('a', 'b', el); // duplicate
    assert.equal(g.edges.length, 1);
  });

  it('allows different edges between same screens', () => {
    const g = new NavigationGraph();
    g.addScreen('a', 'home', [], 3);
    g.addScreen('b', 'settings', [], 5);

    g.addEdge('a', 'b', { ref: '@e1', type: 'button', text: 'Settings' });
    g.addEdge('a', 'b', { ref: '@e2', type: 'gesture', text: 'Gear icon' });
    assert.equal(g.edges.length, 2);
  });

  it('edgesFrom returns correct edges', () => {
    const g = new NavigationGraph();
    g.addScreen('a', 'home', [], 3);
    g.addScreen('b', 'settings', [], 5);
    g.addScreen('c', 'profile', [], 4);

    g.addEdge('a', 'b', { ref: '@e1', type: 'button', text: 'Settings' });
    g.addEdge('a', 'c', { ref: '@e2', type: 'button', text: 'Profile' });
    g.addEdge('b', 'c', { ref: '@e3', type: 'button', text: 'Profile' });

    assert.equal(g.edgesFrom('a').length, 2);
    assert.equal(g.edgesFrom('b').length, 1);
    assert.equal(g.edgesFrom('c').length, 0);
  });

  it('edgesTo returns correct edges', () => {
    const g = new NavigationGraph();
    g.addScreen('a', 'home', [], 3);
    g.addScreen('b', 'settings', [], 5);

    g.addEdge('a', 'b', { ref: '@e1', type: 'button', text: 'Settings' });
    assert.equal(g.edgesTo('b').length, 1);
    assert.equal(g.edgesTo('a').length, 0);
  });

  it('cycle detection: hasScreen prevents revisiting', () => {
    const g = new NavigationGraph();
    g.addScreen('a', 'home', [], 3);
    g.addScreen('b', 'settings', [], 5);
    g.addEdge('a', 'b', { ref: '@e1', type: 'button', text: 'Settings' });

    // Simulate cycle: b → a
    g.addEdge('b', 'a', { ref: '@e2', type: 'button', text: 'Back' });

    // Walker would check hasScreen before recursing
    assert.equal(g.hasScreen('a'), true);
    assert.equal(g.visitCount('a'), 1);
    // visitCount > 1 would trigger cycle skip in walker
  });

  it('toJSON produces serializable output', () => {
    const g = new NavigationGraph();
    g.addScreen('a', 'home', ['button'], 3);
    g.addScreen('b', 'settings', ['button', 'switch'], 5);
    g.addEdge('a', 'b', { ref: '@e1', type: 'button', text: 'Settings' });

    const json = g.toJSON();
    assert.equal(json.nodes.length, 2);
    assert.equal(json.edges.length, 1);

    // Verify it's JSON-serializable
    const str = JSON.stringify(json);
    const parsed = JSON.parse(str);
    assert.equal(parsed.nodes.length, 2);
  });
});
