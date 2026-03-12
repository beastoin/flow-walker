// YAML flow parser for flow-walker
// Parses the flow format used in app/e2e/flows/*.yaml

import { readFileSync } from 'node:fs';
import type { Flow, FlowStep } from './types.ts';
import { FlowWalkerError, ErrorCodes } from './errors.ts';

/** Parse a YAML flow file into a Flow object */
export function parseFlow(yamlContent: string): Flow {
  const lines = yamlContent.split('\n');
  const flow: Partial<Flow> = { steps: [] };
  let currentStep: Partial<FlowStep> | null = null;
  let inSteps = false;
  let inCovers = false;
  let inPrerequisites = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // Skip comments and blank lines at top level
    if (line.startsWith('#') || line.trim() === '') continue;

    // Top-level fields
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      inCovers = false;
      inPrerequisites = false;

      if (line.startsWith('name:')) {
        flow.name = parseScalarValue(line.slice(5));
      } else if (line.startsWith('description:')) {
        flow.description = parseScalarValue(line.slice(12));
      } else if (line.startsWith('app:')) {
        flow.app = parseScalarValue(line.slice(4));
      } else if (line.startsWith('app_url:')) {
        flow.appUrl = parseScalarValue(line.slice(8));
      } else if (line.startsWith('setup:')) {
        flow.setup = parseScalarValue(line.slice(6));
      } else if (line.startsWith('covers:')) {
        inCovers = true;
        flow.covers = [];
      } else if (line.startsWith('prerequisites:')) {
        inPrerequisites = true;
        flow.prerequisites = [];
      } else if (line.startsWith('steps:')) {
        inSteps = true;
      }
      continue;
    }

    // Array items under covers/prerequisites
    const trimmed = line.trim();
    if (inCovers && trimmed.startsWith('- ')) {
      flow.covers!.push(parseScalarValue(trimmed.slice(2)));
      continue;
    }
    if (inPrerequisites && trimmed.startsWith('- ')) {
      flow.prerequisites!.push(parseScalarValue(trimmed.slice(2)));
      continue;
    }

    if (!inSteps) continue;

    // Step list items
    if (trimmed.startsWith('- name:')) {
      if (currentStep && currentStep.name) {
        flow.steps!.push(currentStep as FlowStep);
      }
      currentStep = { name: parseScalarValue(trimmed.slice(7)) };
      continue;
    }

    if (!currentStep) continue;

    // Step fields
    if (trimmed.startsWith('press:')) {
      currentStep.press = parseInlineObject(trimmed.slice(6).trim()) as FlowStep['press'];
    } else if (trimmed.startsWith('scroll:')) {
      currentStep.scroll = parseScalarValue(trimmed.slice(7));
    } else if (trimmed.startsWith('fill:')) {
      currentStep.fill = parseInlineObject(trimmed.slice(5).trim()) as FlowStep['fill'];
    } else if (trimmed.startsWith('back:')) {
      currentStep.back = parseScalarValue(trimmed.slice(5)) === 'true';
    } else if (trimmed.startsWith('screenshot:')) {
      currentStep.screenshot = parseScalarValue(trimmed.slice(11));
    } else if (trimmed.startsWith('note:')) {
      currentStep.note = parseScalarValue(trimmed.slice(5));
    } else if (trimmed.startsWith('assert:')) {
      const inlineVal = trimmed.slice(7).trim();
      if (inlineVal) {
        currentStep.assert = parseInlineObject(inlineVal) as FlowStep['assert'];
      } else {
        currentStep.assert = {};
      }
    } else if (trimmed.startsWith('interactive_count:')) {
      if (!currentStep.assert) currentStep.assert = {};
      currentStep.assert.interactive_count = parseInlineObject(trimmed.slice(18).trim()) as { min: number };
    } else if (trimmed.startsWith('bottom_nav_tabs:')) {
      if (!currentStep.assert) currentStep.assert = {};
      currentStep.assert.bottom_nav_tabs = parseInlineObject(trimmed.slice(16).trim()) as { min: number };
    } else if (trimmed.startsWith('has_type:')) {
      if (!currentStep.assert) currentStep.assert = {};
      currentStep.assert.has_type = parseInlineObject(trimmed.slice(9).trim()) as { type: string; min?: number };
    } else if (trimmed.startsWith('text_visible:')) {
      if (!currentStep.assert) currentStep.assert = {};
      currentStep.assert.text_visible = parseInlineArray(trimmed.slice(13).trim());
    } else if (trimmed.startsWith('text_not_visible:')) {
      if (!currentStep.assert) currentStep.assert = {};
      currentStep.assert.text_not_visible = parseInlineArray(trimmed.slice(17).trim());
    }
  }

  // Push last step
  if (currentStep && currentStep.name) {
    flow.steps!.push(currentStep as FlowStep);
  }

  if (!flow.name) throw new FlowWalkerError(ErrorCodes.FLOW_PARSE_ERROR, 'Flow missing required field: name', 'Add a name: field at the top of the YAML flow');
  if (!flow.steps || flow.steps.length === 0) throw new FlowWalkerError(ErrorCodes.FLOW_PARSE_ERROR, 'Flow has no steps', 'Add steps: with at least one - name: entry');

  return {
    name: flow.name,
    description: flow.description ?? '',
    ...(flow.app ? { app: flow.app } : {}),
    ...(flow.appUrl ? { appUrl: flow.appUrl } : {}),
    covers: flow.covers,
    prerequisites: flow.prerequisites,
    setup: flow.setup ?? 'normal',
    steps: flow.steps,
  };
}

/** Load and parse a YAML flow from a file path */
export function parseFlowFile(filePath: string): Flow {
  const content = readFileSync(filePath, 'utf-8');
  return parseFlow(content);
}

/** Parse a scalar YAML value (strip quotes, inline comments) */
function parseScalarValue(raw: string): string {
  let val = raw.trim();
  // Remove inline comments (but not # inside quotes)
  const commentIdx = val.indexOf('  #');
  if (commentIdx > 0) val = val.slice(0, commentIdx).trim();
  // Strip surrounding quotes
  if ((val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  return val;
}

/** Parse an inline YAML object like { type: button, position: rightmost } */
function parseInlineObject(raw: string): Record<string, unknown> {
  const str = raw.trim();
  if (!str.startsWith('{') || !str.endsWith('}')) {
    // Simple scalar — return as-is in a value field
    return { value: parseScalarValue(str) } as Record<string, unknown>;
  }

  const inner = str.slice(1, -1).trim();
  const result: Record<string, unknown> = {};

  // Split by comma, handling quoted strings
  const pairs = splitCommas(inner);
  for (const pair of pairs) {
    const colonIdx = pair.indexOf(':');
    if (colonIdx < 0) continue;
    const key = pair.slice(0, colonIdx).trim();
    const valRaw = pair.slice(colonIdx + 1).trim();
    const val = parseScalarValue(valRaw);

    // Type coercion
    if (val === 'true') result[key] = true;
    else if (val === 'false') result[key] = false;
    else if (/^\d+$/.test(val)) result[key] = parseInt(val, 10);
    else if (/^\d+\.\d+$/.test(val)) result[key] = parseFloat(val);
    else result[key] = val;
  }

  return result;
}

/** Parse an inline YAML array like ["Featured", "Create Your Own App"] */
function parseInlineArray(raw: string): string[] {
  const str = raw.trim();
  if (!str.startsWith('[') || !str.endsWith(']')) {
    // Single value — wrap in array
    const val = parseScalarValue(str);
    return val ? [val] : [];
  }

  const inner = str.slice(1, -1).trim();
  if (!inner) return [];

  return splitCommas(inner).map(s => parseScalarValue(s)).filter(Boolean);
}

/** Split string by commas, respecting quoted strings */
function splitCommas(str: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (const ch of str) {
    if (!inQuote && (ch === '"' || ch === "'")) {
      inQuote = true;
      quoteChar = ch;
      current += ch;
    } else if (inQuote && ch === quoteChar) {
      inQuote = false;
      current += ch;
    } else if (!inQuote && ch === ',') {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}
