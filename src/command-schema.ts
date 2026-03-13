export interface SchemaArg { name: string; required: boolean; description: string; }
export interface SchemaFlag { name: string; description: string; type: 'string' | 'boolean' | 'integer' | 'path'; default?: string; enum?: string[]; }
export interface CommandSchema { name: string; description: string; args: SchemaArg[]; flags: SchemaFlag[]; }
export const SCHEMA_VERSION = '2.0.0';
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
      { name: '--agent-flutter-path', type: 'path', description: 'agent-flutter binary path', default: 'agent-flutter' },
      { name: '--json', type: 'boolean', description: 'NDJSON output' },
      { name: '--no-json', type: 'boolean', description: 'Force human output' },
      { name: '--dry-run', type: 'boolean', description: 'Snapshot without pressing' },
      { name: '--skip-connect', type: 'boolean', description: 'Use existing session' },
    ] },
  { name: 'record', description: 'Record agent execution events', args: [{ name: 'sub', required: true, description: 'init, stream, or finish' }],
    flags: [
      { name: '--flow', type: 'path', description: 'Flow YAML path (init)' },
      { name: '--output-dir', type: 'path', description: 'Output directory', default: './runs/' },
      { name: '--run-id', type: 'string', description: 'Run ID' },
      { name: '--run-dir', type: 'path', description: 'Run directory' },
      { name: '--status', type: 'string', description: 'Final status (finish)' },
      { name: '--json', type: 'boolean', description: 'JSON output' },
    ] },
  { name: 'verify', description: 'Verify recorded events against flow expectations', args: [{ name: 'flow', required: true, description: 'Path to v2 flow YAML' }],
    flags: [
      { name: '--run-dir', type: 'path', description: 'Run directory' },
      { name: '--mode', type: 'string', description: 'Verify mode', enum: ['strict', 'balanced', 'audit'], default: 'balanced' },
      { name: '--events', type: 'path', description: 'Events file path' },
      { name: '--output', type: 'path', description: 'Output run.json path' },
      { name: '--json', type: 'boolean', description: 'JSON output' },
    ] },
  { name: 'report', description: 'Generate HTML report from run results', args: [{ name: 'run-dir', required: true, description: 'Directory with run.json' }],
    flags: [{ name: '--output', type: 'path', description: 'Output HTML path' }, { name: '--json', type: 'boolean', description: 'JSON output' }] },
  { name: 'push', description: 'Upload report to hosted service', args: [{ name: 'run-dir', required: true, description: 'Directory with run.json' }],
    flags: [{ name: '--json', type: 'boolean', description: 'JSON output' }] },
  { name: 'get', description: 'Fetch run data from hosted service', args: [{ name: 'run-id', required: true, description: 'Run ID' }],
    flags: [{ name: '--json', type: 'boolean', description: 'JSON output' }] },
  { name: 'migrate', description: 'Migrate v1 flow to v2 format', args: [{ name: 'flow', required: true, description: 'Path to v1 flow YAML' }],
    flags: [{ name: '--output', type: 'path', description: 'Output file path' }, { name: '--json', type: 'boolean', description: 'JSON output' }] },
  { name: 'schema', description: 'Show command schema for agent discovery', args: [{ name: 'command', required: false, description: 'Command name' }], flags: [] },
];
export function getCommandSchema(name: string): CommandSchema | undefined { return COMMAND_SCHEMAS.find(s => s.name === name); }
export function getSchemaEnvelope(): { version: string; commands: CommandSchema[] } { return { version: SCHEMA_VERSION, commands: COMMAND_SCHEMAS }; }
