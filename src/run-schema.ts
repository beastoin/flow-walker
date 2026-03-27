// Run ID generation for flow-walker

import { randomBytes } from 'node:crypto';

/** Generate a short URL-safe run ID (10 chars, base64url) */
export function generateRunId(): string {
  // 8 random bytes → 10 base64url chars (after trimming padding)
  // Collision probability: ~1 in 2^64 — safe for any practical volume
  return randomBytes(8)
    .toString('base64url')
    .slice(0, 10);
}
