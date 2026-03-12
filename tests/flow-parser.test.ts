import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlow } from '../src/flow-parser.ts';

describe('parseFlow', () => {
  it('parses basic flow with name, description, setup', () => {
    const yaml = `
name: test-flow
description: A test flow
setup: normal

steps:
  - name: First step
    screenshot: step1
`;
    const flow = parseFlow(yaml);
    assert.equal(flow.name, 'test-flow');
    assert.equal(flow.description, 'A test flow');
    assert.equal(flow.setup, 'normal');
    assert.equal(flow.steps.length, 1);
  });

  it('parses covers and prerequisites arrays', () => {
    const yaml = `
name: with-meta
description: Flow with metadata
covers:
  - app/lib/pages/home.dart
  - app/lib/pages/settings.dart
prerequisites:
  - auth_ready
setup: normal

steps:
  - name: Step one
    screenshot: s1
`;
    const flow = parseFlow(yaml);
    assert.deepEqual(flow.covers, ['app/lib/pages/home.dart', 'app/lib/pages/settings.dart']);
    assert.deepEqual(flow.prerequisites, ['auth_ready']);
  });

  it('parses press step with inline object', () => {
    const yaml = `
name: press-test
description: Test press parsing
steps:
  - name: Press button
    press: { type: button, position: rightmost }
    screenshot: pressed
`;
    const flow = parseFlow(yaml);
    const step = flow.steps[0];
    assert.deepEqual(step.press, { type: 'button', position: 'rightmost' });
    assert.equal(step.screenshot, 'pressed');
  });

  it('parses press with bottom_nav_tab as number', () => {
    const yaml = `
name: nav-test
description: Nav tab test
steps:
  - name: Go to tab 2
    press: { bottom_nav_tab: 2 }
`;
    const flow = parseFlow(yaml);
    assert.equal(flow.steps[0].press?.bottom_nav_tab, 2);
  });

  it('parses scroll step', () => {
    const yaml = `
name: scroll-test
description: Scroll test
steps:
  - name: Scroll down
    scroll: down
    screenshot: scrolled
`;
    const flow = parseFlow(yaml);
    assert.equal(flow.steps[0].scroll, 'down');
  });

  it('parses fill step', () => {
    const yaml = `
name: fill-test
description: Fill test
steps:
  - name: Fill text
    fill: { type: textfield, value: "Hello world" }
    screenshot: filled
`;
    const flow = parseFlow(yaml);
    assert.equal(flow.steps[0].fill?.type, 'textfield');
    assert.equal(flow.steps[0].fill?.value, 'Hello world');
  });

  it('parses back step', () => {
    const yaml = `
name: back-test
description: Back test
steps:
  - name: Go back
    back: true
`;
    const flow = parseFlow(yaml);
    assert.equal(flow.steps[0].back, true);
  });

  it('parses assert with interactive_count', () => {
    const yaml = `
name: assert-test
description: Assert test
steps:
  - name: Check elements
    assert:
      interactive_count: { min: 20 }
    screenshot: home
`;
    const flow = parseFlow(yaml);
    assert.equal(flow.steps[0].assert?.interactive_count?.min, 20);
  });

  it('parses assert with bottom_nav_tabs', () => {
    const yaml = `
name: nav-assert
description: Nav tabs assert
steps:
  - name: Check nav
    assert:
      bottom_nav_tabs: { min: 4 }
`;
    const flow = parseFlow(yaml);
    assert.equal(flow.steps[0].assert?.bottom_nav_tabs?.min, 4);
  });

  it('parses assert with has_type', () => {
    const yaml = `
name: type-assert
description: Type assert
steps:
  - name: Check switches
    assert:
      has_type: { type: switch, min: 2 }
`;
    const flow = parseFlow(yaml);
    assert.equal(flow.steps[0].assert?.has_type?.type, 'switch');
    assert.equal(flow.steps[0].assert?.has_type?.min, 2);
  });

  it('parses note field (ignored by executor)', () => {
    const yaml = `
name: note-test
description: Note test
steps:
  - name: Step with note
    note: "This is a human-readable note"
    screenshot: noted
`;
    const flow = parseFlow(yaml);
    assert.equal(flow.steps[0].note, 'This is a human-readable note');
  });

  it('parses multiple steps in order', () => {
    const yaml = `
name: multi-step
description: Multiple steps
steps:
  - name: Step 1
    screenshot: s1
  - name: Step 2
    press: { type: button }
  - name: Step 3
    back: true
`;
    const flow = parseFlow(yaml);
    assert.equal(flow.steps.length, 3);
    assert.equal(flow.steps[0].name, 'Step 1');
    assert.equal(flow.steps[1].name, 'Step 2');
    assert.equal(flow.steps[2].name, 'Step 3');
  });

  it('strips inline YAML comments', () => {
    const yaml = `
name: comment-test
description: Test with comments
prerequisites:
  - auth_ready  # User must be signed in
setup: normal

steps:
  - name: Check home
    screenshot: home
`;
    const flow = parseFlow(yaml);
    assert.equal(flow.prerequisites![0], 'auth_ready');
  });

  it('throws on missing name', () => {
    const yaml = `
description: No name
steps:
  - name: Step 1
`;
    assert.throws(() => parseFlow(yaml), /missing required field: name/i);
  });

  it('throws on empty steps', () => {
    const yaml = `
name: empty
description: Empty steps
steps:
`;
    assert.throws(() => parseFlow(yaml), /no steps/i);
  });

  it('parses real-world flow format (home-navigation style)', () => {
    const yaml = `# E2E Flow: Home screen navigation
# Tests: snapshot, settings button, scroll, back navigation

name: home-navigation
description: Home screen snapshot, settings gear press, scroll in settings, back to home
covers:
  - app/lib/pages/home/page.dart
  - app/lib/pages/settings/settings_drawer.dart
prerequisites:
  - auth_ready  # User completed real sign-in
setup: normal

steps:
  - name: Snapshot home screen
    assert:
      interactive_count: { min: 20, verified: "flow-walker run10: 24 elements" }
    screenshot: home

  - name: Press settings gear (rightmost button in top bar)
    press: { type: button, position: rightmost }
    assert:
      interactive_count: { min: 10 }
    screenshot: settings

  - name: Scroll down in settings
    scroll: down
    screenshot: settings-scrolled

  - name: Back to home
    back: true
    assert:
      interactive_count: { min: 5 }
    screenshot: final
`;
    const flow = parseFlow(yaml);
    assert.equal(flow.name, 'home-navigation');
    assert.equal(flow.steps.length, 4);
    assert.equal(flow.steps[0].assert?.interactive_count?.min, 20);
    assert.equal(flow.steps[1].press?.type, 'button');
    assert.equal(flow.steps[1].press?.position, 'rightmost');
    assert.equal(flow.steps[2].scroll, 'down');
    assert.equal(flow.steps[3].back, true);
    assert.deepEqual(flow.covers, [
      'app/lib/pages/home/page.dart',
      'app/lib/pages/settings/settings_drawer.dart'
    ]);
  });
});
