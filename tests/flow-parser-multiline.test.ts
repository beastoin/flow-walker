import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlowV2 } from '../src/flow-parser.ts';

describe('YAML folded scalar >', () => {
  it('joins continuation lines with spaces', () => {
    const yaml = `version: 2
name: test
steps:
  - id: S1
    do: >
      Verify the home screen
      shows the heading
      and footer
`;
    const flow = parseFlowV2(yaml);
    assert.ok(flow.steps[0].do.includes('Verify the home screen'));
    assert.ok(flow.steps[0].do.includes('shows the heading'));
    assert.ok(flow.steps[0].do.includes('and footer'));
    assert.ok(!flow.steps[0].do.includes('\n'));
  });

  it('works with do: field', () => {
    const yaml = `version: 2
name: test
steps:
  - id: S1
    do: >
      First line
      second line
`;
    const flow = parseFlowV2(yaml);
    assert.equal(flow.steps[0].do, 'First line second line');
  });

  it('works with note: field', () => {
    const yaml = `version: 2
name: test
steps:
  - id: S1
    do: simple action
    note: >
      This is a long
      multi-line note
`;
    const flow = parseFlowV2(yaml);
    assert.equal(flow.steps[0].note, 'This is a long multi-line note');
  });

  it('works with description: field', () => {
    const yaml = `version: 2
name: test
description: >
  A long description
  that spans lines
steps:
  - id: S1
    do: test
`;
    const flow = parseFlowV2(yaml);
    assert.equal(flow.description, 'A long description that spans lines');
  });

  it('stops at less-indented line', () => {
    const yaml = `version: 2
name: test
steps:
  - id: S1
    do: >
      Line one
      Line two
    verify: true
`;
    const flow = parseFlowV2(yaml);
    assert.equal(flow.steps[0].do, 'Line one Line two');
    assert.equal(flow.steps[0].verify, true);
  });
});

describe('YAML literal scalar |', () => {
  it('joins continuation lines with newlines', () => {
    const yaml = `version: 2
name: test
steps:
  - id: S1
    do: |
      Line one
      Line two
      Line three
`;
    const flow = parseFlowV2(yaml);
    assert.ok(flow.steps[0].do.includes('Line one'));
    assert.ok(flow.steps[0].do.includes('\n'));
    assert.ok(flow.steps[0].do.includes('Line two'));
    assert.ok(flow.steps[0].do.includes('Line three'));
  });

  it('preserves newlines between lines', () => {
    const yaml = `version: 2
name: test
steps:
  - id: S1
    do: |
      Step A
      Step B
`;
    const flow = parseFlowV2(yaml);
    const parts = flow.steps[0].do.split('\n');
    assert.equal(parts[0], 'Step A');
    assert.equal(parts[1], 'Step B');
  });
});

describe('mixed scalar styles', () => {
  it('handles inline and multi-line in same flow', () => {
    const yaml = `version: 2
name: mixed
steps:
  - id: S1
    do: "Simple inline action"
  - id: S2
    do: >
      Multi-line folded
      action here
  - id: S3
    do: |
      Literal block
      with newlines
`;
    const flow = parseFlowV2(yaml);
    assert.equal(flow.steps[0].do, 'Simple inline action');
    assert.equal(flow.steps[1].do, 'Multi-line folded action here');
    assert.ok(flow.steps[2].do.includes('Literal block'));
    assert.ok(flow.steps[2].do.includes('\n'));
  });
});
