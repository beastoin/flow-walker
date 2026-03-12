import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isSafe, filterSafe } from '../src/safety.ts';
import type { SnapshotElement } from '../src/types.ts';

function el(ref: string, type: string, text: string, opts?: Partial<SnapshotElement>): SnapshotElement {
  return { ref, type, text, enabled: true, ...opts };
}

describe('isSafe', () => {
  it('returns safe for normal button', () => {
    const element = el('@e1', 'button', 'Save');
    const result = isSafe(element, []);
    assert.equal(result.safe, true);
  });

  it('blocks element with "delete" in text', () => {
    const element = el('@e1', 'button', 'Delete Account');
    const result = isSafe(element, []);
    assert.equal(result.safe, false);
    assert.ok(result.reason?.includes('delete'));
  });

  it('blocks element with "sign out" in text', () => {
    const element = el('@e1', 'button', 'Sign Out');
    const result = isSafe(element, []);
    assert.equal(result.safe, false);
    assert.ok(result.reason?.includes('sign out'));
  });

  it('blocks element with "remove" in text', () => {
    const element = el('@e1', 'button', 'Remove Device');
    const result = isSafe(element, []);
    assert.equal(result.safe, false);
  });

  it('blocks element with "reset" in text', () => {
    const element = el('@e1', 'button', 'Reset All Settings');
    const result = isSafe(element, []);
    assert.equal(result.safe, false);
  });

  it('blocks element with "unpair" in text', () => {
    const element = el('@e1', 'button', 'Unpair Device');
    const result = isSafe(element, []);
    assert.equal(result.safe, false);
  });

  it('blocks element with "logout" in text', () => {
    const element = el('@e1', 'button', 'Logout');
    const result = isSafe(element, []);
    assert.equal(result.safe, false);
  });

  it('blocks disabled elements', () => {
    const element = el('@e1', 'button', 'Save', { enabled: false });
    const result = isSafe(element, []);
    assert.equal(result.safe, false);
    assert.ok(result.reason?.includes('disabled'));
  });

  it('is case-insensitive on blocklist matching', () => {
    const element = el('@e1', 'button', 'DELETE');
    const result = isSafe(element, []);
    assert.equal(result.safe, false);
  });

  it('blocks based on nearby element text', () => {
    const target = el('@e1', 'button', 'Confirm', { bounds: { x: 100, y: 200, width: 80, height: 40 } });
    const nearby = el('@e2', 'label', 'Delete Account', { bounds: { x: 100, y: 180, width: 200, height: 20 } });
    const result = isSafe(target, [target, nearby]);
    assert.equal(result.safe, false);
    assert.ok(result.reason?.includes('nearby'));
  });

  it('allows custom blocklist', () => {
    const element = el('@e1', 'button', 'Explode');
    const result = isSafe(element, [], ['explode']);
    assert.equal(result.safe, false);
  });

  it('does not block when custom blocklist is empty', () => {
    const element = el('@e1', 'button', 'Delete');
    const result = isSafe(element, [], []);
    assert.equal(result.safe, true);
  });
});

describe('filterSafe', () => {
  it('separates safe and unsafe elements', () => {
    const elements = [
      el('@e1', 'button', 'Save'),
      el('@e2', 'button', 'Delete'),
      el('@e3', 'button', 'Cancel'),
      el('@e4', 'button', 'Sign Out'),
    ];

    const [safe, skipped] = filterSafe(elements);
    assert.equal(safe.length, 2);
    assert.equal(skipped.length, 2);
    assert.deepEqual(safe.map(e => e.text), ['Save', 'Cancel']);
    assert.deepEqual(skipped.map(s => s.element.text), ['Delete', 'Sign Out']);
  });

  it('returns all elements as safe when none match blocklist', () => {
    const elements = [
      el('@e1', 'button', 'Save'),
      el('@e2', 'button', 'Next'),
    ];

    const [safe, skipped] = filterSafe(elements);
    assert.equal(safe.length, 2);
    assert.equal(skipped.length, 0);
  });
});
