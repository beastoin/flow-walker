import { mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync, unlinkSync, renameSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, execSync } from 'node:child_process';
import { validateEvent } from './event-schema.ts';
import { FlowWalkerError, ErrorCodes } from './errors.ts';
import { loadSnapshot, saveSnapshot } from './snapshot.ts';
import { parseFlowFile } from './flow-parser.ts';
import type { FlowV2 } from './types.ts';
import type { ReplayPlan } from './snapshot.ts';

export type Platform = 'mobile' | 'desktop';
export interface StepRecipe { id: string; name?: string; events: string[]; }
export interface RecordInitOptions { flowPath: string; outputDir: string; runId?: string; noVideo?: boolean; device?: string; platform?: Platform; }
export interface RecordInitResult { id: string; dir: string; video?: boolean; replay?: ReplayPlan; recipe?: StepRecipe[]; evidence?: string[]; }

export function recordInit(opts: RecordInitOptions): RecordInitResult {
  const id = opts.runId || randomBytes(5).toString('base64url').slice(0, 10);
  const runDir = join(opts.outputDir, id);
  mkdirSync(runDir, { recursive: true });
  const flowContent = readFileSync(opts.flowPath, 'utf-8');
  writeFileSync(join(runDir, 'flow.lock.yaml'), flowContent);
  const platform = opts.platform || 'mobile';
  const meta: Record<string, unknown> = { id, status: 'recording', startedAt: new Date().toISOString(), platform };

  // Start video recording (platform-aware)
  let videoStarted = false;
  if (!opts.noVideo) {
    if (platform === 'desktop') {
      // macOS: use ffmpeg avfoundation via Terminal.app (has Screen Recording TCC)
      try {
        const localPath = join(runDir, 'recording.mp4');
        const pidFile = join(runDir, '.ffmpeg-pid');
        const startedFile = join(runDir, '.ffmpeg-started');
        const scriptPath = join(runDir, '.record-screen.sh');
        writeFileSync(scriptPath, `#!/bin/bash\nffmpeg -f avfoundation -framerate 10 -i "2:none" -c:v libx264 -crf 28 -preset fast -pix_fmt yuv420p "${localPath}" </dev/null 2>/dev/null &\necho $! > "${pidFile}"\ntouch "${startedFile}"\nwait\n`, { mode: 0o755 });
        execSync(`osascript -e 'tell application "Terminal" to do script "${scriptPath}"'`, { stdio: 'ignore', timeout: 5000 });
        // Wait for ffmpeg to start (up to 5s)
        for (let i = 0; i < 10; i++) { if (existsSync(startedFile)) break; sleepSync(500); }
        if (existsSync(pidFile)) {
          const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
          if (!isNaN(pid)) {
            meta.videoPid = pid;
            meta.videoLocalPath = localPath;
            videoStarted = true;
          }
        }
      } catch { /* ffmpeg/Terminal not available — skip video */ }
    } else {
      // Mobile: use ADB screenrecord
      try {
        const adbArgs = opts.device ? ['-s', opts.device] : [];
        const deviceRecordPath = `/sdcard/fw-${id}.mp4`;
        const proc = spawn('adb', [...adbArgs, 'shell', 'screenrecord', '--time-limit', '0', '--size', '720x1280', '--bit-rate', '2000000', deviceRecordPath], {
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
  }

  writeFileSync(join(runDir, 'run.meta.json'), JSON.stringify(meta));
  writeFileSync(join(runDir, 'events.jsonl'), '');

  // Auto-load snapshot: if a replay plan exists, include it so agents can use cached coordinates
  let replay: ReplayPlan | undefined;
  try {
    const device = opts.device || process.env.AGENT_FLUTTER_DEVICE || undefined;
    const plan = loadSnapshot({ flowPath: opts.flowPath, device });
    if (plan.valid && plan.mode === 'replay') replay = plan;
  } catch { /* no snapshot or invalid — explore mode */ }

  // Generate step recipes from flow YAML
  let recipe: StepRecipe[] | undefined;
  try {
    const flow = parseFlowFile(opts.flowPath);
    recipe = generateRecipe(flow);
  } catch { /* flow parse failed — no recipe */ }

  // Log capture instructions: tell agents to save raw logs as evidence for machine synthesis
  // Use timestamp-based names from the start — consistent with all run directory files
  const tsNow = compactTs(meta.startedAt as string);
  const evidence = [
    `Save app logs to ${runDir}/${tsNow}-app.log (timestamped lines, machine-parsed into timeline)`,
    `Save backend logs to ${runDir}/${tsNow}-backend.log (timestamped lines, machine-parsed into timeline)`,
    `All files in the run directory use timestamp-based names. flow-walker synthesizes the timeline from *.log files.`,
  ];

  return { id, dir: runDir, video: videoStarted, replay, recipe, evidence };
}

/** Convert ISO timestamp to compact sortable prefix: 2026-03-29T04:12:00.123Z → 20260329T041200123Z */
export function compactTs(iso: string): string {
  return iso.replace(/[-:]/g, '').replace('.', '');
}

/** Rename a file in runDir to include timestamp prefix. Returns new filename or null if file missing. */
function timestampRename(runDir: string, filePath: string, ts: string, stepId: string): string | null {
  const base = basename(filePath);
  const src = join(runDir, base);
  if (!existsSync(src)) return null;
  const newName = `${compactTs(ts)}-${stepId}-${base}`;
  try {
    renameSync(src, join(runDir, newName));
    return newName;
  } catch { return null; }
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
    // Timestamp-rename artifact and screenshot files for chronological synthesis
    const stepId = (parsed.step_id as string) || 'misc';
    if (parsed.type === 'artifact' && typeof parsed.path === 'string') {
      const renamed = timestampRename(runDir, parsed.path, parsed.ts as string, stepId);
      if (renamed) parsed.path = renamed;
    }
    if (typeof parsed.screenshot === 'string') {
      const renamed = timestampRename(runDir, parsed.screenshot, parsed.ts as string, stepId);
      if (renamed) parsed.screenshot = renamed;
    }
    appendFileSync(eventsPath, JSON.stringify(parsed) + '\n');
    count++;
  }
  return count;
}

export interface RecordFinishResult { snapshotSaved?: boolean; snapshotSteps?: number; warnings?: string[]; }

export function recordFinish(ctx: { runId: string; runDir: string; status: string; device?: string; flowPath?: string; flowVerifySteps?: string[] }): RecordFinishResult {
  const runDir = findDir(ctx.runDir, ctx.runId);
  const metaPath = join(runDir, 'run.meta.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
  const eventsPath = join(runDir, 'events.jsonl');
  const eventLines = existsSync(eventsPath) ? readFileSync(eventsPath, 'utf-8').trim().split('\n').filter(Boolean) : [];
  meta.status = ctx.status;
  meta.finishedAt = new Date().toISOString();
  meta.eventCount = eventLines.length;

  // Stop video recording and collect file
  if (meta.videoLocalPath) {
    // Desktop: ffmpeg via Terminal.app — SIGINT finalizes mp4 cleanly
    try {
      if (meta.videoPid) process.kill(meta.videoPid as number, 'SIGINT');
      sleepSync(2000);
      const mp4Path = meta.videoLocalPath as string;
      if (existsSync(mp4Path)) meta.video = 'recording.mp4';
    } catch { /* best-effort */ }
    // Clean up temp files from init
    const runDir2 = findDir(ctx.runDir, ctx.runId);
    for (const f of ['.ffmpeg-pid', '.ffmpeg-started', '.record-screen.sh']) {
      try { if (existsSync(join(runDir2, f))) unlinkSync(join(runDir2, f)); } catch { /* ignore */ }
    }
    delete meta.videoPid;
    delete meta.videoLocalPath;
  } else if (meta.videoDevicePath) {
    // Mobile: ADB screenrecord — pull from device
    const adbArgs = ctx.device ? ['-s', ctx.device] : (meta.device ? ['-s', meta.device as string] : []);
    try {
      // Kill screenrecord on device (sends SIGINT which finalizes the mp4)
      execSync(`adb ${adbArgs.join(' ')} shell pkill -INT screenrecord`, { stdio: 'ignore', timeout: 5000 });
      // Wait for file to finalize
      sleepSync(2000);
      // Pull recording from device
      const rawPath = join(runDir, 'recording-raw.mp4');
      const localPath = join(runDir, 'recording.mp4');
      execSync(`adb ${adbArgs.join(' ')} pull ${meta.videoDevicePath as string} ${rawPath}`, { stdio: 'ignore', timeout: 30000 });
      // Clean up device file
      execSync(`adb ${adbArgs.join(' ')} shell rm -f ${meta.videoDevicePath as string}`, { stdio: 'ignore', timeout: 5000 });
      // Compress with ffmpeg (best-effort — fall back to raw if ffmpeg unavailable)
      try {
        execSync(`ffmpeg -y -i ${rawPath} -c:v libx264 -crf 28 -preset fast -vf scale=720:-2 -an ${localPath}`, { stdio: 'ignore', timeout: 120000 });
        unlinkSync(rawPath);
      } catch {
        // ffmpeg not available or failed — use raw file as-is
        if (existsSync(rawPath)) {
          if (existsSync(localPath)) unlinkSync(localPath);
          renameSync(rawPath, localPath);
        }
      }
      meta.video = 'recording.mp4';
    } catch { /* best-effort — video pull failed */ }
    delete meta.videoPid;
    delete meta.videoDevicePath;
  }

  // Detect event gaps: compare flow expectations vs streamed events
  const warnings: string[] = [];
  try {
    const flowLockPath = join(runDir, 'flow.lock.yaml');
    if (existsSync(flowLockPath)) {
      const flow = parseFlowFile(flowLockPath);
      const events = eventLines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const stepEventsMap = new Map<string, Record<string, unknown>[]>();
      for (const ev of events) {
        const sid = ev.step_id as string;
        if (sid) { if (!stepEventsMap.has(sid)) stepEventsMap.set(sid, []); stepEventsMap.get(sid)!.push(ev); }
      }
      for (const step of flow.steps) {
        const evs = stepEventsMap.get(step.id) || [];
        if (step.expect && step.expect.length > 0) {
          const hasAssert = evs.some(e => e.type === 'assert');
          if (!hasAssert) warnings.push(`Step ${step.id}: missing assert event (flow expects ${step.expect.map(e => e.kind || e.milestone).join(', ')})`);
        }
        if (step.judge && step.judge.length > 0) {
          const hasArtifact = evs.some(e => e.type === 'artifact');
          if (!hasArtifact) warnings.push(`Step ${step.id}: missing artifact/screenshot (flow has judge prompts)`);
        }
      }
    }
  } catch { /* best-effort gap detection */ }
  if (warnings.length > 0) meta.warnings = warnings;

  // Timestamp-rename ALL output files for chronological synthesis
  const tsPrefix = compactTs(meta.startedAt as string);
  // Video
  if (meta.video && meta.startedAt) {
    const newName = `${tsPrefix}-recording.mp4`;
    try { renameSync(join(runDir, meta.video as string), join(runDir, newName)); meta.video = newName; } catch { /* keep original */ }
  }
  // Events log
  const eventsFixed = join(runDir, 'events.jsonl');
  if (existsSync(eventsFixed)) {
    const newName = `${tsPrefix}-events.jsonl`;
    try { renameSync(eventsFixed, join(runDir, newName)); meta.eventsFile = newName; } catch { /* keep original */ }
  }
  // Flow lock
  const flowLockFixed = join(runDir, 'flow.lock.yaml');
  if (existsSync(flowLockFixed)) {
    const newName = `${tsPrefix}-flow.lock.yaml`;
    try { renameSync(flowLockFixed, join(runDir, newName)); meta.flowLockFile = newName; } catch { /* keep original */ }
  }
  // Log files (backend.log, app.log, etc.)
  try {
    const logFiles = readdirSync(runDir).filter(f => /\.log$/i.test(f) && !f.match(/^\d{8}T\d+Z-/));
    for (const logFile of logFiles) {
      const newName = `${tsPrefix}-${logFile}`;
      try { renameSync(join(runDir, logFile), join(runDir, newName)); } catch { /* keep original */ }
    }
  } catch { /* best-effort */ }

  writeFileSync(metaPath, JSON.stringify(meta));

  // Auto-save snapshot on successful run
  const result: RecordFinishResult = { warnings: warnings.length > 0 ? warnings : undefined };
  if (ctx.status === 'pass' && ctx.flowPath) {
    try {
      const snap = saveSnapshot({ flowPath: ctx.flowPath, runDir, device: ctx.device, flowVerifySteps: ctx.flowVerifySteps });
      result.snapshotSaved = true;
      result.snapshotSteps = Object.keys(snap.steps).length;
    } catch { /* best-effort — snapshot save failed */ }
  }
  return result;
}

/** Generate per-step event recipes from flow YAML so agents know exactly what to stream */
export function generateRecipe(flow: FlowV2): StepRecipe[] {
  return flow.steps.map(step => {
    const events: string[] = ['step.start'];
    events.push('action');
    // If step has judge (needs screenshot), include artifact (auto-timestamped by record stream)
    if (step.judge && step.judge.length > 0) {
      events.push('artifact (screenshot — auto-timestamped)');
    } else if (step.evidence && step.evidence.length > 0) {
      events.push('artifact (screenshot — auto-timestamped)');
    }
    // If step has expect, include assert events
    if (step.expect) {
      for (const exp of step.expect) {
        if (exp.milestone && exp.kind) {
          const valuesStr = exp.values ? `: ${exp.values.join(', ')}` : '';
          events.push(`assert (${exp.kind}${valuesStr}, milestone: ${exp.milestone})`);
        } else if (exp.milestone) {
          events.push(`assert (milestone: ${exp.milestone})`);
        } else if (exp.kind) {
          const valuesStr = exp.values ? `: ${exp.values.join(', ')}` : '';
          events.push(`assert (${exp.kind}${valuesStr})`);
        }
      }
    }
    // If step has judge, include agent-review events
    if (step.judge && step.judge.length > 0) {
      step.judge.forEach((j, idx) => {
        events.push(`agent-review (prompt_idx: ${idx}, verdict: pass|fail)`);
      });
    }
    events.push('step.end');
    return { id: step.id, name: step.name, events };
  });
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
