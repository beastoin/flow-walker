// Flow executor: runs YAML flows via agent-flutter

import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import type { Flow, FlowStep, SnapshotElement } from './types.ts';
import { AgentBridge } from './agent-bridge.ts';
import type { RunResult, StepResult } from './run-schema.ts';
import { screenshot as captureScreenshot, startRecording, stopRecording, startLogcat, stopLogcat, getDeviceName, ensureDir } from './capture.ts';

export interface RunOptions {
  outputDir: string;
  noVideo?: boolean;
  noLogs?: boolean;
  json?: boolean;
  agentFlutterPath?: string;
}

/** Execute a flow and produce a RunResult */
export async function runFlow(flow: Flow, options: RunOptions): Promise<RunResult> {
  const bridge = new AgentBridge(options.agentFlutterPath ?? 'agent-flutter');
  ensureDir(options.outputDir);

  const device = getDeviceName();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const steps: StepResult[] = [];

  // Start video recording
  let videoHandle: ReturnType<typeof startRecording> | null = null;
  if (!options.noVideo) {
    try {
      videoHandle = startRecording();
    } catch { /* warn but continue */ }
  }

  // Start logcat
  let logHandle: ReturnType<typeof startLogcat> | null = null;
  if (!options.noLogs) {
    try {
      logHandle = startLogcat();
    } catch { /* warn but continue */ }
  }

  // Execute each step
  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i];
    const stepStart = Date.now();
    const timestamp = stepStart - t0;

    try {
      const result = await executeStep(step, bridge, options.outputDir, i + 1);
      steps.push({
        ...result,
        index: i,
        timestamp,
        duration: Date.now() - stepStart,
      });
    } catch (err) {
      // Step failed — mark and continue
      const snapshot = await safeSnapshot(bridge);
      steps.push({
        index: i,
        name: step.name,
        action: getStepAction(step),
        status: 'fail',
        timestamp,
        duration: Date.now() - stepStart,
        elementCount: snapshot.length,
        error: String(err),
      });
    }

    if (!options.json) {
      const s = steps[steps.length - 1];
      const icon = s.status === 'pass' ? '✓' : s.status === 'fail' ? '✗' : '○';
      console.log(`  ${icon} Step ${i + 1}: ${s.name} [${s.status}] (${s.duration}ms, ${s.elementCount} elements)`);
    }
  }

  const duration = Date.now() - t0;

  // Stop video
  let videoPath: string | undefined;
  if (videoHandle) {
    const localVideo = join(options.outputDir, 'recording.mp4');
    if (stopRecording(videoHandle, localVideo)) {
      videoPath = 'recording.mp4';
    }
  }

  // Stop logcat
  let logPath: string | undefined;
  if (logHandle) {
    const logLines = stopLogcat(logHandle);
    if (logLines.length > 0) {
      const localLog = join(options.outputDir, 'device.log');
      writeFileSync(localLog, logLines.join('\n'));
      logPath = 'device.log';
    }
  }

  const overallResult = steps.every(s => s.status !== 'fail') ? 'pass' as const : 'fail' as const;

  const runResult: RunResult = {
    flow: flow.name,
    device,
    startedAt,
    duration,
    result: overallResult,
    steps,
    video: videoPath,
    log: logPath,
  };

  // Write run.json
  const runJsonPath = join(options.outputDir, 'run.json');
  writeFileSync(runJsonPath, JSON.stringify(runResult, null, 2));

  return runResult;
}

/** Execute a single step */
async function executeStep(
  step: FlowStep,
  bridge: AgentBridge,
  outputDir: string,
  stepNum: number,
): Promise<StepResult> {
  const action = getStepAction(step);
  let elements = await safeSnapshot(bridge);

  // Execute the action
  if (step.press) {
    const target = resolvePress(step.press, elements);
    if (target) {
      await bridge.press(target.ref);
      await delay(1500); // wait for transition
      elements = await safeSnapshot(bridge);
    } else {
      return {
        index: 0, // filled by caller
        name: step.name,
        action,
        status: 'fail',
        timestamp: 0,
        duration: 0,
        elementCount: elements.length,
        error: `Could not resolve press target: ${JSON.stringify(step.press)}`,
      };
    }
  } else if (step.scroll) {
    await bridge.scroll(step.scroll);
    await delay(1000);
    elements = await safeSnapshot(bridge);
  } else if (step.fill) {
    const target = resolveFill(step.fill, elements);
    if (target) {
      await bridge.fill(target.ref, step.fill.value);
      await delay(500);
      elements = await safeSnapshot(bridge);
    } else {
      return {
        index: 0, // filled by caller
        name: step.name,
        action,
        status: 'fail',
        timestamp: 0,
        duration: 0,
        elementCount: elements.length,
        error: `Could not resolve fill target: ${JSON.stringify(step.fill)}`,
      };
    }
  } else if (step.back) {
    await bridge.back();
    await delay(1500);
    elements = await safeSnapshot(bridge);
  }

  // Take screenshot
  let screenshotPath: string | undefined;
  if (step.screenshot) {
    const filename = `step-${stepNum}-${step.screenshot}.png`;
    const fullPath = join(outputDir, filename);
    if (captureScreenshot(fullPath)) {
      screenshotPath = filename;
    }
  }

  // Check assertions
  let status: 'pass' | 'fail' = 'pass';
  let assertion: StepResult['assertion'];

  if (step.assert) {
    assertion = {};
    if (step.assert.interactive_count) {
      const actual = elements.length;
      const min = step.assert.interactive_count.min;
      assertion.interactive_count = { min, actual };
      if (actual < min) status = 'fail';
    }
    if (step.assert.bottom_nav_tabs) {
      const navTabs = elements.filter(e =>
        e.flutterType === 'InkWell' && e.bounds && e.bounds.y > 780
      );
      const actual = navTabs.length;
      const min = step.assert.bottom_nav_tabs.min;
      assertion.bottom_nav_tabs = { min, actual };
      if (actual < min) status = 'fail';
    }
    if (step.assert.has_type) {
      const searchType = step.assert.has_type.type.toLowerCase();
      const matching = elements.filter(e =>
        e.type === searchType || e.flutterType?.toLowerCase().includes(searchType)
      );
      const actual = matching.length;
      const min = step.assert.has_type.min ?? 1;
      assertion.has_type = { type: step.assert.has_type.type, min, actual };
      if (actual < min) status = 'fail';
    }
  }

  return {
    index: 0, // filled by caller
    name: step.name,
    action,
    status,
    timestamp: 0, // filled by caller
    duration: 0,  // filled by caller
    elementCount: elements.length,
    screenshot: screenshotPath,
    assertion,
  };
}

/** Resolve a press target from the snapshot */
export function resolvePress(
  press: NonNullable<FlowStep['press']>,
  elements: SnapshotElement[],
): SnapshotElement | null {
  if (press.ref) {
    return elements.find(e => e.ref === press.ref) ?? null;
  }

  if (press.bottom_nav_tab !== undefined) {
    const navItems = elements
      .filter(e => e.flutterType === 'InkWell' && e.bounds && e.bounds.y > 780)
      .sort((a, b) => (a.bounds?.x ?? 0) - (b.bounds?.x ?? 0));
    return navItems[press.bottom_nav_tab] ?? null;
  }

  if (press.type) {
    const typeMatches = elements.filter(e =>
      e.type === press.type || e.flutterType?.toLowerCase().includes(press.type!.toLowerCase())
    );

    if (press.position === 'rightmost') {
      return typeMatches.sort((a, b) => (b.bounds?.x ?? 0) - (a.bounds?.x ?? 0))[0] ?? null;
    }
    if (press.position === 'leftmost') {
      return typeMatches.sort((a, b) => (a.bounds?.x ?? 0) - (b.bounds?.x ?? 0))[0] ?? null;
    }

    return typeMatches[0] ?? null;
  }

  return null;
}

/** Resolve a fill target from the snapshot */
export function resolveFill(
  fill: NonNullable<FlowStep['fill']>,
  elements: SnapshotElement[],
): SnapshotElement | null {
  if (fill.type) {
    return elements.find(e =>
      e.type === fill.type || e.type === 'textfield' || e.flutterType === 'TextField'
    ) ?? null;
  }
  return elements.find(e => e.type === 'textfield' || e.flutterType === 'TextField') ?? null;
}

export function getStepAction(step: FlowStep): string {
  if (step.press) return 'press';
  if (step.scroll) return 'scroll';
  if (step.fill) return 'fill';
  if (step.back) return 'back';
  if (step.assert) return 'assert';
  if (step.screenshot) return 'screenshot';
  return 'unknown';
}

/** Dry-run: parse flow and resolve step targets without executing */
export async function dryRunFlow(flow: Flow, agentFlutterPath: string = 'agent-flutter'): Promise<{
  flow: string;
  steps: { index: number; name: string; action: string; target: unknown; resolved: boolean; reason?: string }[];
  dryRun: true;
}> {
  const bridge = new AgentBridge(agentFlutterPath);
  let elements: SnapshotElement[] = [];
  try {
    elements = await safeSnapshot(bridge);
  } catch { /* no device = empty snapshot */ }

  const hasDevice = elements.length > 0;

  const steps = flow.steps.map((step, i) => {
    const action = getStepAction(step);
    let target: unknown = null;
    let resolved = true;
    let reason: string | undefined;

    if (step.press) {
      const el = resolvePress(step.press, elements);
      target = el ? { ref: el.ref, type: el.type, text: el.text } : step.press;
      resolved = el !== null;
      if (!resolved) reason = hasDevice ? 'element not found in current snapshot' : 'no device connected for snapshot';
    } else if (step.fill) {
      const el = resolveFill(step.fill, elements);
      target = el ? { ref: el.ref, type: el.type } : step.fill;
      resolved = el !== null;
      if (!resolved) reason = hasDevice ? 'textfield not found in current snapshot' : 'no device connected for snapshot';
    } else if (step.scroll) {
      target = { direction: step.scroll };
    } else if (step.back) {
      target = { back: true };
    } else if (step.assert) {
      target = step.assert;
      // Assertions always "resolve" — they check conditions at runtime
    }

    return { index: i, name: step.name, action, target, resolved, ...(reason ? { reason } : {}) };
  });

  return { flow: flow.name, steps, dryRun: true };
}

async function safeSnapshot(bridge: AgentBridge): Promise<SnapshotElement[]> {
  try {
    const snapshot = await bridge.snapshot();
    return snapshot.elements;
  } catch {
    return [];
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
