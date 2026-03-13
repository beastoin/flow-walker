// Shared types for flow-walker

/** An interactive element from agent-flutter snapshot */
export interface SnapshotElement {
  ref: string;
  type: string;
  text: string;
  flutterType?: string;
  enabled?: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface ScreenSnapshot {
  elements: SnapshotElement[];
  raw?: string;
}

export interface ScreenNode {
  id: string;
  name: string;
  elementTypes: string[];
  elementCount: number;
  firstSeen: number;
  visits: number;
}

export interface ScreenEdge {
  source: string;
  target: string;
  element: { ref: string; type: string; text: string };
}

// ── v1 Flow Types ──

export interface FlowStep {
  name: string;
  press?: { type?: string; position?: string; hint?: string; bottom_nav_tab?: number; ref?: string; text?: string };
  scroll?: string;
  fill?: { type?: string; value: string; text?: string; focused?: boolean };
  back?: boolean;
  adb?: string;
  wait?: number;
  assert?: {
    interactive_count?: { min: number; verified?: string };
    bottom_nav_tabs?: { min: number };
    has_type?: { type: string; min?: number };
    text?: string;
    text_visible?: string[];
    text_not_visible?: string[];
  };
  screenshot?: string;
  note?: string;
}

export interface Flow {
  name: string;
  description: string;
  app?: string;
  appUrl?: string;
  covers?: string[];
  prerequisites?: string[];
  setup: string;
  steps: FlowStep[];
}

// ── v2 Flow Types ──

export type StepOutcome = 'pass' | 'fail' | 'skipped' | 'recovered';

export interface FlowV2Expect {
  id?: string;
  kind?: string;
  milestone?: string;
  outcome?: StepOutcome;
  min?: number;
  values?: string[];
}

export interface FlowV2Evidence { screenshot?: string; }

export interface FlowV2Step {
  id: string;
  name?: string;
  do: string;
  anchors?: string[];
  expect?: FlowV2Expect[];
  evidence?: FlowV2Evidence[];
  note?: string;
}

export interface FlowV2 {
  version: 2;
  name: string;
  description?: string;
  app?: string;
  appUrl?: string;
  covers?: string[];
  preconditions?: string[];
  defaults?: { timeout_ms?: number; retries?: number; vision?: string };
  steps: FlowV2Step[];
}

export interface StepHint { screen: string; refs: Record<string, string>; }
export interface FlowHints { version: 1; flow: string; steps: Record<string, StepHint>; }

/** Walker configuration */
export interface WalkerConfig {
  appUri?: string;
  bundleId?: string;
  maxDepth: number;
  outputDir: string;
  blocklist: string[];
  json: boolean;
  dryRun: boolean;
  agentFlutterPath: string;
  skipConnect: boolean;
}
