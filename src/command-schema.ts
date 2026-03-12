// Command schema for flow-walker — single source of truth
// Used by: schema subcommand, --help --json, agent introspection

export interface SchemaArg {
  name: string;
  required: boolean;
  description: string;
  type: 'string' | 'path' | 'integer';
}

export interface SchemaFlag {
  name: string;
  description: string;
  type: 'string' | 'boolean' | 'integer' | 'path';
  default?: string;
}

export interface OutputField {
  name: string;
  type: string;
  description: string;
}

export interface CommandSchema {
  name: string;
  description: string;
  args: SchemaArg[];
  flags: SchemaFlag[];
  exitCodes: Record<string, string>;
  examples: string[];
  outputShape?: OutputField[];
}

export const COMMAND_SCHEMAS: CommandSchema[] = [
  {
    name: 'walk',
    description: 'Auto-explore app via BFS, discover screens, generate YAML flows',
    args: [],
    flags: [
      { name: '--app-uri', type: 'string', description: 'VM Service WebSocket URI (ws://...)' },
      { name: '--bundle-id', type: 'string', description: 'Connect by bundle ID' },
      { name: '--max-depth', type: 'integer', description: 'Max navigation depth', default: '5' },
      { name: '--output-dir', type: 'path', description: 'Output directory for YAML flows', default: './flows/' },
      { name: '--blocklist', type: 'string', description: 'Comma-separated destructive keywords to avoid', default: 'delete,sign out,remove,reset,unpair,logout,clear all' },
      { name: '--agent-flutter-path', type: 'path', description: 'Path to agent-flutter binary', default: 'agent-flutter' },
      { name: '--json', type: 'boolean', description: 'NDJSON output (one event per line)' },
      { name: '--no-json', type: 'boolean', description: 'Force human-readable output' },
      { name: '--dry-run', type: 'boolean', description: 'Snapshot and plan without pressing' },
      { name: '--skip-connect', type: 'boolean', description: 'Use existing agent-flutter session' },
    ],
    exitCodes: { '0': 'success', '2': 'error' },
    examples: [
      'flow-walker walk --app-uri ws://127.0.0.1:38047/abc=/ws',
      'flow-walker walk --skip-connect --max-depth 3',
      'flow-walker walk --bundle-id com.example.app --json',
    ],
  },
  {
    name: 'run',
    description: 'Execute a YAML flow, produce run.json + video + screenshots',
    args: [
      { name: 'flow', required: true, description: 'Path to YAML flow file', type: 'path' },
    ],
    flags: [
      { name: '--output-dir', type: 'path', description: 'Output directory for results', default: './run-output/' },
      { name: '--agent-flutter-path', type: 'path', description: 'Path to agent-flutter binary', default: 'agent-flutter' },
      { name: '--no-video', type: 'boolean', description: 'Skip video recording' },
      { name: '--no-logs', type: 'boolean', description: 'Skip logcat capture' },
      { name: '--json', type: 'boolean', description: 'Machine-readable JSON output' },
      { name: '--no-json', type: 'boolean', description: 'Force human-readable output' },
      { name: '--dry-run', type: 'boolean', description: 'Parse and resolve without executing' },
    ],
    exitCodes: { '0': 'all steps pass', '1': 'one or more steps fail', '2': 'error' },
    examples: [
      'flow-walker run flows/tab-navigation.yaml',
      'flow-walker run flows/login.yaml --output-dir ./results/ --json',
      'flow-walker run flows/settings.yaml --dry-run',
    ],
    outputShape: [
      { name: 'id', type: 'string', description: 'Unique 10-char run ID' },
      { name: 'flow', type: 'string', description: 'Flow name' },
      { name: 'result', type: 'pass|fail', description: 'Overall result' },
      { name: 'duration', type: 'number', description: 'Total milliseconds' },
      { name: 'steps', type: 'StepResult[]', description: 'Per-step results with index, name, action, status, duration, elementCount, assertion' },
      { name: 'device', type: 'string', description: 'Device model' },
      { name: 'video', type: 'string?', description: 'Recording filename' },
    ],
  },
  {
    name: 'report',
    description: 'Generate self-contained HTML report from run results',
    args: [
      { name: 'run-dir', required: true, description: 'Directory containing run.json', type: 'path' },
    ],
    flags: [
      { name: '--output', type: 'path', description: 'Output HTML file path', default: '<run-dir>/report.html' },
      { name: '--no-video', type: 'boolean', description: 'Exclude video from report' },
    ],
    exitCodes: { '0': 'success', '2': 'error' },
    examples: [
      'flow-walker report ./run-output/',
      'flow-walker report ./results/ --output /tmp/report.html',
      'flow-walker report ./results/ --no-video',
    ],
  },
  {
    name: 'push',
    description: 'Upload report to hosted service and return shareable URL',
    args: [
      { name: 'run-dir', required: true, description: 'Directory containing run.json and report.html', type: 'path' },
    ],
    flags: [
      { name: '--json', type: 'boolean', description: 'Machine-readable JSON output' },
      { name: '--no-json', type: 'boolean', description: 'Force human-readable output' },
    ],
    exitCodes: { '0': 'success', '2': 'error' },
    examples: [
      'flow-walker push ./run-output/P-tnB_sgKA/',
      'flow-walker push ./run-output/P-tnB_sgKA/ --json',
    ],
    outputShape: [
      { name: 'id', type: 'string', description: 'Run ID' },
      { name: 'url', type: 'string', description: 'JSON URL (agent-first)' },
      { name: 'htmlUrl', type: 'string', description: 'HTML report URL (human)' },
      { name: 'expiresAt', type: 'string', description: 'ISO 8601 expiry (30 days)' },
    ],
  },
  {
    name: 'get',
    description: 'Fetch run data from hosted service',
    args: [
      { name: 'run-id', required: true, description: 'Run ID (from push or run output)', type: 'string' },
    ],
    flags: [
      { name: '--json', type: 'boolean', description: 'Compact JSON output (default: pretty-printed)' },
      { name: '--no-json', type: 'boolean', description: 'Force human-readable output' },
    ],
    exitCodes: { '0': 'success', '2': 'error (not found, network)' },
    examples: [
      'flow-walker get 25h7afGwBK',
      'flow-walker get 25h7afGwBK --json',
      'flow-walker get 25h7afGwBK | jq \'.steps[] | select(.status=="fail")\'',
    ],
    outputShape: [
      { name: 'id', type: 'string', description: 'Run ID' },
      { name: 'flow', type: 'string', description: 'Flow name' },
      { name: 'result', type: 'pass|fail', description: 'Overall result' },
      { name: 'duration', type: 'number', description: 'Total milliseconds' },
      { name: 'steps', type: 'StepResult[]', description: 'Per-step results' },
    ],
  },
  {
    name: 'schema',
    description: 'Show command schema for agent discovery (always JSON)',
    args: [
      { name: 'command', required: false, description: 'Specific command to describe', type: 'string' },
    ],
    flags: [],
    exitCodes: { '0': 'success', '2': 'error (unknown command)' },
    examples: [
      'flow-walker schema',
      'flow-walker schema run',
      'flow-walker schema walk',
    ],
  },
];

export const SCHEMA_VERSION = '0.2.1';

/** Get schema for a specific command */
export function getCommandSchema(name: string): CommandSchema | undefined {
  return COMMAND_SCHEMAS.find(s => s.name === name);
}

/** Get full schema envelope with version */
export function getSchemaEnvelope(): { version: string; commands: CommandSchema[] } {
  return { version: SCHEMA_VERSION, commands: COMMAND_SCHEMAS };
}
