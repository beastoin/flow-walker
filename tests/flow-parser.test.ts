import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlowV2 } from '../src/flow-parser.ts';

describe('parseFlowV2', () => {
  it('parses basic v2 flow with name, description, steps', () => {
    const yaml = `
version: 2
name: test-flow
description: A test flow

steps:
  - id: S1
    name: First step
    do: Check the home screen
`;
    const flow = parseFlowV2(yaml);
    assert.equal(flow.version, 2);
    assert.equal(flow.name, 'test-flow');
    assert.equal(flow.description, 'A test flow');
    assert.equal(flow.steps.length, 1);
    assert.equal(flow.steps[0].id, 'S1');
    assert.equal(flow.steps[0].do, 'Check the home screen');
  });

  it('parses covers and preconditions arrays', () => {
    const yaml = `
version: 2
name: with-meta
description: Flow with metadata
covers:
  - app/lib/pages/home.dart
  - app/lib/pages/settings.dart
preconditions:
  - User is logged in

steps:
  - id: S1
    do: Check screen
`;
    const flow = parseFlowV2(yaml);
    assert.deepEqual(flow.covers, ['app/lib/pages/home.dart', 'app/lib/pages/settings.dart']);
    assert.deepEqual(flow.preconditions, ['User is logged in']);
  });

  it('parses expect with milestone and kind', () => {
    const yaml = `
version: 2
name: expect-test

steps:
  - id: S1
    do: Open settings
    expect:
      - milestone: settings-visible
        kind: screen-loaded
        outcome: pass
`;
    const flow = parseFlowV2(yaml);
    const expect = flow.steps[0].expect!;
    assert.equal(expect.length, 1);
    assert.equal(expect[0].milestone, 'settings-visible');
    assert.equal(expect[0].kind, 'screen-loaded');
    assert.equal(expect[0].outcome, 'pass');
  });

  it('parses expect with values array', () => {
    const yaml = `
version: 2
name: values-test

steps:
  - id: S1
    do: Verify text
    expect:
      - milestone: text-check
        values: [Featured, Home, Settings]
`;
    const flow = parseFlowV2(yaml);
    assert.deepEqual(flow.steps[0].expect![0].values, ['Featured', 'Home', 'Settings']);
  });

  it('parses anchors as inline array', () => {
    const yaml = `
version: 2
name: anchors-test

steps:
  - id: S1
    do: Press button
    anchors: [Settings, Profile]
`;
    const flow = parseFlowV2(yaml);
    assert.deepEqual(flow.steps[0].anchors, ['Settings', 'Profile']);
  });

  it('parses anchors as block array', () => {
    const yaml = `
version: 2
name: anchors-block-test

steps:
  - id: S1
    do: Press button
    anchors:
      - Settings
      - Profile
`;
    const flow = parseFlowV2(yaml);
    assert.deepEqual(flow.steps[0].anchors, ['Settings', 'Profile']);
  });

  it('parses evidence with screenshot', () => {
    const yaml = `
version: 2
name: evidence-test

steps:
  - id: S1
    do: Check home
    evidence:
      - screenshot: home
`;
    const flow = parseFlowV2(yaml);
    assert.equal(flow.steps[0].evidence![0].screenshot, 'home');
  });

  it('parses verify flag', () => {
    const yaml = `
version: 2
name: verify-test

steps:
  - id: S1
    do: Check home
    verify: true
`;
    const flow = parseFlowV2(yaml);
    assert.equal(flow.steps[0].verify, true);
  });

  it('parses note field', () => {
    const yaml = `
version: 2
name: note-test

steps:
  - id: S1
    do: Check home
    note: This is a note
`;
    const flow = parseFlowV2(yaml);
    assert.equal(flow.steps[0].note, 'This is a note');
  });

  it('parses defaults block', () => {
    const yaml = `
version: 2
name: defaults-test
defaults:
  timeout_ms: 30000
  retries: 2
  vision: gpt-4o

steps:
  - id: S1
    do: Check home
`;
    const flow = parseFlowV2(yaml);
    assert.equal(flow.defaults!.timeout_ms, 30000);
    assert.equal(flow.defaults!.retries, 2);
    assert.equal(flow.defaults!.vision, 'gpt-4o');
  });

  it('parses flow-level evidence block', () => {
    const yaml = `
version: 2
name: evidence-test
evidence:
  video: true

steps:
  - id: S1
    do: Check home
`;
    const flow = parseFlowV2(yaml);
    assert.equal(flow.evidence!.video, true);
  });

  it('parses multiple steps in order', () => {
    const yaml = `
version: 2
name: multi-step

steps:
  - id: S1
    name: Step 1
    do: First action
  - id: S2
    name: Step 2
    do: Second action
  - id: S3
    name: Step 3
    do: Third action
`;
    const flow = parseFlowV2(yaml);
    assert.equal(flow.steps.length, 3);
    assert.equal(flow.steps[0].id, 'S1');
    assert.equal(flow.steps[1].id, 'S2');
    assert.equal(flow.steps[2].id, 'S3');
  });

  it('parses app and appUrl metadata', () => {
    const yaml = `
version: 2
name: omi-test
app: Omi
app_url: https://omi.me

steps:
  - id: S1
    do: Check home
`;
    const flow = parseFlowV2(yaml);
    assert.equal(flow.app, 'Omi');
    assert.equal(flow.appUrl, 'https://omi.me');
  });

  it('strips inline YAML comments', () => {
    const yaml = `
version: 2
name: comment-test
preconditions:
  - auth_ready  # User must be signed in

steps:
  - id: S1
    do: Check home
`;
    const flow = parseFlowV2(yaml);
    assert.equal(flow.preconditions![0], 'auth_ready');
  });

  it('throws on missing name', () => {
    const yaml = `
version: 2
description: No name
steps:
  - id: S1
    do: Check
`;
    assert.throws(() => parseFlowV2(yaml), /missing required field: name/i);
  });

  it('throws on empty steps', () => {
    const yaml = `
version: 2
name: empty
steps:
`;
    assert.throws(() => parseFlowV2(yaml), /no steps/i);
  });

  it('parses multi-line scalar (folded >)', () => {
    const yaml = `
version: 2
name: multiline-test

steps:
  - id: S1
    do: >
      Open the settings screen
      and verify elements
`;
    const flow = parseFlowV2(yaml);
    assert.equal(flow.steps[0].do, 'Open the settings screen and verify elements');
  });

  it('rejects legacy step keys (scroll, press, etc.)', () => {
    const yaml = `
version: 2
name: legacy-test

steps:
  - id: S1
    do: Check home
    scroll: down
`;
    assert.throws(() => parseFlowV2(yaml), /legacy action key/i);
  });

  it('parses claim field', () => {
    const yaml = `
version: 2
name: claim-test

steps:
  - id: S1
    do: Open the settings page
    claim: Settings page is visible with all options
`;
    const flow = parseFlowV2(yaml);
    assert.equal(flow.steps[0].claim, 'Settings page is visible with all options');
  });

  it('claim defaults to undefined when not specified', () => {
    const yaml = `
version: 2
name: no-claim

steps:
  - id: S1
    do: Check home
`;
    const flow = parseFlowV2(yaml);
    assert.equal(flow.steps[0].claim, undefined);
  });

  it('parses judge block with prompt', () => {
    const yaml = `
version: 2
name: judge-test

steps:
  - id: S1
    do: Open home screen
    judge:
      - prompt: Does the screenshot show a home screen with a tab bar?
        screenshot: step-S1
        look_for: [tab bar, home icon]
        fail_if: [error dialog, crash]
`;
    const flow = parseFlowV2(yaml);
    const judge = flow.steps[0].judge!;
    assert.equal(judge.length, 1);
    assert.equal(judge[0].prompt, 'Does the screenshot show a home screen with a tab bar?');
    assert.equal(judge[0].screenshot, 'step-S1');
    assert.deepEqual(judge[0].look_for, ['tab bar', 'home icon']);
    assert.deepEqual(judge[0].fail_if, ['error dialog', 'crash']);
  });

  it('parses judge with id field', () => {
    const yaml = `
version: 2
name: judge-id-test

steps:
  - id: S1
    do: Open settings
    judge:
      - id: check-settings
        prompt: Are settings options visible?
`;
    const flow = parseFlowV2(yaml);
    const judge = flow.steps[0].judge!;
    assert.equal(judge.length, 1);
    assert.equal(judge[0].id, 'check-settings');
    assert.equal(judge[0].prompt, 'Are settings options visible?');
  });

  it('parses multiple judge entries', () => {
    const yaml = `
version: 2
name: multi-judge

steps:
  - id: S1
    do: Navigate to profile
    judge:
      - prompt: Is the profile avatar visible?
        screenshot: step-S1
      - prompt: Is the username displayed correctly?
        look_for: [username, avatar]
`;
    const flow = parseFlowV2(yaml);
    assert.equal(flow.steps[0].judge!.length, 2);
    assert.equal(flow.steps[0].judge![0].prompt, 'Is the profile avatar visible?');
    assert.equal(flow.steps[0].judge![1].prompt, 'Is the username displayed correctly?');
  });

  it('parses expect with min field', () => {
    const yaml = `
version: 2
name: min-test

steps:
  - id: S1
    do: Verify elements
    expect:
      - milestone: elements-visible
        kind: element-count
        min: 10
`;
    const flow = parseFlowV2(yaml);
    assert.equal(flow.steps[0].expect![0].min, 10);
  });
});
