export interface SchemaArg { name: string; required: boolean; description: string; }
export interface SchemaFlag { name: string; description: string; type: 'string' | 'boolean' | 'integer' | 'path'; default?: string; enum?: string[]; }
export interface CommandSchema { name: string; description: string; args: SchemaArg[]; flags: SchemaFlag[]; }
export const SCHEMA_VERSION = '2.1.0';
export const COMMAND_SCHEMAS: CommandSchema[] = [
  { name: 'walk', description: 'Auto-explore app via BFS, discover screens, generate YAML flows', args: [],
    flags: [
      { name: '--app-uri', type: 'string', description: 'VM Service WebSocket URI' },
      { name: '--bundle-id', type: 'string', description: 'Connect by bundle ID' },
      { name: '--max-depth', type: 'integer', description: 'Max depth', default: '5' },
      { name: '--output-dir', type: 'path', description: 'Output directory', default: './flows/' },
      { name: '--name', type: 'string', description: 'Generate scaffold v2 flow' },
      { name: '--output', type: 'path', description: 'Output file path' },
      { name: '--blocklist', type: 'string', description: 'Destructive keywords', default: 'delete,sign out,remove,reset,unpair,logout,clear all' },
      { name: '--agent', type: 'string', description: 'Agent transport type', enum: ['flutter', 'swift'] },
      { name: '--agent-path', type: 'path', description: 'Path to agent-flutter or agent-swift binary', default: 'agent-flutter' },
      { name: '--agent-flutter-path', type: 'path', description: 'Alias for --agent-path (deprecated)', default: 'agent-flutter' },
      { name: '--json', type: 'boolean', description: 'NDJSON output' },
      { name: '--no-json', type: 'boolean', description: 'Force human output' },
      { name: '--dry-run', type: 'boolean', description: 'Snapshot without pressing' },
      { name: '--skip-connect', type: 'boolean', description: 'Use existing session' },
    ] },
  { name: 'record', description: 'Record agent execution events. Full pipeline: (1) record init --flow <yaml> → returns run ID + dir + replay plan. (2) record stream events. (3) record finish --status pass --flow <yaml>. (4) verify <flow.yaml> --run-dir <dir> --mode audit → REQUIRED, creates v2 run.json. (5) report <run-dir>. (6) push <run-dir>. Step 4 (verify) is mandatory before report/push — report rejects non-v2 run.json. Screenshots: step-{step_id}.webp (preferred, q70) via: adb exec-out screencap -p > /tmp/raw.png && cwebp -q 70 -resize 270 600 /tmp/raw.png -o <run-dir>/step-S1.webp', args: [{ name: 'sub', required: true, description: 'init, stream, or finish' }],
    flags: [
      { name: '--flow', type: 'path', description: 'Flow YAML path (init)' },
      { name: '--output-dir', type: 'path', description: 'Output directory', default: './runs/' },
      { name: '--run-id', type: 'string', description: 'Run ID' },
      { name: '--run-dir', type: 'path', description: 'Run directory' },
      { name: '--status', type: 'string', description: 'Final status (finish)' },
      { name: '--no-video', type: 'boolean', description: 'Disable automatic video recording' },
      { name: '--json', type: 'boolean', description: 'JSON output' },
    ] },
  { name: 'verify', description: 'REQUIRED after record finish. Reads events.jsonl and produces v2 run.json with outcome/do/expectations/mode fields. Must run before report or push.', args: [{ name: 'flow', required: true, description: 'Path to v2 flow YAML' }],
    flags: [
      { name: '--run-dir', type: 'path', description: 'Run directory' },
      { name: '--mode', type: 'string', description: 'Verify mode', enum: ['strict', 'balanced', 'audit'], default: 'balanced' },
      { name: '--events', type: 'path', description: 'Events file path' },
      { name: '--output', type: 'path', description: 'Output run.json path' },
      { name: '--json', type: 'boolean', description: 'JSON output' },
    ] },
  { name: 'report', description: 'Generate HTML report from v2 run.json. Requires "verify" to have been run first — rejects v1/non-v2 data.', args: [{ name: 'run-dir', required: true, description: 'Directory with v2 run.json (from verify)' }],
    flags: [{ name: '--output', type: 'path', description: 'Output HTML path' }, { name: '--json', type: 'boolean', description: 'JSON output' }] },
  { name: 'push', description: 'Upload report to hosted service', args: [{ name: 'run-dir', required: true, description: 'Directory with run.json' }],
    flags: [{ name: '--json', type: 'boolean', description: 'JSON output' }] },
  { name: 'get', description: 'Fetch run data from hosted service', args: [{ name: 'run-id', required: true, description: 'Run ID' }],
    flags: [{ name: '--json', type: 'boolean', description: 'JSON output' }] },
  { name: 'migrate', description: 'Migrate v1 flow to v2 format', args: [{ name: 'flow', required: true, description: 'Path to v1 flow YAML' }],
    flags: [{ name: '--output', type: 'path', description: 'Output file path' }, { name: '--json', type: 'boolean', description: 'JSON output' }] },
  { name: 'snapshot', description: 'Save/load flow replay snapshots for fast re-execution. save extracts coordinates, timing, and commands from a successful run. load returns a replay plan so agents skip UI exploration and use exact coordinates.', args: [{ name: 'sub', required: true, description: 'save or load' }],
    flags: [
      { name: '--flow', type: 'path', description: 'Flow YAML path' },
      { name: '--run-dir', type: 'path', description: 'Run directory (save only)' },
      { name: '--device', type: 'string', description: 'Device model for snapshot binding' },
      { name: '--resolution', type: 'string', description: 'Device resolution (save only)' },
      { name: '--json', type: 'boolean', description: 'JSON output' },
    ] },
  { name: 'schema', description: 'Show command schema for agent discovery', args: [{ name: 'command', required: false, description: 'Command name' }], flags: [] },
];
export function getCommandSchema(name: string): CommandSchema | undefined { return COMMAND_SCHEMAS.find(s => s.name === name); }
export function getSchemaEnvelope(): { version: string; commands: CommandSchema[] } { return { version: SCHEMA_VERSION, commands: COMMAND_SCHEMAS }; }
