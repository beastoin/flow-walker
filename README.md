# flow-walker

Auto-discover app flows, execute YAML test flows, generate HTML reports.

flow-walker is the **flow layer** — it defines, discovers, executes, and reports on flows. It is **not** a replacement for [agent-flutter](https://github.com/beastoin/agent-flutter) or [agent-swift](https://github.com/beastoin/agent-swift). Those are **transport layers** that control specific platforms. flow-walker uses them as pluggable backends.

```
flow-walker (flows: walk, run, report)
    ↓ pluggable transport
agent-flutter (Flutter apps on Android/iOS)
agent-swift   (native macOS/iOS apps — planned)
    ↓
devices
```

## What it does

```
flow-walker walk    →  BFS-explores your app, discovers screens, generates YAML flows
flow-walker run     →  Executes a YAML flow, produces run.json + video + screenshots
flow-walker report  →  Generates self-contained HTML report with embedded video timeline
```

**No test scripts to write.** Point flow-walker at a running app and it discovers the navigation graph automatically. The same YAML flows work across transports — only the backend changes.

## Quick start

```bash
npm install -g flow-walker-cli

# Explore app automatically
flow-walker walk --app-uri ws://127.0.0.1:38047/abc=/ws

# Execute a specific flow
flow-walker run flows/tab-navigation.yaml --output-dir ./results/

# Generate HTML report
flow-walker report ./results/
```

## Prerequisites

- Node.js ≥ 22
- [agent-flutter](https://github.com/beastoin/agent-flutter) installed and in PATH
- Flutter app running via `flutter run` with Marionette initialized
- ADB connected (Android) or Simulator running (iOS)

## Commands

### `walk` — Auto-explore

Discovers screens by pressing every interactive element, building a navigation graph, and generating YAML flow files.

```bash
flow-walker walk --app-uri ws://... --max-depth 3 --output-dir ./flows/
```

Options:
- `--app-uri <uri>` — VM Service WebSocket URI
- `--bundle-id <id>` — Connect by bundle ID
- `--max-depth <n>` — Max navigation depth (default: 5)
- `--output-dir <dir>` — Output directory (default: ./flows/)
- `--blocklist <words>` — Comma-separated destructive keywords to avoid
- `--dry-run` — Snapshot and plan without pressing
- `--skip-connect` — Use existing agent-flutter session
- `--json` — Machine-readable output

### `run` — Execute flow

Runs a YAML flow file step-by-step via agent-flutter, producing structured results.

```bash
flow-walker run tab-navigation.yaml --output-dir ./run-output/
```

Options:
- `--output-dir <dir>` — Output directory (default: ./run-output/)
- `--no-video` — Skip video recording
- `--no-logs` — Skip logcat capture
- `--json` — Machine-readable output

Output:
- `run.json` — Structured results (per-step status, timing, element counts, assertions)
- `recording.mp4` — Screen recording with step timestamps
- `step-N-*.png` — Per-step screenshots
- `device.log` — Filtered device logs

### `report` — Generate HTML viewer

Produces a self-contained HTML file with embedded video, screenshots, and clickable step timeline.

```bash
flow-walker report ./run-output/
```

Options:
- `--output <path>` — Output HTML path (default: `<run-dir>/report.html`)
- `--no-video` — Exclude video from report

Features:
- Click any step to seek video to that moment
- Keyboard shortcuts: 1-9 jump to step, Space play/pause
- Pass/fail indicators with assertion details
- Responsive layout (desktop + mobile)
- Zero external dependencies (fully self-contained)

## YAML flow format

```yaml
name: tab-navigation
description: Bottom nav bar detection, switch between 4 tabs
covers:
  - app/lib/pages/home/page.dart
prerequisites:
  - auth_ready
setup: normal

steps:
  - name: Verify home tab and nav bar
    assert:
      interactive_count: { min: 20 }
      bottom_nav_tabs: { min: 4 }
    screenshot: tab-home

  - name: Switch to tab 2
    press: { bottom_nav_tab: 1 }
    screenshot: tab-2

  - name: Scroll in current tab
    scroll: down

  - name: Return to home tab
    press: { bottom_nav_tab: 0 }
    assert:
      interactive_count: { min: 20 }
    screenshot: final
```

### Step actions

| Action | Syntax | Description |
|--------|--------|-------------|
| `press` | `{ type: button, position: rightmost }` | Press element by type, position, ref, or bottom_nav_tab index |
| `scroll` | `down` / `up` / `left` / `right` | Scroll the screen |
| `fill` | `{ type: textfield, value: "text" }` | Enter text into a field |
| `back` | `true` | Navigate back |
| `assert` | `{ interactive_count: { min: N } }` | Assert element counts |
| `screenshot` | `name` | Capture screenshot with label |

## How it works

```
flow-walker CLI (flow layer)
  ↓ shells out to
agent-flutter CLI / agent-swift CLI (transport layer)
  ↓ connects via
VM Service + Marionette / XCTest (platform-specific)
  ↓ controls
App on device/emulator/desktop
```

**Current transport:** agent-flutter (Flutter apps on Android/iOS)
**Planned:** agent-swift (Omi desktop app on macOS)

**Design principles:**
1. **Pluggable transport** — flow-walker is the flow layer, agent-flutter/agent-swift are transports. Same YAML flows, different backends
2. **Fingerprint by structure** — screen identity uses element types/counts, not text
3. **Safety first** — blocklist prevents pressing destructive elements
4. **Self-contained output** — HTML reports embed everything as base64
5. **YAML as contract** — flows are portable, readable, version-controllable across platforms

## Phase roadmap

Following the [agent-flutter](https://github.com/beastoin/agent-flutter) phase model:

| Phase | Focus | Status |
|-------|-------|--------|
| 1 Core | walk: BFS explorer, fingerprinting, YAML generation | ✓ Complete |
| 2 Execution | run + report: flow executor, video/screenshots, HTML viewer | ✓ Complete |
| 3 Interaction | scroll-reveal in walker, fill exploration, iOS support | Next |
| 4 Agent-grade | --json everywhere, structured errors, schema, AGENTS.md, CI mode | Planned |

## License

MIT
