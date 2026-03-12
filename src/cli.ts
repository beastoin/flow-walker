#!/usr/bin/env node --experimental-strip-types
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import type { WalkerConfig } from './types.ts';
import { walk } from './walker.ts';
import { parseFlowFile } from './flow-parser.ts';
import { runFlow, dryRunFlow, type RunOptions } from './runner.ts';
import { generateReport, type ReportOptions } from './reporter.ts';
import { validateRunResult, type RunResult } from './run-schema.ts';
import { FlowWalkerError, ErrorCodes, formatError } from './errors.ts';
import { validateFlowPath, validateOutputDir, validateUri, validateBundleId, validateRunDir } from './validate.ts';
import { COMMAND_SCHEMAS, getCommandSchema, getSchemaEnvelope } from './command-schema.ts';

const DEFAULT_BLOCKLIST = 'delete,sign out,remove,reset,unpair,logout,clear all';

/** Resolve JSON output mode: --no-json > --json > env > TTY detection */
function resolveJsonMode(flags: Record<string, unknown>): boolean {
  if (flags['no-json']) return false;
  if (flags['json']) return true;
  if (process.env.FLOW_WALKER_JSON === '1') return true;
  if (!process.stdout.isTTY) return true;
  return false;
}

function printUsage(): void {
  console.log(`flow-walker — Auto-discover app flows, execute YAML test flows, generate HTML reports

Usage:
  flow-walker walk [options]        Auto-explore app and generate YAML flows
  flow-walker run <flow.yaml>       Execute a YAML flow and produce run.json
  flow-walker report <run-dir>      Generate HTML report from run results
  flow-walker schema [command]      Show command schema for agent discovery

Run: flow-walker schema for machine-readable command descriptions.
`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'app-uri': { type: 'string' },
      'bundle-id': { type: 'string' },
      'max-depth': { type: 'string', default: '5' },
      'output-dir': { type: 'string' },
      'output': { type: 'string' },
      'blocklist': { type: 'string', default: DEFAULT_BLOCKLIST },
      'agent-flutter-path': { type: 'string' },
      'json': { type: 'boolean', default: false },
      'no-json': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'skip-connect': { type: 'boolean', default: false },
      'no-video': { type: 'boolean', default: false },
      'no-logs': { type: 'boolean', default: false },
      'help': { type: 'boolean', default: false },
    },
  });

  const subcommand = positionals[0];
  const json = resolveJsonMode(values);

  // Env var overrides
  const agentPath = (values['agent-flutter-path'] as string | undefined)
    ?? process.env.FLOW_WALKER_AGENT_PATH
    ?? 'agent-flutter';
  const dryRun = (values['dry-run'] as boolean) || process.env.FLOW_WALKER_DRY_RUN === '1';

  if (values.help || !subcommand) {
    if (json && subcommand) {
      // --help --json → schema for that command
      const schema = getCommandSchema(subcommand);
      if (schema) {
        console.log(JSON.stringify(schema));
        process.exit(0);
      }
    }
    printUsage();
    process.exit(subcommand ? 0 : 1);
  }

  try {
    if (subcommand === 'walk') {
      await handleWalk(values, positionals, json, agentPath, dryRun);
    } else if (subcommand === 'run') {
      await handleRun(values, positionals, json, agentPath, dryRun);
    } else if (subcommand === 'report') {
      await handleReport(values, positionals, json);
    } else if (subcommand === 'schema') {
      handleSchema(positionals);
    } else {
      throw new FlowWalkerError(
        ErrorCodes.INVALID_ARGS,
        `Unknown subcommand: ${subcommand}`,
        'Available: walk, run, report, schema. Run: flow-walker schema',
      );
    }
  } catch (err) {
    console.error(formatError(err, json));
    process.exit(2);
  }
}

async function handleWalk(
  values: Record<string, unknown>,
  _positionals: string[],
  json: boolean,
  agentPath: string,
  dryRun: boolean,
): Promise<void> {
  // Validate inputs
  if (values['app-uri']) validateUri(values['app-uri'] as string);
  if (values['bundle-id']) validateBundleId(values['bundle-id'] as string);

  if (!values['app-uri'] && !values['bundle-id'] && !values['skip-connect']) {
    throw new FlowWalkerError(
      ErrorCodes.INVALID_ARGS,
      'Either --app-uri, --bundle-id, or --skip-connect is required',
      'Run: flow-walker schema walk',
    );
  }

  const outputDir = (values['output-dir'] as string | undefined)
    ?? process.env.FLOW_WALKER_OUTPUT_DIR
    ?? './flows/';
  validateOutputDir(outputDir);

  const config: WalkerConfig = {
    appUri: values['app-uri'] as string | undefined,
    bundleId: values['bundle-id'] as string | undefined,
    maxDepth: parseInt(values['max-depth'] as string, 10),
    outputDir,
    blocklist: (values['blocklist'] as string).split(',').map(s => s.trim()),
    json,
    dryRun,
    agentFlutterPath: agentPath,
    skipConnect: values['skip-connect'] as boolean,
  };

  const result = await walk(config);

  if (json) {
    console.log(JSON.stringify({ type: 'result', ...result }));
  } else {
    console.log(`\nDone. ${result.screensFound} screens, ${result.flowsGenerated} flows, ${result.elementsSkipped} skipped.`);
  }

  process.exit(0);
}

async function handleRun(
  values: Record<string, unknown>,
  positionals: string[],
  json: boolean,
  agentPath: string,
  dryRun: boolean,
): Promise<void> {
  const flowPath = positionals[1];
  if (!flowPath) {
    throw new FlowWalkerError(
      ErrorCodes.INVALID_ARGS,
      'Flow YAML path is required',
      'Usage: flow-walker run <flow.yaml>. Run: flow-walker schema run',
    );
  }

  validateFlowPath(flowPath);

  const outputDir = (values['output-dir'] as string | undefined)
    ?? process.env.FLOW_WALKER_OUTPUT_DIR
    ?? './run-output/';
  validateOutputDir(outputDir);

  const flow = parseFlowFile(flowPath);

  // Dry-run mode: parse and resolve without executing
  if (dryRun) {
    const dryResult = await dryRunFlow(flow, agentPath);
    console.log(JSON.stringify(dryResult, null, json ? undefined : 2));
    process.exit(0);
  }

  const options: RunOptions = {
    outputDir,
    noVideo: values['no-video'] as boolean,
    noLogs: values['no-logs'] as boolean,
    json,
    agentFlutterPath: agentPath,
  };

  if (!json) {
    console.log(`Running flow: ${flow.name} (${flow.steps.length} steps)`);
  }

  const result = await runFlow(flow, options);

  if (json) {
    console.log(JSON.stringify(result));
  } else {
    const icon = result.result === 'pass' ? '✓' : '✗';
    console.log(`\n${icon} Flow "${result.flow}" ${result.result.toUpperCase()} (${(result.duration / 1000).toFixed(1)}s)`);
    console.log(`  Run ID: ${result.id}`);
    console.log(`  Output: ${outputDir}/${result.id}/`);
  }

  process.exit(result.result === 'pass' ? 0 : 1);
}

async function handleReport(
  values: Record<string, unknown>,
  positionals: string[],
  json: boolean,
): Promise<void> {
  const runDir = positionals[1];
  if (!runDir) {
    throw new FlowWalkerError(
      ErrorCodes.INVALID_ARGS,
      'Run directory is required',
      'Usage: flow-walker report <run-dir>. Run: flow-walker schema report',
    );
  }

  validateRunDir(runDir);

  const raw = readFileSync(`${runDir}/run.json`, 'utf-8');
  const data = JSON.parse(raw);
  if (!validateRunResult(data)) {
    throw new FlowWalkerError(
      ErrorCodes.FLOW_PARSE_ERROR,
      'Invalid run.json format',
      'Ensure run.json was produced by flow-walker run',
    );
  }
  const runResult: RunResult = data;

  const reportOptions: ReportOptions = {
    noVideo: values['no-video'] as boolean,
    output: values['output'] as string | undefined,
  };

  const outputPath = generateReport(runResult, runDir, reportOptions);

  if (json) {
    console.log(JSON.stringify({ report: outputPath }));
  } else {
    console.log(`Report generated: ${outputPath}`);
  }

  process.exit(0);
}

function handleSchema(positionals: string[]): void {
  const commandName = positionals[1];
  if (commandName) {
    const schema = getCommandSchema(commandName);
    if (!schema) {
      throw new FlowWalkerError(
        ErrorCodes.INVALID_ARGS,
        `Unknown command: ${commandName}`,
        `Available: ${COMMAND_SCHEMAS.map(s => s.name).join(', ')}`,
      );
    }
    console.log(JSON.stringify(schema, null, 2));
  } else {
    console.log(JSON.stringify(getSchemaEnvelope(), null, 2));
  }
  process.exit(0);
}

main();
