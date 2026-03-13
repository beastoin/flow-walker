import { mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { validateEvent } from './event-schema.ts';
import { FlowWalkerError, ErrorCodes } from './errors.ts';

export interface RecordInitOptions { flowPath: string; outputDir: string; runId?: string; }
export interface RecordInitResult { id: string; dir: string; }

export function recordInit(opts: RecordInitOptions): RecordInitResult {
  const id = opts.runId || randomBytes(5).toString('base64url').slice(0, 10);
  const runDir = join(opts.outputDir, id);
  mkdirSync(runDir, { recursive: true });
  const flowContent = readFileSync(opts.flowPath, 'utf-8');
  writeFileSync(join(runDir, 'flow.lock.yaml'), flowContent);
  writeFileSync(join(runDir, 'run.meta.json'), JSON.stringify({ id, status: 'recording', startedAt: new Date().toISOString() }));
  writeFileSync(join(runDir, 'events.jsonl'), '');
  return { id, dir: runDir };
}

export function recordStream(ctx: { runId: string; runDir: string }, lines: string[]): number {
  const runDir = findDir(ctx.runDir, ctx.runId);
  const eventsPath = join(runDir, 'events.jsonl');
  const existing = existsSync(eventsPath) ? readFileSync(eventsPath, 'utf-8').trim() : '';
  let seq = existing ? existing.split('\n').filter(Boolean).length : 0;
  let count = 0;
  for (const line of lines) {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(line); } catch { continue; }
    const result = validateEvent(parsed);
    if (!result.valid) continue;
    parsed.seq = seq++;
    parsed.ts = parsed.ts || new Date().toISOString();
    appendFileSync(eventsPath, JSON.stringify(parsed) + '\n');
    count++;
  }
  return count;
}

export function recordFinish(ctx: { runId: string; runDir: string; status: string }): void {
  const runDir = findDir(ctx.runDir, ctx.runId);
  const metaPath = join(runDir, 'run.meta.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
  const eventsPath = join(runDir, 'events.jsonl');
  const eventLines = existsSync(eventsPath) ? readFileSync(eventsPath, 'utf-8').trim().split('\n').filter(Boolean) : [];
  meta.status = ctx.status;
  meta.finishedAt = new Date().toISOString();
  meta.eventCount = eventLines.length;
  writeFileSync(metaPath, JSON.stringify(meta));
}

function findDir(runDir: string, runId: string): string {
  const candidate = join(runDir, runId);
  if (existsSync(join(candidate, 'run.meta.json'))) return candidate;
  if (existsSync(join(runDir, 'run.meta.json'))) return runDir;
  throw new FlowWalkerError(ErrorCodes.FILE_NOT_FOUND, `Run directory not found for ${runId}`);
}
