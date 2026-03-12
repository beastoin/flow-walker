import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  rejectControlChars,
  validateFlowPath,
  validateOutputDir,
  validateUri,
  validateBundleId,
  validateRunDir,
} from '../src/validate.ts';
import { FlowWalkerError } from '../src/errors.ts';

const tmpDir = join(import.meta.dirname!, '..', '.test-tmp-validate');

describe('rejectControlChars', () => {
  it('accepts normal strings', () => {
    assert.doesNotThrow(() => rejectControlChars('hello world', 'test'));
  });

  it('accepts newlines and tabs', () => {
    assert.doesNotThrow(() => rejectControlChars('line1\nline2\ttab', 'test'));
  });

  it('rejects null byte', () => {
    assert.throws(() => rejectControlChars('bad\x00input', 'test'), FlowWalkerError);
  });

  it('rejects bell character', () => {
    assert.throws(() => rejectControlChars('bad\x07input', 'test'), FlowWalkerError);
  });

  it('rejects backspace', () => {
    assert.throws(() => rejectControlChars('bad\x08input', 'test'), FlowWalkerError);
  });

  it('error has INVALID_INPUT code', () => {
    try {
      rejectControlChars('bad\x00input', 'Path');
      assert.fail('should throw');
    } catch (err) {
      assert.ok(err instanceof FlowWalkerError);
      assert.equal(err.code, 'INVALID_INPUT');
      assert.ok(err.message.includes('Path'));
    }
  });
});

describe('validateFlowPath', () => {
  it('accepts valid .yaml file', () => {
    mkdirSync(tmpDir, { recursive: true });
    const p = join(tmpDir, 'test.yaml');
    writeFileSync(p, 'name: test\nsteps:\n  - name: s1\n');
    assert.doesNotThrow(() => validateFlowPath(p));
    unlinkSync(p);
    rmdirSync(tmpDir);
  });

  it('accepts valid .yml file', () => {
    mkdirSync(tmpDir, { recursive: true });
    const p = join(tmpDir, 'test.yml');
    writeFileSync(p, 'name: test\nsteps:\n  - name: s1\n');
    assert.doesNotThrow(() => validateFlowPath(p));
    unlinkSync(p);
    rmdirSync(tmpDir);
  });

  it('rejects non-yaml extension', () => {
    assert.throws(() => validateFlowPath('/tmp/test.json'), FlowWalkerError);
  });

  it('rejects path traversal', () => {
    assert.throws(() => validateFlowPath('../../../etc/passwd.yaml'), FlowWalkerError);
  });

  it('rejects nonexistent file', () => {
    try {
      validateFlowPath('/tmp/definitely-not-here-xyz.yaml');
      assert.fail('should throw');
    } catch (err) {
      assert.ok(err instanceof FlowWalkerError);
      assert.equal(err.code, 'FILE_NOT_FOUND');
    }
  });

  it('rejects control characters', () => {
    assert.throws(() => validateFlowPath('/tmp/bad\x00.yaml'), FlowWalkerError);
  });
});

describe('validateOutputDir', () => {
  it('accepts normal paths', () => {
    assert.doesNotThrow(() => validateOutputDir('./output'));
    assert.doesNotThrow(() => validateOutputDir('/tmp/results'));
  });

  it('rejects path traversal', () => {
    assert.throws(() => validateOutputDir('../../etc'), FlowWalkerError);
  });

  it('rejects control characters', () => {
    assert.throws(() => validateOutputDir('/tmp/bad\x00dir'), FlowWalkerError);
  });
});

describe('validateUri', () => {
  it('accepts valid ws:// URI', () => {
    assert.doesNotThrow(() => validateUri('ws://127.0.0.1:38047/abc=/ws'));
  });

  it('accepts valid wss:// URI', () => {
    assert.doesNotThrow(() => validateUri('wss://secure.host:443/path'));
  });

  it('rejects http:// URI', () => {
    assert.throws(() => validateUri('http://127.0.0.1:38047'), FlowWalkerError);
  });

  it('rejects empty string', () => {
    assert.throws(() => validateUri(''), FlowWalkerError);
  });

  it('rejects control characters', () => {
    assert.throws(() => validateUri('ws://bad\x00host'), FlowWalkerError);
  });

  it('error has hint with example', () => {
    try {
      validateUri('http://wrong');
      assert.fail('should throw');
    } catch (err) {
      assert.ok(err instanceof FlowWalkerError);
      assert.ok(err.hint?.includes('ws://'));
    }
  });
});

describe('validateBundleId', () => {
  it('accepts valid reverse-domain ID', () => {
    assert.doesNotThrow(() => validateBundleId('com.example.app'));
    assert.doesNotThrow(() => validateBundleId('com.friend.ios.dev'));
  });

  it('rejects single-segment ID', () => {
    assert.throws(() => validateBundleId('myapp'), FlowWalkerError);
  });

  it('rejects control characters', () => {
    assert.throws(() => validateBundleId('com.bad\x00.app'), FlowWalkerError);
  });

  it('rejects starting with number', () => {
    assert.throws(() => validateBundleId('123.example.app'), FlowWalkerError);
  });
});

describe('validateRunDir', () => {
  it('accepts directory with run.json', () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'run.json'), '{}');
    assert.doesNotThrow(() => validateRunDir(tmpDir));
    unlinkSync(join(tmpDir, 'run.json'));
    rmdirSync(tmpDir);
  });

  it('rejects nonexistent directory', () => {
    try {
      validateRunDir('/tmp/no-such-dir-xyz');
      assert.fail('should throw');
    } catch (err) {
      assert.ok(err instanceof FlowWalkerError);
      assert.equal(err.code, 'FILE_NOT_FOUND');
    }
  });

  it('rejects directory without run.json', () => {
    mkdirSync(tmpDir, { recursive: true });
    try {
      validateRunDir(tmpDir);
      assert.fail('should throw');
    } catch (err) {
      assert.ok(err instanceof FlowWalkerError);
      assert.equal(err.code, 'FILE_NOT_FOUND');
      assert.ok(err.message.includes('run.json'));
    }
    rmdirSync(tmpDir);
  });

  it('rejects path traversal', () => {
    assert.throws(() => validateRunDir('../../etc'), FlowWalkerError);
  });
});
