/**
 * Log file parser — extracts timestamped lines from any common log format.
 *
 * Pipeline: agent drops .log files as artifacts → record stream timestamps them →
 * report auto-discovers and parses → synthesized timeline with citations.
 */

export interface ParsedLogLine {
  ts: string;       // ISO 8601 timestamp
  message: string;  // content after timestamp
  line: number;     // 1-based line number in source file
  level?: string;   // error, warn, info, debug
}

// Ordered by specificity: most specific patterns first prevent partial matches
const TS_EXTRACTORS: Array<{ re: RegExp; toIso: (m: string) => string }> = [
  // ISO 8601: 2026-03-30T10:00:01.200Z or 2026-03-30T10:00:01Z
  { re: /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/, toIso: m => m.endsWith('Z') ? m : m + 'Z' },
  // Python comma-ms: 2026-03-30 10:00:01,200
  { re: /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d+)/, toIso: m => m.replace(' ', 'T').replace(',', '.') + 'Z' },
  // Space-separated with ms: 2026-03-30 10:00:01.200
  { re: /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)/, toIso: m => m.replace(' ', 'T') + 'Z' },
  // Space-separated no ms: 2026-03-30 10:00:01 (lookahead prevents eating partial ms)
  { re: /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?=[^\d.,])/, toIso: m => m.replace(' ', 'T') + 'Z' },
  // Logcat: 03-30 10:00:01.200 (no year — inferred from current year)
  { re: /(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)/, toIso: m => `${new Date().getFullYear()}-${m.replace(' ', 'T')}Z` },
];

const LEVEL_DETECTORS: Array<{ re: RegExp; level: string }> = [
  { re: /\b(?:ERROR|FATAL|CRITICAL)\b/i, level: 'error' },
  { re: /\b(?:WARN(?:ING)?)\b/i, level: 'warn' },
  { re: /\bINFO\b/, level: 'info' },
  { re: /\b(?:DEBUG|TRACE|VERBOSE)\b/i, level: 'debug' },
  // Logcat single-letter levels (space-padded)
  { re: /\s+E\s+/, level: 'error' },
  { re: /\s+W\s+/, level: 'warn' },
  { re: /\s+I\s+/, level: 'info' },
  { re: /\s+D\s+/, level: 'debug' },
];

/** Parse a log file, extracting all lines that have a recognizable timestamp. */
export function parseLogFile(content: string): ParsedLogLine[] {
  const lines = content.split('\n');
  const result: ParsedLogLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) continue;

    let ts: string | null = null;
    let message = trimmed;

    for (const ext of TS_EXTRACTORS) {
      const match = trimmed.match(ext.re);
      if (match) {
        ts = ext.toIso(match[1]);
        // Message = everything after the timestamp, stripped of common separators
        message = trimmed.slice(match.index! + match[0].length).replace(/^[\s\-:|>\]]+/, '').trim();
        break;
      }
    }
    if (!ts) continue;  // skip non-timestamped lines

    let level: string | undefined;
    for (const ld of LEVEL_DETECTORS) {
      if (ld.re.test(trimmed)) { level = ld.level; break; }
    }

    result.push({ ts, message, line: i + 1, level });
  }
  return result;
}

/** Filter parsed lines to a time window (ISO strings). Inclusive on both ends. */
export function filterByTimeWindow(lines: ParsedLogLine[], startIso?: string, endIso?: string): ParsedLogLine[] {
  if (!startIso && !endIso) return lines;
  const startMs = startIso ? new Date(startIso).getTime() : -Infinity;
  const endMs = endIso ? new Date(endIso).getTime() : Infinity;
  return lines.filter(l => {
    const ms = new Date(l.ts).getTime();
    return ms >= startMs && ms <= endMs;
  });
}
