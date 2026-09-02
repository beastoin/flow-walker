import type { FlowV2 } from './types.ts';
import { AgentFlowError, ErrorCodes } from './errors.ts';

const LEGACY_ACTION_KEYS = new Set(['press', 'fill', 'scroll', 'back', 'adb', 'wait']);

export function validateFlowV2(flow: FlowV2): void {
  if (flow.version !== 2) throw new AgentFlowError(ErrorCodes.FLOW_PARSE_ERROR, 'v2 flow must have version: 2');
  if (!flow.name) throw new AgentFlowError(ErrorCodes.FLOW_PARSE_ERROR, 'v2 flow must have name');
  if (!flow.steps || flow.steps.length === 0) throw new AgentFlowError(ErrorCodes.FLOW_PARSE_ERROR, 'v2 flow must have at least one step');
  const ids = new Set<string>();
  for (const step of flow.steps) {
    if (!step.id) throw new AgentFlowError(ErrorCodes.FLOW_PARSE_ERROR, 'Every v2 step must have an id');
    if (ids.has(step.id)) throw new AgentFlowError(ErrorCodes.FLOW_PARSE_ERROR, `Duplicate step id: ${step.id}`);
    ids.add(step.id);
    if (!step.do) {
      const stepObj = step as unknown as Record<string, unknown>;
      const unknownKeys = Object.keys(stepObj).filter(k => !['id', 'name', 'do', 'claim', 'anchors', 'expect', 'judge', 'evidence', 'note', 'verify'].includes(k));
      const hint = unknownKeys.length > 0
        ? `. Found unknown keys: ${unknownKeys.join(', ')}. Did you mean "judge" instead of "agent_prompts"?`
        : '';
      throw new AgentFlowError(ErrorCodes.FLOW_PARSE_ERROR, `Step ${step.id} must have a do: instruction${hint}`, 'Each step needs do: with a natural-language action. See: agent-flow schema record');
    }
    const stepObj = step as unknown as Record<string, unknown>;
    for (const key of LEGACY_ACTION_KEYS) {
      if (key in stepObj && stepObj[key] !== undefined && stepObj[key] !== '') {
        throw new AgentFlowError(ErrorCodes.FLOW_PARSE_ERROR, `Step ${step.id} contains legacy action key "${key}" — use do: instead (press → "Press the X button")`);
      }
    }
  }
}

export function buildScaffoldFlow(name: string): FlowV2 {
  return {
    version: 2, name,
    description: `Scaffold flow: ${name}`,
    steps: [{
      id: 'S1', name: 'Start',
      do: `Open the ${name} screen`,
      anchors: [name],
      expect: [{ milestone: `${name}-visible`, outcome: 'pass' }],
      evidence: [{ screenshot: `${name}.webp` }],
    }],
  };
}
