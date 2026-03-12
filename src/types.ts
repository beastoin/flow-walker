// Shared types for flow-walker

/** An interactive element from agent-flutter snapshot */
export interface SnapshotElement {
  ref: string;          // e.g. "@e1"
  type: string;         // e.g. "button", "textfield", "gesture"
  text: string;         // label/text content
  flutterType?: string; // e.g. "ElevatedButton", "InkWell"
  enabled?: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
}

/** A snapshot of a screen's interactive elements */
export interface ScreenSnapshot {
  elements: SnapshotElement[];
  raw?: string; // raw agent-flutter output
}

/** A node in the navigation graph */
export interface ScreenNode {
  id: string;           // fingerprint hash
  name: string;         // human-readable name derived from elements
  elementTypes: string[]; // sorted type list used for fingerprint
  elementCount: number;
  firstSeen: number;    // timestamp
  visits: number;
}

/** An edge in the navigation graph */
export interface ScreenEdge {
  source: string;       // source screen fingerprint
  target: string;       // target screen fingerprint
  element: {
    ref: string;
    type: string;
    text: string;
  };
}

/** A step in a YAML flow */
export interface FlowStep {
  name: string;
  press?: { type?: string; position?: string; hint?: string; bottom_nav_tab?: number; ref?: string };
  scroll?: string;
  fill?: { type?: string; value: string };
  back?: boolean;
  assert?: {
    interactive_count?: { min: number; verified?: string };
    bottom_nav_tabs?: { min: number };
    has_type?: { type: string; min?: number };
    text?: string;
  };
  screenshot?: string;
  note?: string;
}

/** A complete YAML flow */
export interface Flow {
  name: string;
  description: string;
  covers?: string[];
  prerequisites?: string[];
  setup: string;
  steps: FlowStep[];
}

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
