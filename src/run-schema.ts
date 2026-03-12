// Run result schema for flow-walker

/** Result of executing a single step */
export interface StepResult {
  name: string;
  action: string;         // "press" | "scroll" | "fill" | "back" | "assert" | "screenshot"
  status: 'pass' | 'fail' | 'skip';
  timestamp: number;      // ms since flow start
  duration: number;       // ms this step took
  elementCount: number;
  screenshot?: string;    // path to screenshot file
  assertion?: {
    interactive_count?: { min: number; actual: number };
    bottom_nav_tabs?: { min: number; actual: number };
  };
  error?: string;         // error message if failed
}

/** Complete run result */
export interface RunResult {
  flow: string;           // flow name
  device: string;         // device model/serial
  startedAt: string;      // ISO 8601
  duration: number;       // total ms
  result: 'pass' | 'fail';
  steps: StepResult[];
  video?: string;         // path to video file
  log?: string;           // path to log file
}

/** Validate a RunResult has all required fields */
export function validateRunResult(data: unknown): data is RunResult {
  if (typeof data !== 'object' || data === null) return false;
  const r = data as Record<string, unknown>;
  if (typeof r.flow !== 'string') return false;
  if (typeof r.device !== 'string') return false;
  if (typeof r.startedAt !== 'string') return false;
  if (typeof r.duration !== 'number') return false;
  if (r.result !== 'pass' && r.result !== 'fail') return false;
  if (!Array.isArray(r.steps)) return false;
  for (const step of r.steps) {
    if (typeof step !== 'object' || step === null) return false;
    const s = step as Record<string, unknown>;
    if (typeof s.name !== 'string') return false;
    if (typeof s.action !== 'string') return false;
    if (s.status !== 'pass' && s.status !== 'fail' && s.status !== 'skip') return false;
    if (typeof s.timestamp !== 'number') return false;
    if (typeof s.duration !== 'number') return false;
    if (typeof s.elementCount !== 'number') return false;
  }
  return true;
}
