import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir } from '../src/capture.ts';

describe('ensureDir', () => {
  const testBase = join(import.meta.dirname!, '..', '.test-tmp');

  it('creates directory if it does not exist', () => {
    const dir = join(testBase, 'ensureDir-new');
    try { rmdirSync(dir, { recursive: true } as any); } catch {}
    ensureDir(dir);
    assert.ok(existsSync(dir));
    rmdirSync(dir, { recursive: true } as any);
  });

  it('does not throw if directory already exists', () => {
    const dir = join(testBase, 'ensureDir-exists');
    mkdirSync(dir, { recursive: true });
    assert.doesNotThrow(() => ensureDir(dir));
    rmdirSync(dir, { recursive: true } as any);
  });

  it('creates nested directories', () => {
    const dir = join(testBase, 'ensureDir-nested', 'a', 'b');
    try { rmdirSync(join(testBase, 'ensureDir-nested'), { recursive: true } as any); } catch {}
    ensureDir(dir);
    assert.ok(existsSync(dir));
    rmdirSync(join(testBase, 'ensureDir-nested'), { recursive: true } as any);
  });

  // Cleanup test base
  it('cleanup', () => {
    try { rmdirSync(testBase, { recursive: true } as any); } catch {}
    assert.ok(true);
  });
});

describe('capture module exports', () => {
  it('exports screenshot function', async () => {
    const mod = await import('../src/capture.ts');
    assert.equal(typeof mod.screenshot, 'function');
  });

  it('exports startRecording function', async () => {
    const mod = await import('../src/capture.ts');
    assert.equal(typeof mod.startRecording, 'function');
  });

  it('exports stopRecording function', async () => {
    const mod = await import('../src/capture.ts');
    assert.equal(typeof mod.stopRecording, 'function');
  });

  it('exports startLogcat function', async () => {
    const mod = await import('../src/capture.ts');
    assert.equal(typeof mod.startLogcat, 'function');
  });

  it('exports stopLogcat function', async () => {
    const mod = await import('../src/capture.ts');
    assert.equal(typeof mod.stopLogcat, 'function');
  });

  it('exports getDeviceName function', async () => {
    const mod = await import('../src/capture.ts');
    assert.equal(typeof mod.getDeviceName, 'function');
  });

  it('exports ensureDir function', async () => {
    const mod = await import('../src/capture.ts');
    assert.equal(typeof mod.ensureDir, 'function');
  });
});
