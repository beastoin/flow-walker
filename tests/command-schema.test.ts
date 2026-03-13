import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_SCHEMAS, getCommandSchema, getSchemaEnvelope, SCHEMA_VERSION } from '../src/command-schema.ts';

describe('COMMAND_SCHEMAS', () => {
  it('contains all 8 v2 commands', () => {
    const names = COMMAND_SCHEMAS.map(s => s.name);
    for (const cmd of ['walk', 'record', 'verify', 'report', 'push', 'get', 'migrate', 'schema']) {
      assert.ok(names.includes(cmd), `missing ${cmd}`);
    }
    assert.equal(COMMAND_SCHEMAS.length, 8);
  });
  it('does not include legacy run command', () => {
    assert.equal(getCommandSchema('run'), undefined);
  });
  it('every schema has required fields', () => {
    for (const schema of COMMAND_SCHEMAS) {
      assert.ok(schema.name); assert.ok(schema.description);
      assert.ok(Array.isArray(schema.args)); assert.ok(Array.isArray(schema.flags));
    }
  });
  it('walk schema has --json and --dry-run flags', () => {
    const walk = getCommandSchema('walk');
    assert.ok(walk);
    const flagNames = walk.flags.map(f => f.name);
    assert.ok(flagNames.includes('--json')); assert.ok(flagNames.includes('--dry-run'));
  });
  it('verify schema has --mode flag with enum', () => {
    const verify = getCommandSchema('verify');
    assert.ok(verify);
    const modeFlag = verify.flags.find(f => f.name === '--mode');
    assert.ok(modeFlag); assert.ok(modeFlag.enum);
    assert.ok(modeFlag.enum!.includes('strict'));
    assert.ok(modeFlag.enum!.includes('balanced'));
    assert.ok(modeFlag.enum!.includes('audit'));
  });
  it('record schema has required sub arg', () => {
    const record = getCommandSchema('record');
    assert.ok(record); assert.ok(record.args.some(a => a.name === 'sub' && a.required));
  });
  it('migrate schema has required flow arg', () => {
    const migrate = getCommandSchema('migrate');
    assert.ok(migrate); assert.ok(migrate.args.some(a => a.name === 'flow' && a.required));
  });
  it('report schema has required run-dir arg', () => {
    const report = getCommandSchema('report');
    assert.ok(report); assert.ok(report.args.some(a => a.name === 'run-dir' && a.required));
  });
  it('schema command has optional command arg', () => {
    const schema = getCommandSchema('schema');
    assert.ok(schema); assert.ok(schema.args.some(a => a.name === 'command' && !a.required));
  });
  it('get schema has required run-id arg', () => {
    const get = getCommandSchema('get');
    assert.ok(get); assert.ok(get.args.some(a => a.name === 'run-id' && a.required));
  });
  it('boolean flags have no default', () => {
    for (const schema of COMMAND_SCHEMAS) {
      for (const flag of schema.flags) {
        if (flag.type === 'boolean') assert.equal(flag.default, undefined, `${schema.name} ${flag.name}`);
      }
    }
  });
});
describe('getSchemaEnvelope', () => {
  it('returns version and commands', () => {
    const envelope = getSchemaEnvelope();
    assert.ok(envelope.version); assert.ok(Array.isArray(envelope.commands));
    assert.equal(envelope.commands.length, COMMAND_SCHEMAS.length);
  });
  it('version matches SCHEMA_VERSION', () => { assert.equal(getSchemaEnvelope().version, SCHEMA_VERSION); });
  it('version is semver format', () => { assert.match(SCHEMA_VERSION, /^\d+\.\d+\.\d+$/); });
  it('SCHEMA_VERSION is 2.0.0', () => { assert.equal(SCHEMA_VERSION, '2.0.0'); });
});
describe('getCommandSchema', () => {
  it('returns schema for known command', () => { const s = getCommandSchema('walk'); assert.ok(s); assert.equal(s.name, 'walk'); });
  it('returns undefined for unknown command', () => { assert.equal(getCommandSchema('nonexistent'), undefined); });
});
