import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_SCHEMAS, getCommandSchema } from '../src/command-schema.ts';

describe('COMMAND_SCHEMAS', () => {
  it('contains walk, run, report, and schema commands', () => {
    const names = COMMAND_SCHEMAS.map(s => s.name);
    assert.ok(names.includes('walk'));
    assert.ok(names.includes('run'));
    assert.ok(names.includes('report'));
    assert.ok(names.includes('schema'));
  });

  it('has exactly 4 commands', () => {
    assert.equal(COMMAND_SCHEMAS.length, 4);
  });

  it('every schema has required fields', () => {
    for (const schema of COMMAND_SCHEMAS) {
      assert.ok(schema.name, `missing name`);
      assert.ok(schema.description, `${schema.name}: missing description`);
      assert.ok(Array.isArray(schema.args), `${schema.name}: args not array`);
      assert.ok(Array.isArray(schema.flags), `${schema.name}: flags not array`);
      assert.ok(typeof schema.exitCodes === 'object', `${schema.name}: exitCodes not object`);
      assert.ok(Array.isArray(schema.examples), `${schema.name}: examples not array`);
      assert.ok(schema.examples.length > 0, `${schema.name}: no examples`);
    }
  });

  it('walk schema has --json and --dry-run flags', () => {
    const walk = getCommandSchema('walk');
    assert.ok(walk);
    const flagNames = walk.flags.map(f => f.name);
    assert.ok(flagNames.includes('--json'));
    assert.ok(flagNames.includes('--dry-run'));
  });

  it('run schema has required flow arg', () => {
    const run = getCommandSchema('run');
    assert.ok(run);
    assert.ok(run.args.some(a => a.name === 'flow' && a.required));
  });

  it('run schema has --dry-run flag', () => {
    const run = getCommandSchema('run');
    assert.ok(run);
    assert.ok(run.flags.some(f => f.name === '--dry-run'));
  });

  it('run schema has exit code 1 for failing steps', () => {
    const run = getCommandSchema('run');
    assert.ok(run);
    assert.ok(run.exitCodes['1']);
  });

  it('report schema has required run-dir arg', () => {
    const report = getCommandSchema('report');
    assert.ok(report);
    assert.ok(report.args.some(a => a.name === 'run-dir' && a.required));
  });

  it('schema command has optional command arg', () => {
    const schema = getCommandSchema('schema');
    assert.ok(schema);
    assert.ok(schema.args.some(a => a.name === 'command' && !a.required));
  });

  it('all exit codes include 0 and 2', () => {
    for (const schema of COMMAND_SCHEMAS) {
      assert.ok(schema.exitCodes['0'], `${schema.name}: missing exit code 0`);
      assert.ok(schema.exitCodes['2'], `${schema.name}: missing exit code 2`);
    }
  });
});

describe('getCommandSchema', () => {
  it('returns schema for known command', () => {
    const schema = getCommandSchema('run');
    assert.ok(schema);
    assert.equal(schema.name, 'run');
  });

  it('returns undefined for unknown command', () => {
    const schema = getCommandSchema('nonexistent');
    assert.equal(schema, undefined);
  });
});
