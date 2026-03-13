#!/usr/bin/env node --experimental-strip-types
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { WalkerConfig, FlowV2 } from './types.ts';
import { walk } from './walker.ts';
import { parseFlowFile, parseFlowV2 } from './flow-parser.ts';
import { buildScaffoldFlow } from './flow-v2-schema.ts';
import { toYamlV2 } from './yaml-writer.ts';
import { recordInit, recordStream, recordFinish } from './record.ts';
import { verifyRun } from './verify.ts';
import type { VerifyResult } from './verify.ts';
import { migrateFlowV1toV2 } from './migrate.ts';
import { generateReportV2 } from './reporter.ts';
import { FlowWalkerError, ErrorCodes, formatError } from './errors.ts';
import { validateFlowPath, validateOutputDir, validateUri, validateBundleId } from './validate.ts';
import { COMMAND_SCHEMAS, SCHEMA_VERSION, getCommandSchema, getSchemaEnvelope } from './command-schema.ts';
import { pushReport, getRunData } from './push.ts';
const DEFAULT_BLOCKLIST = 'delete,sign out,remove,reset,unpair,logout,clear all';
function resolveJsonMode(flags: Record<string, unknown>): boolean {
  if (flags['no-json']) return false; if (flags['json']) return true;
  if (process.env.FLOW_WALKER_JSON === '1') return true;
  if (!process.stdout.isTTY) return true; return false;
}
function printUsage(): void {
  console.log(`flow-walker — Agent-first flow testing for Flutter apps

Usage:
  flow-walker walk [options]                  Auto-explore app and generate YAML flows
  flow-walker record <init|stream|finish>     Record agent execution events
  flow-walker verify <flow.yaml> [options]    Verify events against flow expectations
  flow-walker report <run-dir>                Generate HTML report from run results
  flow-walker push <run-dir>                  Upload report and return shareable URL
  flow-walker get <run-id>                    Fetch run data from hosted service
  flow-walker migrate <flow.yaml>             Migrate v1 flow to v2 format
  flow-walker schema [command]                Show command schema for agent discovery
`);
}
async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'app-uri': { type: 'string' }, 'bundle-id': { type: 'string' },
      'max-depth': { type: 'string', default: '5' }, 'output-dir': { type: 'string' },
      'output': { type: 'string' }, 'name': { type: 'string' },
      'blocklist': { type: 'string', default: DEFAULT_BLOCKLIST },
      'agent-flutter-path': { type: 'string' },
      'json': { type: 'boolean', default: false }, 'no-json': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false }, 'skip-connect': { type: 'boolean', default: false },
      'no-video': { type: 'boolean', default: false }, 'no-logs': { type: 'boolean', default: false },
      'help': { type: 'boolean', default: false }, 'version': { type: 'boolean', default: false },
      'flow': { type: 'string' }, 'run-id': { type: 'string' }, 'run-dir': { type: 'string' },
      'status': { type: 'string' }, 'mode': { type: 'string' }, 'events': { type: 'string' },
    },
  });
  const subcommand = positionals[0];
  const json = resolveJsonMode(values);
  const agentPath = (values['agent-flutter-path'] as string | undefined) ?? process.env.FLOW_WALKER_AGENT_PATH ?? 'agent-flutter';
  const dryRun = (values['dry-run'] as boolean) || process.env.FLOW_WALKER_DRY_RUN === '1';
  if (values.version) { console.log(json ? JSON.stringify({ version: SCHEMA_VERSION }) : `flow-walker ${SCHEMA_VERSION}`); process.exit(0); }
  if (values.help || !subcommand) {
    if (json && subcommand) { const schema = getCommandSchema(subcommand); if (schema) { console.log(JSON.stringify(schema)); process.exit(0); } }
    printUsage(); process.exit(subcommand ? 0 : 1);
  }
  try {
    if (subcommand === 'walk') await handleWalk(values, positionals, json, agentPath, dryRun);
    else if (subcommand === 'record') await handleRecord(values, positionals, json);
    else if (subcommand === 'verify') await handleVerify(values, positionals, json);
    else if (subcommand === 'report') await handleReport(values, positionals, json);
    else if (subcommand === 'push') await handlePush(positionals, json);
    else if (subcommand === 'get') await handleGet(positionals, json);
    else if (subcommand === 'migrate') await handleMigrate(values, positionals, json);
    else if (subcommand === 'schema') handleSchema(positionals);
    else throw new FlowWalkerError(ErrorCodes.INVALID_ARGS, `Unknown subcommand: ${subcommand}`, 'Available: walk, record, verify, report, push, get, migrate, schema');
  } catch (err) { console.error(formatError(err, json)); process.exit(2); }
}
async function handleWalk(values: Record<string, unknown>, _positionals: string[], json: boolean, agentPath: string, dryRun: boolean): Promise<void> {
  const scaffoldName = values['name'] as string | undefined;
  if (scaffoldName) {
    const flow = buildScaffoldFlow(scaffoldName);
    const yaml = toYamlV2(flow);
    const out = values['output'] as string | undefined;
    if (out) { writeFileSync(out, yaml); console.log(json ? JSON.stringify({ file: out, name: scaffoldName }) : `Scaffold written: ${out}`); }
    else process.stdout.write(yaml);
    process.exit(0);
  }
  if (values['app-uri']) validateUri(values['app-uri'] as string);
  if (values['bundle-id']) validateBundleId(values['bundle-id'] as string);
  if (!values['app-uri'] && !values['bundle-id'] && !values['skip-connect']) throw new FlowWalkerError(ErrorCodes.INVALID_ARGS, 'Either --app-uri, --bundle-id, --skip-connect, or --name is required');
  const outputDir = (values['output-dir'] as string | undefined) ?? process.env.FLOW_WALKER_OUTPUT_DIR ?? './flows/';
  validateOutputDir(outputDir);
  const config: WalkerConfig = {
    appUri: values['app-uri'] as string | undefined, bundleId: values['bundle-id'] as string | undefined,
    maxDepth: parseInt(values['max-depth'] as string, 10), outputDir,
    blocklist: (values['blocklist'] as string).split(',').map(s => s.trim()),
    json, dryRun, agentFlutterPath: agentPath, skipConnect: values['skip-connect'] as boolean,
  };
  const result = await walk(config);
  console.log(json ? JSON.stringify({ type: 'result', ...result }) : `\nDone. ${result.screensFound} screens, ${result.flowsGenerated} flows, ${result.elementsSkipped} skipped.`);
  process.exit(0);
}
async function handleRecord(values: Record<string, unknown>, positionals: string[], json: boolean): Promise<void> {
  const sub = positionals[1];
  if (!sub || !['init', 'stream', 'finish'].includes(sub)) throw new FlowWalkerError(ErrorCodes.INVALID_ARGS, 'record requires: init, stream, or finish');
  if (sub === 'init') {
    const flowPath = values['flow'] as string;
    if (!flowPath) throw new FlowWalkerError(ErrorCodes.INVALID_ARGS, 'record init requires --flow <path>');
    validateFlowPath(flowPath);
    const outputDir = (values['output-dir'] as string | undefined) ?? './runs/';
    const result = recordInit({ flowPath, outputDir, runId: values['run-id'] as string | undefined });
    console.log(json ? JSON.stringify(result) : `Run initialized: ${result.id}\n  Directory: ${result.dir}`);
    process.exit(0);
  }
  if (sub === 'stream') {
    const runId = values['run-id'] as string; const runDir = values['run-dir'] as string;
    if (!runId) throw new FlowWalkerError(ErrorCodes.INVALID_ARGS, 'record stream requires --run-id');
    if (!runDir) throw new FlowWalkerError(ErrorCodes.INVALID_ARGS, 'record stream requires --run-dir');
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const input = Buffer.concat(chunks).toString('utf-8');
    const lines = input.trim().split('\n').filter(Boolean);
    const count = recordStream({ runId, runDir }, lines);
    console.log(json ? JSON.stringify({ appended: count }) : `Appended ${count} events`);
    process.exit(0);
  }
  if (sub === 'finish') {
    const runId = values['run-id'] as string; const runDir = values['run-dir'] as string;
    const status = (values['status'] as string) || 'pass';
    if (!runId) throw new FlowWalkerError(ErrorCodes.INVALID_ARGS, 'record finish requires --run-id');
    if (!runDir) throw new FlowWalkerError(ErrorCodes.INVALID_ARGS, 'record finish requires --run-dir');
    recordFinish({ runId, runDir, status });
    console.log(json ? JSON.stringify({ status, finished: true }) : `Run ${runId} finished: ${status}`);
    process.exit(0);
  }
}
async function handleVerify(values: Record<string, unknown>, positionals: string[], json: boolean): Promise<void> {
  const flowPath = positionals[1];
  if (!flowPath) throw new FlowWalkerError(ErrorCodes.INVALID_ARGS, 'Flow YAML path is required');
  validateFlowPath(flowPath);
  const runDir = values['run-dir'] as string;
  if (!runDir) throw new FlowWalkerError(ErrorCodes.INVALID_ARGS, 'verify requires --run-dir');
  const mode = (values['mode'] as string || 'balanced') as 'strict' | 'balanced' | 'audit';
  if (!['strict', 'balanced', 'audit'].includes(mode)) throw new FlowWalkerError(ErrorCodes.INVALID_ARGS, `Invalid mode: ${mode}`);
  const parsed = parseFlowFile(flowPath);
  let flow: FlowV2;
  if ('version' in parsed && parsed.version === 2) flow = parsed as FlowV2;
  else throw new FlowWalkerError(ErrorCodes.FLOW_PARSE_ERROR, 'verify requires a v2 flow (version: 2)');
  const result = verifyRun({ flow, runDir, mode, eventsPath: values['events'] as string | undefined, outputPath: values['output'] as string | undefined });
  if (json) console.log(JSON.stringify(result));
  else { const icon = result.result === 'pass' ? '✓' : '✗'; console.log(`${icon} Verify "${result.flow}" [${result.mode}]: ${result.result.toUpperCase()}`); for (const issue of result.issues) console.log(`  - ${issue}`); }
  process.exit(result.result === 'pass' ? 0 : 1);
}
async function handleReport(values: Record<string, unknown>, positionals: string[], json: boolean): Promise<void> {
  const runDir = positionals[1];
  if (!runDir) throw new FlowWalkerError(ErrorCodes.INVALID_ARGS, 'Run directory is required');
  const runJsonPath = `${runDir}/run.json`;
  if (!existsSync(runJsonPath)) throw new FlowWalkerError(ErrorCodes.FILE_NOT_FOUND, `run.json not found in ${runDir}`);
  const data = JSON.parse(readFileSync(runJsonPath, 'utf-8')) as VerifyResult;
  const outputPath = generateReportV2(data, runDir, { output: values['output'] as string | undefined });
  console.log(json ? JSON.stringify({ report: outputPath }) : `Report generated: ${outputPath}`);
  process.exit(0);
}
async function handlePush(positionals: string[], json: boolean): Promise<void> {
  const runDir = positionals[1];
  if (!runDir) throw new FlowWalkerError(ErrorCodes.INVALID_ARGS, 'Run directory is required');
  const result = await pushReport(runDir, { apiUrl: process.env.FLOW_WALKER_API_URL });
  console.log(json ? JSON.stringify(result) : `Report uploaded. URL: ${result.htmlUrl}`);
  process.exit(0);
}
async function handleMigrate(values: Record<string, unknown>, positionals: string[], json: boolean): Promise<void> {
  const flowPath = positionals[1];
  if (!flowPath) throw new FlowWalkerError(ErrorCodes.INVALID_ARGS, 'Flow YAML path is required');
  validateFlowPath(flowPath);
  const parsed = parseFlowFile(flowPath);
  if ('version' in parsed && (parsed as FlowV2).version === 2) throw new FlowWalkerError(ErrorCodes.INVALID_ARGS, 'Flow is already v2');
  const v1 = parsed as import('./types.ts').Flow;
  const v2 = migrateFlowV1toV2(v1);
  const yaml = toYamlV2(v2);
  const outputPath = values['output'] as string | undefined;
  if (outputPath) { writeFileSync(outputPath, yaml); console.log(json ? JSON.stringify({ output: outputPath, name: v2.name, steps: v2.steps.length }) : `Migrated: ${outputPath}`); }
  else process.stdout.write(yaml);
  process.exit(0);
}
async function handleGet(positionals: string[], json: boolean): Promise<void> {
  const runId = positionals[1];
  if (!runId) throw new FlowWalkerError(ErrorCodes.INVALID_ARGS, 'Run ID is required');
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(runId)) throw new FlowWalkerError(ErrorCodes.INVALID_INPUT, 'Invalid run ID format');
  const data = await getRunData(runId, { apiUrl: process.env.FLOW_WALKER_API_URL });
  console.log(json ? JSON.stringify(data) : JSON.stringify(data, null, 2));
  process.exit(0);
}
function handleSchema(positionals: string[]): void {
  const name = positionals[1];
  if (name) { const schema = getCommandSchema(name); if (!schema) throw new FlowWalkerError(ErrorCodes.INVALID_ARGS, `Unknown command: ${name}`, `Available: ${COMMAND_SCHEMAS.map(s => s.name).join(', ')}`); console.log(JSON.stringify(schema, null, 2)); }
  else console.log(JSON.stringify(getSchemaEnvelope(), null, 2));
  process.exit(0);
}
main();
