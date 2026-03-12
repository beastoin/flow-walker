import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeFingerprint, deriveScreenName } from '../src/fingerprint.ts';
import type { SnapshotElement } from '../src/types.ts';

function el(type: string, text: string = '', flutterType?: string): SnapshotElement {
  return { ref: '@e1', type, text, flutterType, enabled: true };
}

describe('computeFingerprint', () => {
  it('returns deterministic hash for identical element sets', () => {
    const elements = [el('button', 'Save'), el('button', 'Cancel'), el('textfield', 'Name')];
    const hash1 = computeFingerprint(elements);
    const hash2 = computeFingerprint(elements);
    assert.equal(hash1, hash2, 'same elements should produce identical hash');
  });

  it('produces same hash regardless of element order', () => {
    const a = [el('button', 'A'), el('textfield', 'B')];
    const b = [el('textfield', 'B'), el('button', 'A')];
    assert.equal(computeFingerprint(a), computeFingerprint(b));
  });

  it('ignores text content — same types with different text produce same hash', () => {
    const a = [el('button', 'Save'), el('button', 'Next')];
    const b = [el('button', 'Delete'), el('button', 'Back')];
    assert.equal(computeFingerprint(a), computeFingerprint(b));
  });

  it('different element types produce different hashes', () => {
    const a = [el('button', 'Go'), el('button', 'Stop')];
    const b = [el('textfield', 'Name'), el('textfield', 'Email')];
    assert.notEqual(computeFingerprint(a), computeFingerprint(b));
  });

  it('uses flutterType when available for fingerprinting', () => {
    const withFlutter = [el('button', 'Go', 'ElevatedButton')];
    const withoutFlutter = [el('button', 'Go')];
    assert.notEqual(computeFingerprint(withFlutter), computeFingerprint(withoutFlutter));
  });

  it('bucketing: minor count differences produce same hash', () => {
    // 2 buttons vs 3 buttons both bucket to 2
    const two = [el('button', 'A'), el('button', 'B')];
    const three = [el('button', 'A'), el('button', 'B'), el('button', 'C')];
    assert.equal(computeFingerprint(two), computeFingerprint(three));
  });

  it('bucketing: large count differences produce different hash', () => {
    // 1 button vs 8 buttons
    const one = [el('button', 'A')];
    const eight = Array.from({ length: 8 }, (_, i) => el('button', String(i)));
    assert.notEqual(computeFingerprint(one), computeFingerprint(eight));
  });

  it('returns a 12-char hex string', () => {
    const hash = computeFingerprint([el('button', 'X')]);
    assert.match(hash, /^[0-9a-f]{12}$/);
  });

  it('handles empty element list', () => {
    const hash = computeFingerprint([]);
    assert.match(hash, /^[0-9a-f]{12}$/);
  });
});

describe('deriveScreenName', () => {
  it('uses first short text as screen name', () => {
    const elements = [el('button', 'Settings'), el('button', 'Profile')];
    const name = deriveScreenName(elements);
    assert.equal(name, 'settings');
  });

  it('converts to kebab-case', () => {
    const elements = [el('button', 'My Profile Page')];
    const name = deriveScreenName(elements);
    assert.equal(name, 'my-profile-page');
  });

  it('falls back to type-based name when no text', () => {
    const elements = [el('button', ''), el('button', '')];
    const name = deriveScreenName(elements);
    assert.match(name, /^screen-button-2$/);
  });
});
