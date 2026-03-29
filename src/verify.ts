import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FlowV2 } from './types.ts';

export interface VerifyOptions {
  flow: FlowV2; runDir: string; mode: 'strict' | 'balanced' | 'audit';
  eventsPath?: string; outputPath?: string;
  recheck?: boolean; agentPrompt?: boolean;
}

/** Tier 1: Automated check result with expected vs actual */
export interface AutomatedCheck {
  kind: string;
  status: 'pass' | 'fail' | 'no_evidence';
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  milestone?: string;
}

/** Tier 2: Agent verification prompt */
export interface AgentPrompt {
  id?: string;
  prompt: string;
  status: 'pending' | 'pass' | 'fail';
  screenshot?: string;
  look_for?: string[];
  fail_if?: string[];
}

export interface VerifyStepResult {
  id: string; name: string; do: string; claim: string;
  outcome: 'pass' | 'fail' | 'skipped' | 'recovered';
  automated: { result: 'pass' | 'fail' | 'no_evidence'; checks: AutomatedCheck[] };
  agent: { result: 'pending' | 'pass' | 'fail'; prompts: AgentPrompt[] };
  events: unknown[];
  // Legacy compat: kept for backward-compatible report rendering
  expectations: unknown[];
}

export interface VerifyResult {
  schema: string;
  flow: string; mode: string; result: 'pass' | 'fail' | 'unverified';
  automatedResult: 'pass' | 'fail' | 'no_evidence';
  agentResult: 'pending' | 'pass' | 'fail';
  steps: VerifyStepResult[]; issues: string[];
}

/** Normalize common outcome variants to valid StepOutcome values */
function normalizeOutcome(raw: string): 'pass' | 'fail' | 'skipped' | 'recovered' {
  if (raw === 'pass') return 'pass';
  if (raw === 'skipped' || raw === 'skip') return 'skipped';
  if (raw === 'recovered') return 'recovered';
  return 'fail';
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
      const rawStatus = String(endEvent.outcome ?? endEvent.status ?? 'fail');
      outcome = normalizeOutcome(rawStatus);
      if (rawStatus !== outcome && rawStatus !== 'skip') {
        issues.push(`Step ${step.id}: outcome "${rawStatus}" normalized to "${outcome}"`);
      }
    } else if (evs.length === 0) {
      outcome = mode === 'audit' ? 'skipped' : 'fail';
      if (mode !== 'audit') issues.push(`Step ${step.id}: no events recorded`);
    }
    if (mode === 'strict' && evs.length > 0) {
      const firstEvIdx = events.indexOf(evs[0]);
      if (firstEvIdx < lastSeenIdx) { issues.push(`Step ${step.id}: out of order`); outcome = 'fail'; }
      lastSeenIdx = firstEvIdx;
    }

    // ── Tier 1: Automated checks from expect ──
    const automatedChecks: AutomatedCheck[] = [];
    const legacyExpectations: unknown[] = [];
    if (step.expect) {
      for (const exp of step.expect) {
        if (exp.milestone) {
          const found = evs.find(e => e.type === 'assert' && e.milestone === exp.milestone);
          const check: AutomatedCheck = {
            kind: exp.kind || 'milestone',
            milestone: exp.milestone,
            expected: { milestone: exp.milestone },
            actual: found ? { found: true, event: { milestone: found.milestone, passed: found.passed } } : { found: false },
            status: found ? 'pass' : 'no_evidence',
          };
          automatedChecks.push(check);
          legacyExpectations.push({ ...exp, met: !!found });
          if (!found && mode === 'strict') { issues.push(`Step ${step.id}: milestone "${exp.milestone}" not found`); outcome = 'fail'; }
        } else if (exp.kind) {
          const assertEv = evs.find(e => e.type === 'assert' && e.kind === exp.kind) as Record<string, unknown> | undefined;
          const expected: Record<string, unknown> = { kind: exp.kind };
          if (exp.min !== undefined) expected.min = exp.min;
          if (exp.values) expected.values = exp.values;
          let status: AutomatedCheck['status'] = 'no_evidence';
          const actual: Record<string, unknown> = {};
          if (assertEv) {
            if (assertEv.passed === false) {
              status = 'fail';
              actual.passed = false;
              if (assertEv.actual !== undefined) actual.value = assertEv.actual;
              if (assertEv.count !== undefined) actual.count = assertEv.count;
              if (assertEv.found !== undefined) actual.found = assertEv.found;
            } else {
              status = 'pass';
              actual.passed = true;
              if (assertEv.actual !== undefined) actual.value = assertEv.actual;
              if (assertEv.count !== undefined) actual.count = assertEv.count;
              if (assertEv.found !== undefined) actual.found = assertEv.found;
            }
          }
          automatedChecks.push({ kind: exp.kind, expected, actual, status });
          legacyExpectations.push({ ...exp, met: status === 'pass' });
          if (assertEv && assertEv.passed === false && mode === 'strict') {
            issues.push(`Step ${step.id}: expectation ${exp.kind} failed`);
            outcome = 'fail';
          }
        } else {
          automatedChecks.push({ kind: 'unknown', expected: { ...exp }, actual: {}, status: 'no_evidence' });
          legacyExpectations.push({ ...exp, met: true });
        }
      }
    }
    const autoResult: AutomatedCheck['status'] = automatedChecks.length === 0 ? 'pass'
      : automatedChecks.some(c => c.status === 'fail') ? 'fail'
      : automatedChecks.some(c => c.status === 'no_evidence') ? 'no_evidence'
      : 'pass';

    // ── Tier 2: Agent checks from judge ──
    const agentPrompts: AgentPrompt[] = [];
    if (step.judge) {
      for (const j of step.judge) {
        agentPrompts.push({
          id: j.id,
          prompt: j.prompt,
          status: 'pending',
          screenshot: j.screenshot,
          look_for: j.look_for,
          fail_if: j.fail_if,
        });
      }
    }
    // Process agent-review events: resolve pending prompts
    const reviewEvents = evs.filter(e => e.type === 'agent-review');
    for (const rev of reviewEvents) {
      const idx = typeof rev.prompt_idx === 'number' ? rev.prompt_idx : -1;
      const verdict = String(rev.verdict || '');
      if (idx >= 0 && idx < agentPrompts.length && (verdict === 'pass' || verdict === 'fail')) {
        agentPrompts[idx].status = verdict;
      }
    }
    const agentResult: AgentPrompt['status'] = agentPrompts.length === 0 ? 'pass'
      : agentPrompts.some(p => p.status === 'fail') ? 'fail'
      : agentPrompts.some(p => p.status === 'pending') ? 'pending'
      : 'pass';

    if (mode === 'strict' && outcome === 'skipped') { issues.push(`Step ${step.id}: skipped (not allowed in strict mode)`); outcome = 'fail'; }
    if (outcome === 'fail') {
      const summary = endEvent ? (endEvent.summary as string || '') : '';
      issues.push(`Step ${step.id}: ${outcome}${summary ? ` — ${summary}` : ''}`);
    }

    const claim = step.claim || step.name || step.do;
    steps.push({
      id: step.id, name: step.name || '', do: step.do, claim,
      outcome, events: evs, expectations: legacyExpectations,
      automated: { result: autoResult, checks: automatedChecks },
      agent: { result: agentResult, prompts: agentPrompts },
    });
  }
  if (mode === 'strict') { for (const sid of stepEvents.keys()) { if (!seenStepIds.has(sid)) issues.push(`Unknown step_id in events: ${sid}`); } }
  const hasFailedStep = steps.some(s => s.outcome === 'fail');
  const automatedResult = steps.some(s => s.automated.result === 'fail') ? 'fail' as const
    : steps.some(s => s.automated.result === 'no_evidence') ? 'no_evidence' as const : 'pass' as const;
  const overallAgent = steps.some(s => s.agent.result === 'pending' && s.agent.prompts.length > 0) ? 'pending' as const : 'pass' as const;
  // Determine overall result: 'fail' if any step failed, 'unverified' if no real checks ran, 'pass' if verified
  const hasChecks = steps.some(s => (s.automated.checks.length > 0) || (s.agent.prompts.length > 0));
  const allAutoNoEvidence = !steps.some(s => s.automated.result === 'pass' || s.automated.result === 'fail');
  const allAgentPending = !steps.some(s => s.agent.result === 'pass' || s.agent.result === 'fail');
  let result: 'pass' | 'fail' | 'unverified';
  if (hasFailedStep) { result = 'fail'; }
  else if (hasChecks && allAutoNoEvidence && allAgentPending) { result = 'unverified'; }
  else { result = 'pass'; }
  const verifyResult: VerifyResult = { schema: 'flow-walker.run.v3', flow: flow.name, mode, result, automatedResult, agentResult: overallAgent, steps, issues };
  const outputPath = opts.outputPath || join(runDir, 'run.json');
  writeFileSync(outputPath, JSON.stringify(verifyResult));
  return verifyResult;
}

/** Re-check tier 1 automated checks from stored run data (no device needed) */
export function recheckRun(opts: { flow: FlowV2; runDir: string }): VerifyResult {
  const runJsonPath = join(opts.runDir, 'run.json');
  if (!existsSync(runJsonPath)) {
    return verifyRun({ flow: opts.flow, runDir: opts.runDir, mode: 'audit', recheck: true });
  }
  const existing = JSON.parse(readFileSync(runJsonPath, 'utf-8')) as VerifyResult;
  // Re-evaluate: mark any no_evidence as still no_evidence, keep pass/fail from recorded data
  for (const step of existing.steps) {
    if (step.automated) {
      for (const check of step.automated.checks) {
        if (check.status === 'no_evidence') {
          check.status = 'no_evidence'; // Confirm: still no evidence
        }
      }
      step.automated.result = step.automated.checks.length === 0 ? 'pass'
        : step.automated.checks.some(c => c.status === 'fail') ? 'fail'
        : step.automated.checks.some(c => c.status === 'no_evidence') ? 'no_evidence'
        : 'pass';
    }
  }
  existing.automatedResult = existing.steps.some(s => s.automated?.result === 'fail') ? 'fail'
    : existing.steps.some(s => s.automated?.result === 'no_evidence') ? 'no_evidence' : 'pass';
  return existing;
}

/** Generate structured agent verification prompts for tier 2 checks */
export function generateAgentPrompts(opts: { flow: FlowV2; runDir: string }): Record<string, unknown>[] {
  const runJsonPath = join(opts.runDir, 'run.json');
  const result: Record<string, unknown>[] = [];
  let steps: VerifyStepResult[] = [];
  if (existsSync(runJsonPath)) {
    const data = JSON.parse(readFileSync(runJsonPath, 'utf-8')) as VerifyResult;
    steps = data.steps;
  }
  for (const flowStep of opts.flow.steps) {
    if (!flowStep.judge || flowStep.judge.length === 0) continue;
    const runStep = steps.find(s => s.id === flowStep.id);
    for (const j of flowStep.judge) {
      result.push({
        task: 'Review this agent-tier check. Examine the screenshot and answer the question.',
        flow: { name: opts.flow.name },
        step: {
          id: flowStep.id,
          name: flowStep.name || '',
          claim: flowStep.claim || flowStep.name || flowStep.do,
          actionTaken: flowStep.do,
        },
        screenshots: j.screenshot ? [{ label: j.screenshot, path: `${j.screenshot}.webp` }] : [],
        check: {
          id: j.id || flowStep.id,
          question: j.prompt,
          lookFor: j.look_for || [],
          failIf: j.fail_if || [],
          answerFormat: { verdict: 'pass|fail|uncertain', confidence: 'low|medium|high', reason: 'string', observed: 'string[]' },
        },
        context: runStep ? { outcome: runStep.outcome, automatedResult: runStep.automated?.result } : undefined,
      });
    }
  }
  return result;
}
