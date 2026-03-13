export const EVENT_TYPES = [
  'run.start', 'step.start', 'action', 'assert',
  'artifact', 'step.end', 'run.end', 'note',
] as const;

export type EventType = typeof EVENT_TYPES[number];

export interface RecordEvent {
  type: EventType;
  step_id?: string;
  seq?: number;
  ts?: string;
  [key: string]: unknown;
}

const STEP_SCOPED: Set<string> = new Set(['step.start', 'action', 'assert', 'artifact', 'step.end']);

export function validateEvent(event: unknown): { valid: boolean; error?: string } {
  if (!event || typeof event !== 'object') return { valid: false, error: 'Event must be an object' };
  const e = event as Record<string, unknown>;
  if (!e.type || typeof e.type !== 'string') return { valid: false, error: 'Event must have a string type field' };
  if (!EVENT_TYPES.includes(e.type as EventType)) return { valid: false, error: `Unknown event type: ${e.type}` };
  if (STEP_SCOPED.has(e.type) && !e.step_id) return { valid: false, error: `Event type ${e.type} requires step_id` };
  return { valid: true };
}
