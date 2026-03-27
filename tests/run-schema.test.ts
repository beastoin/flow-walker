import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateRunId } from '../src/run-schema.ts';

describe('generateRunId', () => {
  it('returns a 10-character string', () => {
    const id = generateRunId();
    assert.equal(id.length, 10);
  });

  it('is URL-safe (base64url charset)', () => {
    const id = generateRunId();
    assert.match(id, /^[A-Za-z0-9_-]+$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRunId()));
    assert.equal(ids.size, 100);
  });
});
