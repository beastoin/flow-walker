import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FlowV2 } from './types.ts';

export interface VerifyOptions {
  flow: FlowV2; runDir: string; mode: 'strict' | 'balanced' | 'audit';
  eventsPath?: string; outputPath?: string;
}

export interface VerifyStepResult {
  id: string; name: string; do: string;
  outcome: 'pass' | 'fail' | 'skipped' | 'recovered';
  events: unknown[]; expectations: unknown[];
}

export interface VerifyResult {
  flow: string; mode: string; result: 'pass' | 'fail';
  steps: VerifyStepResult[]; issues: string[];
}

export function verifyRun(opts: VerifyOptions): VerifyResult {
  const { flow, runDir, mode } = opts;
  const evPath = opts.eventsPath || join(runDir, 'events.jsonl');
  const events: Record<string, unknown>[] = [];
  if (existsSync(evPath)) {
    const lines = readFileSync(evPath, 'utf-8').trim().split('\n').filter(Boolean);
    for (const line of lines) { try { events.push(JSON.parse(line)); } catch { /* skip */ } }
  }
  const stepEvents = new Map<string, Record<string, unknown>[]>();
  for (const ev of events) {
    const sid = ev.step_id as string;
    if (sid) { if (!stepEvents.has(sid)) stepEvents.set(sid, []); stepEvents.get(sid)!.push(ev); }
  }
  const issues: string[] = [];
  const steps: VerifyStepResult[] = [];
  const seenStepIds = new Set<string>();
  let lastSeenIdx = -1;
  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i];
    const evs = stepEvents.get(step.id) || [];
    seenStepIds.add(step.id);
    const endEvent = evs.find(e => e.type === 'step.end');
    let outcome: 'pass' | 'fail' | 'skipped' | 'recovered' = 'fail';
    if (endEvent) {
      const status = endEvent.status as string;
      if (status === 'pass') outcome = 'pass';
      else if (status === 'skipped') outcome = 'skipped';
      else if (status === 'recovered') outcome = 'recovered';
      else outcome = 'fail';
    } else if (evs.length === 0) {
      outcome = mode === 'audit' ? 'skipped' : 'fail';
      if (mode !== 'audit') issues.push(`Step ${step.id}: no events recorded`);
    }
    if (mode === 'strict' && evs.length > 0) {
      const firstEvIdx = events.indexOf(evs[0]);
      if (firstEvIdx < lastSeenIdx) { issues.push(`Step ${step.id}: out of order`); outcome = 'fail'; }
      lastSeenIdx = firstEvIdx;
    }
    const expectations: unknown[] = [];
    if (step.expect) {
      for (const exp of step.expect) {
        if (exp.milestone) {
          const found = evs.find(e => e.type === 'assert' && e.milestone === exp.milestone);
          expectations.push({ ...exp, met: !!found });
          if (!found && mode === 'strict') { issues.push(`Step ${step.id}: milestone "${exp.milestone}" not found`); outcome = 'fail'; }
        } else { expectations.push({ ...exp, met: true }); }
      }
    }
    if (mode === 'strict' && outcome === 'skipped') { issues.push(`Step ${step.id}: skipped (not allowed in strict mode)`); outcome = 'fail'; }
    steps.push({ id: step.id, name: step.name || '', do: step.do, outcome, events: evs, expectations });
  }
  if (mode === 'strict') { for (const sid of stepEvents.keys()) { if (!seenStepIds.has(sid)) issues.push(`Unknown step_id in events: ${sid}`); } }
  let result: 'pass' | 'fail' = 'pass';
  if (mode === 'audit') { result = 'pass'; } else { result = steps.some(s => s.outcome === 'fail') ? 'fail' : 'pass'; }
  const verifyResult: VerifyResult = { flow: flow.name, mode, result, steps, issues };
  const outputPath = opts.outputPath || join(runDir, 'run.json');
  writeFileSync(outputPath, JSON.stringify(verifyResult));
  return verifyResult;
}
