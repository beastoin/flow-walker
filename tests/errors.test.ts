import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FlowWalkerError, ErrorCodes, formatError } from '../src/errors.ts';

describe('FlowWalkerError', () => {
  it('has code, message, and diagnosticId', () => {
    const err = new FlowWalkerError(ErrorCodes.INVALID_INPUT, 'bad input');
    assert.equal(err.code, 'INVALID_INPUT');
    assert.equal(err.message, 'bad input');
    assert.equal(typeof err.diagnosticId, 'string');
    assert.equal(err.diagnosticId.length, 8);
  });

  it('includes hint when provided', () => {
    const err = new FlowWalkerError(ErrorCodes.FILE_NOT_FOUND, 'not found', 'check path');
    assert.equal(err.hint, 'check path');
  });

  it('generates unique diagnosticId per instance', () => {
    const err1 = new FlowWalkerError(ErrorCodes.COMMAND_FAILED, 'a');
    const err2 = new FlowWalkerError(ErrorCodes.COMMAND_FAILED, 'b');
    assert.notEqual(err1.diagnosticId, err2.diagnosticId);
  });

  it('toJSON returns structured error envelope', () => {
    const err = new FlowWalkerError(ErrorCodes.DEVICE_ERROR, 'device gone', 'check adb');
    const json = err.toJSON();
    assert.equal(json.error.code, 'DEVICE_ERROR');
    assert.equal(json.error.message, 'device gone');
    assert.equal(json.error.hint, 'check adb');
    assert.equal(json.error.diagnosticId, err.diagnosticId);
  });

  it('toJSON omits hint when not provided', () => {
    const err = new FlowWalkerError(ErrorCodes.COMMAND_FAILED, 'fail');
    const json = err.toJSON();
    assert.equal(json.error.hint, undefined);
    assert.ok(!('hint' in json.error));
  });

  it('is instanceof Error', () => {
    const err = new FlowWalkerError(ErrorCodes.INVALID_ARGS, 'x');
    assert.ok(err instanceof Error);
  });
});

describe('ErrorCodes', () => {
  it('has all required codes', () => {
    assert.ok(ErrorCodes.INVALID_ARGS);
    assert.ok(ErrorCodes.INVALID_INPUT);
    assert.ok(ErrorCodes.FILE_NOT_FOUND);
    assert.ok(ErrorCodes.FLOW_PARSE_ERROR);
    assert.ok(ErrorCodes.STEP_FAILED);
    assert.ok(ErrorCodes.DEVICE_ERROR);
    assert.ok(ErrorCodes.COMMAND_FAILED);
  });
});

describe('formatError', () => {
  it('formats FlowWalkerError as JSON', () => {
    const err = new FlowWalkerError(ErrorCodes.INVALID_INPUT, 'bad', 'fix it');
    const out = formatError(err, true);
    const parsed = JSON.parse(out);
    assert.equal(parsed.error.code, 'INVALID_INPUT');
    assert.equal(parsed.error.message, 'bad');
    assert.equal(parsed.error.hint, 'fix it');
    assert.ok(parsed.error.diagnosticId);
  });

  it('formats FlowWalkerError as human text', () => {
    const err = new FlowWalkerError(ErrorCodes.FILE_NOT_FOUND, 'missing', 'check path');
    const out = formatError(err, false);
    assert.ok(out.includes('FILE_NOT_FOUND'));
    assert.ok(out.includes('missing'));
    assert.ok(out.includes('Hint: check path'));
    assert.ok(out.includes(err.diagnosticId));
  });

  it('wraps unknown errors with COMMAND_FAILED code', () => {
    const out = formatError('something broke', true);
    const parsed = JSON.parse(out);
    assert.equal(parsed.error.code, 'COMMAND_FAILED');
    assert.ok(parsed.error.message.includes('something broke'));
    assert.ok(parsed.error.diagnosticId);
  });

  it('wraps Error objects with COMMAND_FAILED code', () => {
    const out = formatError(new Error('native error'), true);
    const parsed = JSON.parse(out);
    assert.equal(parsed.error.code, 'COMMAND_FAILED');
    assert.ok(parsed.error.message.includes('native error'));
  });
});
