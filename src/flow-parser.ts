import { readFileSync } from 'node:fs';
import type { FlowV2, FlowV2Step, FlowV2Expect, FlowV2Evidence } from './types.ts';
import { FlowWalkerError, ErrorCodes } from './errors.ts';
import { validateFlowV2 } from './flow-v2-schema.ts';
/** Resolve YAML multi-line scalars (> folded, | literal) into single-line values */
function resolveMultiLineScalars(rawLines: string[]): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i];
    const trimmed = line.trim();
    // Check if this line ends with a multi-line scalar indicator
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const afterColon = trimmed.slice(colonIdx + 1).trim();
      if (afterColon === '>' || afterColon === '|') {
        const joiner = afterColon === '>' ? ' ' : '\n';
        const prefix = line.slice(0, line.indexOf(trimmed)) + trimmed.slice(0, colonIdx + 1) + ' ';
        // Collect continuation lines
        const parts: string[] = [];
        i++;
        // Determine the indentation level of the first continuation line
        let blockIndent = -1;
        while (i < rawLines.length) {
          const nextLine = rawLines[i];
          if (nextLine.trim() === '') { i++; continue; } // skip blank lines
          const indent = nextLine.length - nextLine.trimStart().length;
          if (blockIndent === -1) blockIndent = indent;
          if (indent < blockIndent) break; // back to parent indentation
          parts.push(nextLine.trim());
          i++;
        }
        result.push(prefix + parts.join(joiner));
        continue;
      }
    }
    result.push(line);
    i++;
  }
  return result;
}

export function parseFlowV2(yamlContent: string): FlowV2 {
  const rawLines = yamlContent.split('\n');
  // Pre-process: resolve multi-line scalars (> and |)
  const lines = resolveMultiLineScalars(rawLines);
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
    else { for (const key of ['press', 'fill', 'scroll', 'back', 'adb', 'wait']) { if (t.startsWith(`${key}:`)) currentStep[key] = t.slice(key.length + 1).trim(); } }
  }
  if (currentStep.id) flow.steps!.push(currentStep as unknown as FlowV2Step);
  if (!flow.version) flow.version = 2;
  if (!flow.name) throw new FlowWalkerError(ErrorCodes.FLOW_PARSE_ERROR, 'Flow missing required field: name');
  if (!flow.steps || flow.steps.length === 0) throw new FlowWalkerError(ErrorCodes.FLOW_PARSE_ERROR, 'Flow has no steps');
  const result = flow as FlowV2;
  validateFlowV2(result);
  return result;
}
export function parseFlowFile(filePath: string): FlowV2 {
  const content = readFileSync(filePath, 'utf-8');
  if (/^version:\s*2\s*$/m.test(content)) return parseFlowV2(content);
  throw new FlowWalkerError(ErrorCodes.FLOW_PARSE_ERROR, 'Only v2 flows are supported (must have version: 2)');
}
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
