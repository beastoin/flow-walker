// Command schema for flow-walker — single source of truth
// Used by: schema subcommand, --help --json, agent introspection

export interface SchemaArg {
  name: string;
  required: boolean;
  description: string;
}

export interface SchemaFlag {
  name: string;
  description: string;
  default?: string;
}

export interface CommandSchema {
  name: string;
  description: string;
  args: SchemaArg[];
  flags: SchemaFlag[];
  exitCodes: Record<string, string>;
  examples: string[];
}

export const COMMAND_SCHEMAS: CommandSchema[] = [
  {
    name: 'walk',
    description: 'Auto-explore app via BFS, discover screens, generate YAML flows',
    args: [],
    flags: [
      { name: '--app-uri', description: 'VM Service WebSocket URI (ws://...)' },
      { name: '--bundle-id', description: 'Connect by bundle ID' },
      { name: '--max-depth', description: 'Max navigation depth', default: '5' },
      { name: '--output-dir', description: 'Output directory for YAML flows', default: './flows/' },
      { name: '--blocklist', description: 'Comma-separated destructive keywords to avoid', default: 'delete,sign out,remove,reset,unpair,logout,clear all' },
      { name: '--agent-flutter-path', description: 'Path to agent-flutter binary', default: 'agent-flutter' },
      { name: '--json', description: 'NDJSON output (one event per line)' },
      { name: '--no-json', description: 'Force human-readable output' },
      { name: '--dry-run', description: 'Snapshot and plan without pressing' },
      { name: '--skip-connect', description: 'Use existing agent-flutter session' },
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
      { name: 'flow', required: true, description: 'Path to YAML flow file' },
    ],
    flags: [
      { name: '--output-dir', description: 'Output directory for results', default: './run-output/' },
      { name: '--agent-flutter-path', description: 'Path to agent-flutter binary', default: 'agent-flutter' },
      { name: '--no-video', description: 'Skip video recording' },
      { name: '--no-logs', description: 'Skip logcat capture' },
      { name: '--json', description: 'Machine-readable JSON output' },
      { name: '--no-json', description: 'Force human-readable output' },
      { name: '--dry-run', description: 'Parse and resolve without executing' },
    ],
    exitCodes: { '0': 'all steps pass', '1': 'one or more steps fail', '2': 'error' },
    examples: [
      'flow-walker run flows/tab-navigation.yaml',
      'flow-walker run flows/login.yaml --output-dir ./results/ --json',
      'flow-walker run flows/settings.yaml --dry-run',
    ],
  },
  {
    name: 'report',
    description: 'Generate self-contained HTML report from run results',
    args: [
      { name: 'run-dir', required: true, description: 'Directory containing run.json' },
    ],
    flags: [
      { name: '--output', description: 'Output HTML file path', default: '<run-dir>/report.html' },
      { name: '--no-video', description: 'Exclude video from report' },
    ],
    exitCodes: { '0': 'success', '2': 'error' },
    examples: [
      'flow-walker report ./run-output/',
      'flow-walker report ./results/ --output /tmp/report.html',
      'flow-walker report ./results/ --no-video',
    ],
  },
  {
    name: 'schema',
    description: 'Show command schema for agent discovery (always JSON)',
    args: [
      { name: 'command', required: false, description: 'Specific command to describe' },
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

/** Get schema for a specific command */
export function getCommandSchema(name: string): CommandSchema | undefined {
  return COMMAND_SCHEMAS.find(s => s.name === name);
}
