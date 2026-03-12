import { createHash } from 'node:crypto';
import type { SnapshotElement } from './types.ts';

/**
 * Compute a deterministic screen fingerprint from interactive elements.
 * Uses element types and counts only — ignores text content (which is dynamic).
 * Similar screens with minor count differences produce the same fingerprint
 * via count bucketing.
 */
export function computeFingerprint(elements: SnapshotElement[]): string {
  // Count elements by type
  const typeCounts = new Map<string, number>();
  for (const el of elements) {
    const key = el.flutterType || el.type;
    typeCounts.set(key, (typeCounts.get(key) || 0) + 1);
  }

  // Bucket counts to handle minor variations (e.g., list length differences)
  // 0 → 0, 1 → 1, 2-3 → 2, 4-7 → 4, 8+ → 8
  const bucketed = new Map<string, number>();
  for (const [type, count] of typeCounts) {
    bucketed.set(type, bucketCount(count));
  }

  // Sort by type name for determinism
  const sorted = [...bucketed.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  // Hash the type:count pairs
  const input = sorted.map(([type, count]) => `${type}:${count}`).join('|');
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

/** Bucket a count to reduce sensitivity to minor variations */
function bucketCount(n: number): number {
  if (n <= 1) return n;
  if (n <= 3) return 2;
  if (n <= 7) return 4;
  return 8;
}

/**
 * Derive a human-readable screen name from its elements.
 * Picks the most descriptive text from the first few elements.
 */
export function deriveScreenName(elements: SnapshotElement[]): string {
  // Look for text that looks like a title (short, at top of screen)
  const candidates = elements
    .filter(el => el.text && el.text.length > 0 && el.text.length < 40)
    .map(el => el.text);

  if (candidates.length > 0) {
    return toKebabCase(candidates[0]);
  }

  // Fallback: use dominant element type
  const types = elements.map(el => el.type);
  const dominant = mode(types) || 'unknown';
  return `screen-${dominant}-${elements.length}`;
}

function toKebabCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function mode(arr: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const item of arr) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [item, count] of counts) {
    if (count > bestCount) {
      best = item;
      bestCount = count;
    }
  }
  return best;
}
