# flow-walker

Auto-discover app flows, execute YAML test flows, generate HTML reports.

flow-walker is the **flow layer** — it defines, discovers, executes, and reports on flows. It uses [agent-flutter](https://github.com/beastoin/agent-flutter) and [agent-swift](https://github.com/beastoin/agent-swift) as **transport layers** that control specific platforms.

```
flow-walker (flows: walk, run, report, schema)
    |
agent-flutter (Flutter apps on Android/iOS)
agent-swift   (native macOS/iOS apps)
    |
devices
```

## Quick start

```bash
npm install -g flow-walker-cli

# Explore app automatically
flow-walker walk --app-uri ws://127.0.0.1:38047/abc=/ws

# Execute a specific flow
flow-walker run flows/tab-navigation.yaml

# Generate HTML report
flow-walker report ./run-output/<run-id>/

# Discover commands (agent-first)
flow-walker schema
flow-walker schema run
```

## Prerequisites

- Node.js >= 22
- [agent-flutter](https://github.com/beastoin/agent-flutter) installed and in PATH
- Flutter app running with Marionette initialized
- ADB connected (Android) or Simulator running (iOS)

## Commands

### `walk` — Auto-explore

Discovers screens by pressing every interactive element, building a navigation graph, and generating YAML flow files.

```bash
flow-walker walk --app-uri ws://... --max-depth 3 --output-dir ./flows/
flow-walker walk --skip-connect --json    # NDJSON: one event per line
flow-walker walk --dry-run                # plan without pressing
```

### `run` — Execute flow

Runs a YAML flow step-by-step. Each run gets a **unique ID** (10-char base64url like `P-tnB_sgKA`). Output goes to `<output-dir>/<run-id>/` so multiple runs never overwrite each other.

```bash
flow-walker run flows/tab-navigation.yaml
# => Run ID: 25h7afGwBK
# => Output: ./run-output/25h7afGwBK/

flow-walker run flows/login.yaml --json   # machine-readable
flow-walker run flows/settings.yaml --dry-run  # parse + resolve without executing
```

Output per run:
- `run.json` — structured results with run ID, per-step status, timing, assertions
- `recording.mp4` — screen recording with step timestamps
- `step-N-*.png` — per-step screenshots
- `device.log` — filtered device logs

### `report` — Generate HTML viewer

Self-contained HTML with embedded video, screenshots, and clickable step timeline.

```bash
flow-walker report ./run-output/25h7afGwBK/
```

### `schema` — Agent discovery

Machine-readable command introspection. Returns versioned JSON with args, flags (with types), exit codes, and examples.

```bash
flow-walker schema           # all commands with version envelope
flow-walker schema run       # single command detail
```

Agents can discover capabilities programmatically — no --help parsing needed.

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

  - name: Verify developer settings has switches
    assert:
      has_type: { type: switch, min: 2 }

  - name: Return to home tab
    press: { bottom_nav_tab: 0 }
    screenshot: final
```

### Step actions

| Action | Syntax | Description |
|--------|--------|-------------|
| `press` | `{ type: button, position: rightmost }` | Press by type, position, ref, or bottom_nav_tab |
| `scroll` | `down` / `up` / `left` / `right` | Scroll the screen |
| `fill` | `{ type: textfield, value: "text" }` | Enter text into a field |
| `back` | `true` | Navigate back |
| `assert` | `{ interactive_count: { min: N } }` | Assert element counts, nav tabs, element types |
| `screenshot` | `name` | Capture screenshot with label |

### Assertions

| Assertion | Syntax | Description |
|-----------|--------|-------------|
| `interactive_count` | `{ min: 20 }` | Min total interactive elements on screen |
| `bottom_nav_tabs` | `{ min: 4 }` | Min bottom navigation tabs |
| `has_type` | `{ type: switch, min: 2 }` | Min elements of a specific type |

## Agent-friendly design

Built following [Poehnelt's CLI-for-agents principles](https://justin.poehnelt.com/posts/rewrite-your-cli-for-ai-agents/):

- **Schema introspection** — `flow-walker schema` returns versioned JSON with typed args/flags
- **Structured errors** — every error returns `{code, message, hint, diagnosticId}` in JSON
- **Input hardening** — path traversal, control chars, URI format all validated
- **TTY-aware JSON** — `--no-json` > `--json` > `FLOW_WALKER_JSON=1` > TTY auto-detect
- **Dry-run** — `--dry-run` parses and resolves targets without executing (includes resolve reasons)
- **NDJSON streaming** — walk emits `walk:start`, `screen`, `edge`, `skip` events as one JSON per line
- **Unique run IDs** — 10-char base64url per run, filesystem-safe, URL-safe
- **Environment variables** — `FLOW_WALKER_OUTPUT_DIR`, `FLOW_WALKER_AGENT_PATH`, `FLOW_WALKER_DRY_RUN`, `FLOW_WALKER_JSON`
- **Exit codes** — 0 = success, 1 = flow failure, 2 = error

## Architecture

```
flow-walker CLI (flow layer)
  | shells out to
agent-flutter CLI / agent-swift CLI (transport layer)
  | connects via
VM Service + Marionette / XCTest (platform-specific)
  | controls
App on device/emulator/desktop
```

**Design principles:**
1. **Pluggable transport** — same YAML flows, different backends
2. **Fingerprint by structure** — screen identity uses element types/counts, not text
3. **Safety first** — blocklist prevents pressing destructive elements
4. **Self-contained output** — HTML reports embed everything as base64
5. **YAML as contract** — flows are portable, readable, version-controllable

## Phase history

| Phase | Focus | Status |
|-------|-------|--------|
| 1 | walk: BFS explorer, fingerprinting, safety, YAML generation | Complete |
| 2 | run + report: flow executor, video/screenshots, HTML viewer | Complete |
| 3 | Agent-grade: structured errors, schema, input hardening, run IDs | Complete |

## License

MIT
