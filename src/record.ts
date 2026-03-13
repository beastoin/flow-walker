import { mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, execSync } from 'node:child_process';
import { validateEvent } from './event-schema.ts';
import { FlowWalkerError, ErrorCodes } from './errors.ts';

export interface RecordInitOptions { flowPath: string; outputDir: string; runId?: string; noVideo?: boolean; device?: string; }
export interface RecordInitResult { id: string; dir: string; video?: boolean; }

export function recordInit(opts: RecordInitOptions): RecordInitResult {
  const id = opts.runId || randomBytes(5).toString('base64url').slice(0, 10);
  const runDir = join(opts.outputDir, id);
  mkdirSync(runDir, { recursive: true });
  const flowContent = readFileSync(opts.flowPath, 'utf-8');
  writeFileSync(join(runDir, 'flow.lock.yaml'), flowContent);
  const meta: Record<string, unknown> = { id, status: 'recording', startedAt: new Date().toISOString() };

  // Start video recording via ADB screenrecord (best-effort)
  let videoStarted = false;
  if (!opts.noVideo) {
    try {
      const adbArgs = opts.device ? ['-s', opts.device] : [];
      const deviceRecordPath = `/sdcard/fw-${id}.mp4`;
      const proc = spawn('adb', [...adbArgs, 'shell', 'screenrecord', '--size', '720x1280', '--bit-rate', '2000000', deviceRecordPath], {
        stdio: 'ignore', detached: true,
      });
      proc.unref();
      if (proc.pid) {
        meta.videoPid = proc.pid;
        meta.videoDevicePath = deviceRecordPath;
        videoStarted = true;
      }
    } catch { /* ADB not available — skip video */ }
  }

  writeFileSync(join(runDir, 'run.meta.json'), JSON.stringify(meta));
  writeFileSync(join(runDir, 'events.jsonl'), '');
  return { id, dir: runDir, video: videoStarted };
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

export function recordFinish(ctx: { runId: string; runDir: string; status: string; device?: string }): void {
  const runDir = findDir(ctx.runDir, ctx.runId);
  const metaPath = join(runDir, 'run.meta.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
  const eventsPath = join(runDir, 'events.jsonl');
  const eventLines = existsSync(eventsPath) ? readFileSync(eventsPath, 'utf-8').trim().split('\n').filter(Boolean) : [];
  meta.status = ctx.status;
  meta.finishedAt = new Date().toISOString();
  meta.eventCount = eventLines.length;

  // Stop video recording and pull file from device
  if (meta.videoDevicePath) {
    const adbArgs = ctx.device ? ['-s', ctx.device] : (meta.device ? ['-s', meta.device as string] : []);
    try {
      // Kill screenrecord on device (sends SIGINT which finalizes the mp4)
      execSync(`adb ${adbArgs.join(' ')} shell pkill -INT screenrecord`, { stdio: 'ignore', timeout: 5000 });
      // Wait for file to finalize
      sleepSync(2000);
      // Pull recording from device
      const localPath = join(runDir, 'recording.mp4');
      execSync(`adb ${adbArgs.join(' ')} pull ${meta.videoDevicePath as string} ${localPath}`, { stdio: 'ignore', timeout: 30000 });
      // Clean up device file
      execSync(`adb ${adbArgs.join(' ')} shell rm -f ${meta.videoDevicePath as string}`, { stdio: 'ignore', timeout: 5000 });
      meta.video = 'recording.mp4';
    } catch { /* best-effort — video pull failed */ }
    delete meta.videoPid;
    delete meta.videoDevicePath;
  }

  writeFileSync(metaPath, JSON.stringify(meta));
}

function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy wait */ }
}

function findDir(runDir: string, runId: string): string {
  const candidate = join(runDir, runId);
  if (existsSync(join(candidate, 'run.meta.json'))) return candidate;
  if (existsSync(join(runDir, 'run.meta.json'))) return runDir;
  throw new FlowWalkerError(ErrorCodes.FILE_NOT_FOUND, `Run directory not found for ${runId}`);
}
