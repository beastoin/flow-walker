#!/usr/bin/env node --experimental-strip-types
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import type { WalkerConfig } from './types.ts';
import { walk } from './walker.ts';
import { parseFlowFile } from './flow-parser.ts';
import { runFlow, type RunOptions } from './runner.ts';
import { generateReport, type ReportOptions } from './reporter.ts';
import { validateRunResult, type RunResult } from './run-schema.ts';

const DEFAULT_BLOCKLIST = 'delete,sign out,remove,reset,unpair,logout,clear all';

function printUsage(): void {
  console.log(`flow-walker — Automatic app flow extraction & execution via agent-flutter

Usage:
  flow-walker walk [options]        Auto-explore app and generate YAML flows
  flow-walker run <flow.yaml>       Execute a YAML flow and produce run.json
  flow-walker report <run-dir>      Generate HTML report from run results

Walk options:
  --app-uri <uri>         VM Service URI (ws://...)
  --bundle-id <id>        Connect by bundle ID
  --max-depth <n>         Max navigation depth (default: 5)
  --output-dir <dir>      Output directory for YAML flows (default: ./flows/)
  --blocklist <words>     Comma-separated blocklist keywords
  --agent-flutter-path    Path to agent-flutter binary (default: agent-flutter)
  --json                  Machine-readable progress output
  --dry-run               Snapshot and plan without pressing
  --skip-connect          Use existing agent-flutter session (don't reconnect)

Run options:
  --output-dir <dir>      Output directory for run results (default: ./run-output/)
  --no-video              Skip video recording
  --no-logs               Skip logcat capture
  --agent-flutter-path    Path to agent-flutter binary (default: agent-flutter)
  --json                  Machine-readable output

Report options:
  --output <path>         Output HTML file path (default: <run-dir>/report.html)
  --no-video              Exclude video from report

Common:
  --help                  Show this help
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
      'agent-flutter-path': { type: 'string', default: 'agent-flutter' },
      'json': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'skip-connect': { type: 'boolean', default: false },
      'no-video': { type: 'boolean', default: false },
      'no-logs': { type: 'boolean', default: false },
      'help': { type: 'boolean', default: false },
    },
  });

  const subcommand = positionals[0];

  if (values.help || !subcommand) {
    printUsage();
    process.exit(subcommand ? 0 : 1);
  }

  if (subcommand === 'walk') {
    await handleWalk(values, positionals);
  } else if (subcommand === 'run') {
    await handleRun(values, positionals);
  } else if (subcommand === 'report') {
    await handleReport(values, positionals);
  } else {
    console.error(`Unknown subcommand: ${subcommand}`);
    printUsage();
    process.exit(1);
  }
}

async function handleWalk(values: Record<string, unknown>, _positionals: string[]): Promise<void> {
  if (!values['app-uri'] && !values['bundle-id'] && !values['skip-connect']) {
    console.error('Error: either --app-uri, --bundle-id, or --skip-connect is required');
    process.exit(2);
  }

  const config: WalkerConfig = {
    appUri: values['app-uri'] as string | undefined,
    bundleId: values['bundle-id'] as string | undefined,
    maxDepth: parseInt(values['max-depth'] as string, 10),
    outputDir: (values['output-dir'] as string) ?? './flows/',
    blocklist: (values['blocklist'] as string).split(',').map(s => s.trim()),
    json: values['json'] as boolean,
    dryRun: values['dry-run'] as boolean,
    skipConnect: values['skip-connect'] as boolean,
    agentFlutterPath: values['agent-flutter-path'] as string,
  };

  try {
    const result = await walk(config);

    if (config.json) {
      console.log(JSON.stringify({ type: 'result', ...result }));
    } else {
      console.log(`\nDone. ${result.screensFound} screens, ${result.flowsGenerated} flows, ${result.elementsSkipped} skipped.`);
    }

    process.exit(0);
  } catch (err) {
    if (config.json) {
      console.log(JSON.stringify({ type: 'error', message: String(err) }));
    } else {
      console.error(`Error: ${err}`);
    }
    process.exit(2);
  }
}

async function handleRun(values: Record<string, unknown>, positionals: string[]): Promise<void> {
  const flowPath = positionals[1];
  if (!flowPath) {
    console.error('Error: flow YAML path is required. Usage: flow-walker run <flow.yaml>');
    process.exit(2);
  }

  const flow = parseFlowFile(flowPath);
  const outputDir = (values['output-dir'] as string) ?? './run-output/';

  const options: RunOptions = {
    outputDir,
    noVideo: values['no-video'] as boolean,
    noLogs: values['no-logs'] as boolean,
    json: values['json'] as boolean,
    agentFlutterPath: values['agent-flutter-path'] as string,
  };

  if (!values['json']) {
    console.log(`Running flow: ${flow.name} (${flow.steps.length} steps)`);
  }

  try {
    const result = await runFlow(flow, options);

    if (values['json']) {
      console.log(JSON.stringify(result));
    } else {
      const icon = result.result === 'pass' ? '✓' : '✗';
      console.log(`\n${icon} Flow "${result.flow}" ${result.result.toUpperCase()} (${(result.duration / 1000).toFixed(1)}s)`);
      console.log(`  Output: ${outputDir}`);
    }

    process.exit(result.result === 'pass' ? 0 : 1);
  } catch (err) {
    if (values['json']) {
      console.log(JSON.stringify({ type: 'error', message: String(err) }));
    } else {
      console.error(`Error: ${err}`);
    }
    process.exit(2);
  }
}

async function handleReport(values: Record<string, unknown>, positionals: string[]): Promise<void> {
  const runDir = positionals[1];
  if (!runDir) {
    console.error('Error: run directory is required. Usage: flow-walker report <run-dir>');
    process.exit(2);
  }

  // Load run.json
  let runResult: RunResult;
  try {
    const runJsonPath = `${runDir}/run.json`;
    const raw = readFileSync(runJsonPath, 'utf-8');
    const data = JSON.parse(raw);
    if (!validateRunResult(data)) {
      console.error('Error: invalid run.json format');
      process.exit(2);
    }
    runResult = data;
  } catch (err) {
    console.error(`Error reading run.json from ${runDir}: ${err}`);
    process.exit(2);
  }

  const reportOptions: ReportOptions = {
    noVideo: values['no-video'] as boolean,
    output: values['output'] as string | undefined,
  };

  const outputPath = generateReport(runResult, runDir, reportOptions);
  console.log(`Report generated: ${outputPath}`);
  process.exit(0);
}

main();
