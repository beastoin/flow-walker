import type { SnapshotElement } from './types.ts';

const DEFAULT_BLOCKLIST = [
  'delete', 'sign out', 'remove', 'reset', 'unpair', 'logout', 'clear all',
  'delete account', 'factory reset', 'erase', 'uninstall',
];

/**
 * Check if an element is safe to press.
 * Returns { safe: true } or { safe: false, reason: string }.
 */
export function isSafe(
  element: SnapshotElement,
  nearbyElements: SnapshotElement[],
  blocklist: string[] = DEFAULT_BLOCKLIST,
): { safe: boolean; reason?: string } {
  // Skip disabled elements
  if (element.enabled === false) {
    return { safe: false, reason: 'element is disabled' };
  }

  // Check element's own text against blocklist
  const elementText = element.text.toLowerCase();
  for (const keyword of blocklist) {
    if (elementText.includes(keyword.toLowerCase())) {
      return { safe: false, reason: `text matches blocklist: "${keyword}"` };
    }
  }

  // Check nearby elements' text for context clues
  // "nearby" = elements within a small vertical range
  if (element.bounds) {
    const nearbyTexts = nearbyElements
      .filter(el => {
        if (!el.bounds || el.ref === element.ref) return false;
        const verticalDist = Math.abs(el.bounds.y - element.bounds!.y);
        return verticalDist < 60; // within 60px vertically
      })
      .map(el => el.text.toLowerCase());

    for (const text of nearbyTexts) {
      for (const keyword of blocklist) {
        if (text.includes(keyword.toLowerCase())) {
          return { safe: false, reason: `nearby text matches blocklist: "${keyword}"` };
        }
      }
    }
  }

  return { safe: true };
}

/**
 * Filter a list of elements to only safe-to-press ones.
 * Returns [safeElements, skippedElements].
 */
export function filterSafe(
  elements: SnapshotElement[],
  blocklist: string[] = DEFAULT_BLOCKLIST,
): [SnapshotElement[], Array<{ element: SnapshotElement; reason: string }>] {
  const safe: SnapshotElement[] = [];
  const skipped: Array<{ element: SnapshotElement; reason: string }> = [];

  for (const el of elements) {
    const result = isSafe(el, elements, blocklist);
    if (result.safe) {
      safe.push(el);
    } else {
      skipped.push({ element: el, reason: result.reason! });
    }
  }

  return [safe, skipped];
}
