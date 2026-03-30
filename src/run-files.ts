/**
 * Resolve files in a run directory — supports both fixed names and timestamped variants.
 *
 * All files except run.meta.json are timestamped (e.g., 20260330T100000Z-events.jsonl).
 * This module finds them regardless of naming.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Find a file by fixed name or timestamped variant (e.g., {ts}-events.jsonl). */
export function findRunFile(dir: string, fixedName: string): string {
  const fixed = join(dir, fixedName);
  if (existsSync(fixed)) return fixed;
  try {
    const match = readdirSync(dir).find(f => f.endsWith('-' + fixedName));
    if (match) return join(dir, match);
  } catch { /* fall through */ }
  return fixed;
}
