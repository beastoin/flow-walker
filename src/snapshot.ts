/**
 * Flow snapshot — capture replay data from a successful run for fast re-execution.
 * After a successful run, `snapshot save` extracts coordinates, timing, and commands.
 * Before a run, `snapshot load` returns a replay plan so agents skip UI exploration.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';

// ── Types ──

export interface StepSnapshot {
  kind: 'action' | 'verify';
  command?: string;       // agent-flutter command: press, fill, scroll, back
  ref?: string;           // element ref used (e.g., "e5")
  text?: string;          // element text for fallback matching
  type?: string;          // element type (button, gesture, etc.)
  bounds?: { x: number; y: number; width: number; height: number };
  center?: { x: number; y: number }; // tap target (center of bounds)
  fillValue?: string;
  scrollText?: string;    // for scroll --text
  scrollDirection?: string;
  waitAfterMs: number;    // optimal wait after this step
  durationMs: number;     // how long this step took
}

export interface FlowSnapshot {
  version: 1;
  flow: string;
  flowHash: string;       // sha256 of YAML content — invalidates on change
  device: { model: string; resolution: string };
  createdAt: string;
  runId: string;
  totalDurationMs: number;
  verifySteps: string[];  // step IDs to verify on replay (first + last + verify-only)
  steps: Record<string, StepSnapshot>;
}

export interface ReplayPlan {
  mode: 'replay' | 'explore';
  valid: boolean;
  reason?: string;
  verifySteps?: string[];
  steps?: Record<string, StepSnapshot>;
  totalDurationMs?: number;
}

// ── Helpers ──

export function computeFlowHash(yamlContent: string): string {
  return createHash('sha256').update(yamlContent).digest('hex').slice(0, 16);
}

export function deriveSnapshotPath(flowPath: string): string {
  const dir = dirname(flowPath);
  const name = basename(flowPath).replace(/\.(yaml|yml)$/, '');
  return join(dir, `${name}.snapshot.json`);
}

// ── Save ──

export interface SaveSnapshotOptions {
  flowPath: string;
  runDir: string;
  device?: string;
  resolution?: string;
  /** Step IDs marked verify: true in the flow YAML — always included in verifySteps */
  flowVerifySteps?: string[];
}

export function saveSnapshot(opts: SaveSnapshotOptions): FlowSnapshot {
  const yamlContent = readFileSync(opts.flowPath, 'utf-8');
  const flowHash = computeFlowHash(yamlContent);

  // Parse flow name from YAML
  const nameMatch = yamlContent.match(/^name:\s*(.+)$/m);
  const flowName = nameMatch ? nameMatch[1].trim().replace(/^["']|["']$/g, '') : 'unknown';

  // Read events
  const eventsPath = join(opts.runDir, 'events.jsonl');
  const events: Record<string, unknown>[] = [];
  if (existsSync(eventsPath)) {
    const lines = readFileSync(eventsPath, 'utf-8').trim().split('\n').filter(Boolean);
    for (const line of lines) { try { events.push(JSON.parse(line)); } catch { /* skip */ } }
  }

  // Read run meta for runId
  const metaPath = join(opts.runDir, 'run.meta.json');
  let runId = 'unknown';
  if (existsSync(metaPath)) {
    try { runId = JSON.parse(readFileSync(metaPath, 'utf-8')).id || 'unknown'; } catch { /* skip */ }
  }

  // Group events by step_id
  const stepEvents = new Map<string, Record<string, unknown>[]>();
  const stepOrder: string[] = [];
  for (const ev of events) {
    const sid = ev.step_id as string;
    if (!sid) continue;
    if (!stepEvents.has(sid)) { stepEvents.set(sid, []); stepOrder.push(sid); }
    stepEvents.get(sid)!.push(ev);
  }

  // Build step snapshots
  const steps: Record<string, StepSnapshot> = {};
  for (let i = 0; i < stepOrder.length; i++) {
    const sid = stepOrder[i];
    const evs = stepEvents.get(sid)!;

    // Find action event
    const actionEv = evs.find(e => e.type === 'action');
    const stepStart = evs.find(e => e.type === 'step.start');
    const stepEnd = evs.find(e => e.type === 'step.end');

    // Calculate duration
    let durationMs = 0;
    if (stepStart?.ts && stepEnd?.ts) {
      durationMs = new Date(stepEnd.ts as string).getTime() - new Date(stepStart.ts as string).getTime();
    }

    // Calculate wait after (time between this step.end and next step.start)
    let waitAfterMs = 500; // default
    if (i < stepOrder.length - 1) {
      const nextEvs = stepEvents.get(stepOrder[i + 1])!;
      const nextStart = nextEvs.find(e => e.type === 'step.start');
      if (stepEnd?.ts && nextStart?.ts) {
        waitAfterMs = Math.max(200, new Date(nextStart.ts as string).getTime() - new Date(stepEnd.ts as string).getTime());
      }
    }

    const step: StepSnapshot = {
      kind: actionEv ? 'action' : 'verify',
      waitAfterMs: Math.round(waitAfterMs),
      durationMs: Math.round(durationMs),
    };

    if (actionEv) {
      if (actionEv.command) step.command = actionEv.command as string;
      if (actionEv.element_ref) step.ref = actionEv.element_ref as string;
      if (actionEv.element_text) step.text = actionEv.element_text as string;
      if (actionEv.element_type) step.type = actionEv.element_type as string;
      if (actionEv.fill_value) step.fillValue = actionEv.fill_value as string;
      if (actionEv.scroll_text) step.scrollText = actionEv.scroll_text as string;
      if (actionEv.scroll_direction) step.scrollDirection = actionEv.scroll_direction as string;

      const bounds = actionEv.element_bounds as { x: number; y: number; width: number; height: number } | undefined;
      if (bounds && typeof bounds.x === 'number') {
        step.bounds = bounds;
        step.center = {
          x: Math.round(bounds.x + bounds.width / 2),
          y: Math.round(bounds.y + bounds.height / 2),
        };
      }
    }

    steps[sid] = step;
  }

  // Determine verify steps: flow-defined verify: true + first + last + verify-only events
  const verifySet = new Set<string>();
  // Always include flow-defined verify steps (from YAML verify: true)
  if (opts.flowVerifySteps) {
    for (const sid of opts.flowVerifySteps) {
      if (stepOrder.includes(sid)) verifySet.add(sid);
    }
  }
  // Default: first + last + verify-only steps (when no flow-defined verify steps exist)
  if (stepOrder.length > 0) {
    if (verifySet.size === 0) verifySet.add(stepOrder[0]); // first as default
    for (let i = 1; i < stepOrder.length - 1; i++) {
      if (steps[stepOrder[i]].kind === 'verify') verifySet.add(stepOrder[i]);
    }
    if (verifySet.size === 0 || !opts.flowVerifySteps?.length) {
      if (stepOrder.length > 1) verifySet.add(stepOrder[stepOrder.length - 1]); // last as default
    }
  }
  // Preserve step order
  const verifySteps = stepOrder.filter(sid => verifySet.has(sid));

  // Calculate total duration
  const timestamps = events
    .map(e => e.ts as string).filter(Boolean)
    .map(t => new Date(t).getTime()).filter(t => !isNaN(t));
  const totalDurationMs = timestamps.length >= 2 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;

  const snapshot: FlowSnapshot = {
    version: 1,
    flow: flowName,
    flowHash,
    device: {
      model: opts.device || 'unknown',
      resolution: opts.resolution || 'unknown',
    },
    createdAt: new Date().toISOString(),
    runId,
    totalDurationMs: Math.round(totalDurationMs),
    verifySteps,
    steps,
  };

  const snapshotPath = deriveSnapshotPath(opts.flowPath);
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  return snapshot;
}

// ── Load ──

export interface LoadSnapshotOptions {
  flowPath: string;
  device?: string;
}

export function loadSnapshot(opts: LoadSnapshotOptions): ReplayPlan {
  const snapshotPath = deriveSnapshotPath(opts.flowPath);

  if (!existsSync(snapshotPath)) {
    return { mode: 'explore', valid: false, reason: 'no snapshot file' };
  }

  let snapshot: FlowSnapshot;
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
  } catch {
    return { mode: 'explore', valid: false, reason: 'snapshot parse error' };
  }

  // Validate flow hash
  const yamlContent = readFileSync(opts.flowPath, 'utf-8');
  const currentHash = computeFlowHash(yamlContent);
  if (snapshot.flowHash !== currentHash) {
    return { mode: 'explore', valid: false, reason: 'flow changed since snapshot' };
  }

  // Validate device if specified
  if (opts.device && snapshot.device.model !== 'unknown' && snapshot.device.model !== opts.device) {
    return { mode: 'explore', valid: false, reason: `device mismatch: snapshot=${snapshot.device.model}, current=${opts.device}` };
  }

  return {
    mode: 'replay',
    valid: true,
    verifySteps: snapshot.verifySteps,
    steps: snapshot.steps,
    totalDurationMs: snapshot.totalDurationMs,
  };
}
