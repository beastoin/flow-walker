import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLogFile, filterByTimeWindow } from '../src/log-parser.ts';

describe('parseLogFile', () => {
  it('parses ISO 8601 timestamps', () => {
    const content = `2026-03-30T10:00:01.200Z INFO Starting server
2026-03-30T10:00:02.500Z POST /v2/sync-local-files 202 Accepted`;
    const lines = parseLogFile(content);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].ts, '2026-03-30T10:00:01.200Z');
    assert.equal(lines[0].message, 'INFO Starting server');
    assert.equal(lines[0].line, 1);
    assert.equal(lines[1].ts, '2026-03-30T10:00:02.500Z');
    assert.ok(lines[1].message.includes('202 Accepted'));
    assert.equal(lines[1].line, 2);
  });

  it('parses ISO timestamps without milliseconds', () => {
    const content = '2026-03-30T10:00:01Z Starting up';
    const lines = parseLogFile(content);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].ts, '2026-03-30T10:00:01Z');
  });

  it('parses Python comma-ms timestamps', () => {
    const content = '2026-03-30 10:00:01,200 - uvicorn - INFO - Started server';
    const lines = parseLogFile(content);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].ts, '2026-03-30T10:00:01.200Z');
    assert.ok(lines[0].message.includes('uvicorn'));
  });

  it('parses space-separated timestamps with dot ms', () => {
    const content = '2026-03-30 10:00:01.200 VAD segment detected';
    const lines = parseLogFile(content);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].ts, '2026-03-30T10:00:01.200Z');
  });

  it('parses logcat format (no year)', () => {
    const content = '03-30 10:00:01.200  1234  5678 I flutter: SyncProvider state changed';
    const lines = parseLogFile(content);
    assert.equal(lines.length, 1);
    assert.ok(lines[0].ts.endsWith('Z'));
    assert.ok(lines[0].ts.includes('T10:00:01.200'));
    assert.ok(lines[0].message.includes('SyncProvider'));
  });

  it('detects ERROR level', () => {
    const content = '2026-03-30T10:00:01Z ERROR Connection refused to database';
    const lines = parseLogFile(content);
    assert.equal(lines[0].level, 'error');
  });

  it('detects WARN level', () => {
    const content = '2026-03-30T10:00:01Z WARNING Slow query detected';
    const lines = parseLogFile(content);
    assert.equal(lines[0].level, 'warn');
  });

  it('detects INFO level', () => {
    const content = '2026-03-30T10:00:01Z INFO Server started on port 8080';
    const lines = parseLogFile(content);
    assert.equal(lines[0].level, 'info');
  });

  it('detects logcat E level', () => {
    const content = '03-30 10:00:01.200  1234  5678 E flutter: Exception caught';
    const lines = parseLogFile(content);
    assert.equal(lines[0].level, 'error');
  });

  it('skips lines without timestamps', () => {
    const content = `2026-03-30T10:00:01Z First line
This line has no timestamp
  still no timestamp
2026-03-30T10:00:02Z Third line`;
    const lines = parseLogFile(content);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].line, 1);
    assert.equal(lines[1].line, 4);
  });

  it('skips empty lines', () => {
    const content = `2026-03-30T10:00:01Z Line one

2026-03-30T10:00:02Z Line two`;
    const lines = parseLogFile(content);
    assert.equal(lines.length, 2);
  });

  it('handles mixed log formats in one file', () => {
    const content = `2026-03-30T10:00:01.200Z ISO format line
2026-03-30 10:00:02,300 - Python format line
03-30 10:00:03.400  1234  5678 I flutter: Logcat format`;
    const lines = parseLogFile(content);
    assert.equal(lines.length, 3);
  });

  it('strips separators after timestamp', () => {
    const content = '2026-03-30T10:00:01Z - | > ] Message here';
    const lines = parseLogFile(content);
    assert.equal(lines[0].message, 'Message here');
  });

  it('preserves correct line numbers', () => {
    const content = `
2026-03-30T10:00:01Z First
no-ts
2026-03-30T10:00:02Z Third
`;
    const lines = parseLogFile(content);
    assert.equal(lines[0].line, 2);
    assert.equal(lines[1].line, 4);
  });
});

describe('filterByTimeWindow', () => {
  const lines = [
    { ts: '2026-03-30T09:59:00Z', message: 'before', line: 1 },
    { ts: '2026-03-30T10:00:01Z', message: 'during1', line: 2 },
    { ts: '2026-03-30T10:00:05Z', message: 'during2', line: 3 },
    { ts: '2026-03-30T11:00:00Z', message: 'after', line: 4 },
  ];

  it('filters to time window', () => {
    const filtered = filterByTimeWindow(lines, '2026-03-30T10:00:00Z', '2026-03-30T10:01:00Z');
    assert.equal(filtered.length, 2);
    assert.equal(filtered[0].message, 'during1');
    assert.equal(filtered[1].message, 'during2');
  });

  it('returns all when no window specified', () => {
    const filtered = filterByTimeWindow(lines);
    assert.equal(filtered.length, 4);
  });

  it('filters with only start', () => {
    const filtered = filterByTimeWindow(lines, '2026-03-30T10:00:00Z');
    assert.equal(filtered.length, 3); // during1, during2, after
  });

  it('filters with only end', () => {
    const filtered = filterByTimeWindow(lines, undefined, '2026-03-30T10:00:02Z');
    assert.equal(filtered.length, 2); // before, during1
  });
});
