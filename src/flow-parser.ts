import { readFileSync } from 'node:fs';
import type { Flow, FlowStep, FlowV2, FlowV2Step, FlowV2Expect, FlowV2Evidence } from './types.ts';
import { FlowWalkerError, ErrorCodes } from './errors.ts';
import { validateFlowV2 } from './flow-v2-schema.ts';
const LEGACY_STEP_KEYS = new Set(['press', 'fill', 'scroll', 'back', 'adb', 'assert', 'wait']);
export function parseFlowV1(yamlContent: string): Flow {
  const lines = yamlContent.split('\n');
  const flow: Record<string, unknown> = { steps: [] };
  let currentStep: Record<string, unknown> = {};
  let inSteps = false, inCovers = false, inPrerequisites = false, inAssert = false, inPress = false, inFill = false;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith('#') || line.trim() === '') continue;
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      inCovers = false; inPrerequisites = false; inAssert = false; inPress = false; inFill = false;
      if (line.startsWith('name:')) flow.name = pv(line.slice(5));
      else if (line.startsWith('description:')) flow.description = pv(line.slice(12));
      else if (line.startsWith('setup:')) flow.setup = pv(line.slice(6));
      else if (line.startsWith('app:')) flow.app = pv(line.slice(4));
      else if (line.startsWith('appUrl:') || line.startsWith('app_url:')) flow.appUrl = pv(line.slice(line.indexOf(':') + 1));
      else if (line.startsWith('covers:')) { inCovers = true; flow.covers = []; }
      else if (line.startsWith('prerequisites:')) { inPrerequisites = true; flow.prerequisites = []; }
      else if (line.startsWith('steps:')) inSteps = true;
      continue;
    }
    const t = line.trim();
    if (inCovers && t.startsWith('- ')) { (flow.covers as string[]).push(pv(t.slice(2))); continue; }
    if (inPrerequisites && t.startsWith('- ')) { (flow.prerequisites as string[]).push(pv(t.slice(2))); continue; }
    if (!inSteps) continue;
    if (t.startsWith('- name:')) {
      if (currentStep.name) (flow.steps as Record<string, unknown>[]).push(currentStep);
      currentStep = { name: pv(t.slice(7)) }; inAssert = false; inPress = false; inFill = false; continue;
    }
    if (!currentStep.name) continue;
    if (t.startsWith('screenshot:')) currentStep.screenshot = pv(t.slice(11));
    else if (t.startsWith('note:')) currentStep.note = pv(t.slice(5));
    else if (t.startsWith('scroll:')) currentStep.scroll = pv(t.slice(7));
    else if (t.startsWith('back:')) currentStep.back = pv(t.slice(5)) === 'true';
    else if (t.startsWith('wait:')) currentStep.wait = parseInt(pv(t.slice(5)), 10);
    else if (t.startsWith('adb:')) currentStep.adb = pv(t.slice(4));
    else if (t.startsWith('press:')) {
      const inline = t.slice(6).trim();
      if (inline.startsWith('{')) currentStep.press = parseInlineObj(inline);
      else { inPress = true; inFill = false; inAssert = false; currentStep.press = {}; }
    } else if (inPress) {
      const pr = currentStep.press as Record<string, unknown>;
      if (t.startsWith('type:')) pr.type = pv(t.slice(5));
      else if (t.startsWith('text:')) pr.text = pv(t.slice(5));
      else if (t.startsWith('hint:')) pr.hint = pv(t.slice(5));
      else if (t.startsWith('position:')) pr.position = pv(t.slice(9));
      else if (t.startsWith('ref:')) pr.ref = pv(t.slice(4));
      else if (t.startsWith('bottom_nav_tab:')) pr.bottom_nav_tab = parseInt(pv(t.slice(15)), 10);
      else inPress = false;
    } else if (t.startsWith('fill:')) {
      const inline = t.slice(5).trim();
      if (inline.startsWith('{')) currentStep.fill = parseInlineObj(inline);
      else { inFill = true; inPress = false; inAssert = false; currentStep.fill = {}; }
    } else if (inFill) {
      const fi = currentStep.fill as Record<string, unknown>;
      if (t.startsWith('type:')) fi.type = pv(t.slice(5));
      else if (t.startsWith('value:')) fi.value = pv(t.slice(6));
      else if (t.startsWith('text:')) fi.text = pv(t.slice(5));
      else if (t.startsWith('focused:')) fi.focused = pv(t.slice(8)) === 'true';
      else inFill = false;
    } else if (t.startsWith('assert:')) { inAssert = true; inPress = false; inFill = false; currentStep.assert = {}; }
    else if (inAssert) {
      const a = currentStep.assert as Record<string, unknown>;
      if (t.startsWith('interactive_count:')) { const inline = t.slice(18).trim(); a.interactive_count = inline.startsWith('{') ? parseInlineObj(inline) : {}; }
      else if (t.startsWith('min:') && a.interactive_count) (a.interactive_count as Record<string, unknown>).min = parseInt(pv(t.slice(4)), 10);
      else if (t.startsWith('bottom_nav_tabs:')) { const inline = t.slice(16).trim(); a.bottom_nav_tabs = inline.startsWith('{') ? parseInlineObj(inline) : {}; }
      else if (t.startsWith('text_visible:')) a.text_visible = parseInlineArr(t.slice(13).trim());
      else if (t.startsWith('text_not_visible:')) a.text_not_visible = parseInlineArr(t.slice(17).trim());
      else if (t.startsWith('text:')) a.text = pv(t.slice(5));
      else if (t.startsWith('has_type:')) { const inline = t.slice(9).trim(); if (inline.startsWith('{')) a.has_type = parseInlineObj(inline); }
    }
  }
  if (currentStep.name) (flow.steps as Record<string, unknown>[]).push(currentStep);
  if (!flow.name) throw new FlowWalkerError(ErrorCodes.FLOW_PARSE_ERROR, 'Flow missing required field: name');
  if (!flow.steps || (flow.steps as unknown[]).length === 0) throw new FlowWalkerError(ErrorCodes.FLOW_PARSE_ERROR, 'Flow has no steps');
  return flow as unknown as Flow;
}
export function parseFlowV2(yamlContent: string): FlowV2 {
  const lines = yamlContent.split('\n');
  const flow: Partial<FlowV2> = { steps: [] };
  let currentStep: Partial<FlowV2Step> & Record<string, unknown> = {};
  let inSteps = false, inCovers = false, inPreconditions = false, inExpect = false, inEvidence = false, inAnchors = false, inDefaults = false, inFlowEvidence = false;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith('#') || line.trim() === '') continue;
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      inCovers = false; inPreconditions = false; inExpect = false; inEvidence = false; inAnchors = false; inDefaults = false; inFlowEvidence = false;
      if (line.startsWith('version:')) flow.version = parseInt(pv(line.slice(8)), 10) as 2;
      else if (line.startsWith('name:')) flow.name = pv(line.slice(5));
      else if (line.startsWith('description:')) flow.description = pv(line.slice(12));
      else if (line.startsWith('app:')) flow.app = pv(line.slice(4));
      else if (line.startsWith('app_url:') || line.startsWith('appUrl:')) flow.appUrl = pv(line.slice(line.indexOf(':') + 1));
      else if (line.startsWith('covers:')) { inCovers = true; flow.covers = []; }
      else if (line.startsWith('preconditions:')) { inPreconditions = true; flow.preconditions = []; }
      else if (line.startsWith('defaults:')) { inDefaults = true; flow.defaults = {}; }
      else if (line.startsWith('evidence:')) { inFlowEvidence = true; flow.evidence = {}; }
      else if (line.startsWith('steps:')) inSteps = true;
      continue;
    }
    const t = line.trim();
    if (inDefaults && !inSteps) {
      if (t.startsWith('timeout_ms:')) flow.defaults!.timeout_ms = parseInt(pv(t.slice(11)), 10);
      else if (t.startsWith('retries:')) flow.defaults!.retries = parseInt(pv(t.slice(8)), 10);
      else if (t.startsWith('vision:')) flow.defaults!.vision = pv(t.slice(7));
      continue;
    }
    if (inFlowEvidence && !inSteps) {
      if (t.startsWith('video:')) flow.evidence!.video = pv(t.slice(6)) === 'true';
      continue;
    }
    if (inCovers && t.startsWith('- ')) { flow.covers!.push(pv(t.slice(2))); continue; }
    if (inPreconditions && t.startsWith('- ')) { flow.preconditions!.push(pv(t.slice(2))); continue; }
    if (!inSteps) continue;
    if (t.startsWith('- id:')) {
      if (currentStep.id) flow.steps!.push(currentStep as unknown as FlowV2Step);
      currentStep = { id: pv(t.slice(5)) }; inExpect = false; inEvidence = false; inAnchors = false; continue;
    }
    if (!currentStep.id) continue;
    if (t.startsWith('name:')) currentStep.name = pv(t.slice(5));
    else if (t.startsWith('do:')) currentStep.do = pv(t.slice(3));
    else if (t.startsWith('anchors:')) {
      const v = t.slice(8).trim();
      if (v.startsWith('[')) { currentStep.anchors = parseInlineArr(v); inAnchors = false; }
      else { inAnchors = true; currentStep.anchors = []; }
    } else if (inAnchors && t.startsWith('- ')) {
      if (!currentStep.anchors) currentStep.anchors = [];
      (currentStep.anchors as string[]).push(pv(t.slice(2)));
    } else if (t.startsWith('expect:')) { inExpect = true; inEvidence = false; inAnchors = false; currentStep.expect = []; }
    else if (inExpect && t.startsWith('- ')) {
      const ei: Partial<FlowV2Expect> = {};
      const rest = t.slice(2).trim();
      if (rest.startsWith('milestone:')) ei.milestone = pv(rest.slice(10));
      else if (rest.startsWith('kind:')) ei.kind = pv(rest.slice(5));
      (currentStep.expect as FlowV2Expect[]).push(ei as FlowV2Expect);
    } else if (t.startsWith('evidence:')) { inEvidence = true; inExpect = false; inAnchors = false; currentStep.evidence = []; }
    else if (inExpect && !t.startsWith('- ')) {
      const last = (currentStep.expect as FlowV2Expect[])?.at(-1);
      if (last) {
        const r = last as Record<string, unknown>;
        if (t.startsWith('milestone:')) r.milestone = pv(t.slice(10));
        if (t.startsWith('kind:')) r.kind = pv(t.slice(5));
        if (t.startsWith('outcome:')) r.outcome = pv(t.slice(8));
        if (t.startsWith('min:')) r.min = parseInt(pv(t.slice(4)), 10);
        if (t.startsWith('values:')) r.values = parseInlineArr(t.slice(7).trim());
      }
    }
    else if (inEvidence && t.startsWith('- ')) {
      const rest = t.slice(2).trim();
      const ei: Partial<FlowV2Evidence> = {};
      if (rest.startsWith('screenshot:')) ei.screenshot = pv(rest.slice(11));
      (currentStep.evidence as FlowV2Evidence[]).push(ei as FlowV2Evidence);
    } else if (t.startsWith('verify:')) currentStep.verify = pv(t.slice(7)) === 'true';
    else if (t.startsWith('note:')) currentStep.note = pv(t.slice(5));
    else { for (const key of LEGACY_STEP_KEYS) { if (t.startsWith(`${key}:`)) currentStep[key] = t.slice(key.length + 1).trim(); } }
  }
  if (currentStep.id) flow.steps!.push(currentStep as unknown as FlowV2Step);
  if (!flow.version) flow.version = 2;
  if (!flow.name) throw new FlowWalkerError(ErrorCodes.FLOW_PARSE_ERROR, 'Flow missing required field: name');
  if (!flow.steps || flow.steps.length === 0) throw new FlowWalkerError(ErrorCodes.FLOW_PARSE_ERROR, 'Flow has no steps');
  const result = flow as FlowV2;
  validateFlowV2(result);
  return result;
}
export function parseFlowFile(filePath: string): Flow | FlowV2 {
  const content = readFileSync(filePath, 'utf-8');
  if (/^version:\s*2\s*$/m.test(content)) return parseFlowV2(content);
  return parseFlowV1(content);
}
export const parseFlow = parseFlowV1;
function pv(raw: string): string {
  let val = raw.trim();
  const ci = val.indexOf('  #');
  if (ci > 0) val = val.slice(0, ci).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
  return val;
}
function parseInlineArr(raw: string): string[] {
  const s = raw.trim();
  if (!s.startsWith('[') || !s.endsWith(']')) { const v = pv(s); return v ? [v] : []; }
  const inner = s.slice(1, -1).trim();
  if (!inner) return [];
  return splitC(inner).map(x => pv(x)).filter(Boolean);
}
function parseInlineObj(raw: string): Record<string, unknown> {
  const s = raw.trim();
  if (!s.startsWith('{') || !s.endsWith('}')) return {};
  const inner = s.slice(1, -1).trim();
  if (!inner) return {};
  const obj: Record<string, unknown> = {};
  for (const pair of splitC(inner)) {
    const ci = pair.indexOf(':');
    if (ci > 0) { const k = pair.slice(0, ci).trim(); const v = pv(pair.slice(ci + 1)); const n = Number(v); obj[k] = v === "true" ? true : v === "false" ? false : isNaN(n) ? v : n; }
  }
  return obj;
}
function splitC(str: string): string[] {
  const parts: string[] = []; let cur = ''; let inQ = false; let qc = '';
  for (const ch of str) {
    if (!inQ && (ch === '"' || ch === "'")) { inQ = true; qc = ch; cur += ch; }
    else if (inQ && ch === qc) { inQ = false; cur += ch; }
    else if (!inQ && ch === ',') { parts.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
