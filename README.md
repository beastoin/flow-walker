# flow-walker

Auto-discover app flows, record agent execution, verify against expectations, generate HTML reports.

flow-walker is the **flow layer** — it defines, discovers, records, verifies, and reports on flows. It uses [agent-flutter](https://github.com/beastoin/agent-flutter) and [agent-swift](https://github.com/beastoin/agent-swift) as **transport layers** that control specific platforms.

```
flow-walker (flows: walk, record, verify, report, push, migrate, schema)
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

# Record agent execution against a flow
flow-walker record init --flow flows/tab-navigation.yaml
flow-walker record stream --run-id <id> --run-dir <dir> --events '{"type":"step.start","step_id":"S1"}'
flow-walker record finish --run-id <id> --run-dir <dir>

# Verify recorded events against flow expectations
flow-walker verify --flow flows/tab-navigation.yaml --run-dir <dir> --mode balanced

# Generate HTML report
flow-walker report <dir>

# Share report (hosted)
flow-walker push ./run-output/<run-id>/

# Retrieve run data
flow-walker get 25h7afGwBK

# Migrate v1 flows to v2 agent-first format
flow-walker migrate flows/old-flow.yaml

# Discover commands (agent-first)
flow-walker schema
flow-walker schema verify

# Version
flow-walker --version
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
flow-walker walk --scaffold               # generate v2 flow template
```

### `record` — Event recording pipeline

Three-phase recording for agent execution. The agent streams events as it executes a flow.

```bash
# Phase 1: Initialize run directory
flow-walker record init --flow flows/tab-navigation.yaml --output-dir ./runs/

# Phase 2: Stream events (call multiple times)
flow-walker record stream --run-id <id> --run-dir <dir> \
  --events '{"type":"step.start","step_id":"S1"}'

# Phase 3: Finish recording
flow-walker record finish --run-id <id> --run-dir <dir> --status pass
```

### `verify` — Check events against flow

Three verification modes for different strictness levels:

```bash
flow-walker verify --flow flows/tab-navigation.yaml --run-dir <dir> --mode strict
flow-walker verify --flow flows/tab-navigation.yaml --run-dir <dir> --mode balanced  # default
flow-walker verify --flow flows/tab-navigation.yaml --run-dir <dir> --mode audit
```

| Mode | Behavior |
|------|----------|
| `strict` | All expects must pass, correct order, no unknown steps, no skipped |
| `balanced` | Skipped and recovered steps OK, only fails on explicit failures |
| `audit` | Always passes — for logging/observability only |

### `run` — Execute flow (v1 legacy)

Runs a v1 YAML flow step-by-step. Each run gets a **unique ID** (10-char base64url like `P-tnB_sgKA`). Output goes to `<output-dir>/<run-id>/` so multiple runs never overwrite each other.

```bash
flow-walker run flows/tab-navigation.yaml
flow-walker run flows/login.yaml --json   # machine-readable
```

### `report` — Generate HTML viewer

Self-contained HTML with embedded video, screenshots, and clickable step timeline.

```bash
flow-walker report ./run-output/25h7afGwBK/
```

### `push` — Share report

Uploads report.html to the hosted service and returns a shareable URL. No auth, no config.

```bash
flow-walker push ./run-output/25h7afGwBK/
# => URL: https://flow-walker.beastoin.workers.dev/runs/25h7afGwBK

flow-walker push ./run-output/25h7afGwBK/ --json
# => {"id":"25h7afGwBK","url":"https://...","htmlUrl":"https://....html","expiresAt":"2026-04-11T..."}
```

Reports are stored for 30 days. Re-pushing the same run is idempotent — returns the same URL with updated expiry.

### `get` — Retrieve run data

Fetches structured run data from the hosted service by run ID.

```bash
flow-walker get 25h7afGwBK          # pretty-printed
flow-walker get 25h7afGwBK --json   # compact (pipe-friendly)
flow-walker get 25h7afGwBK | jq '.steps[] | select(.status=="fail")'
```

### `migrate` — Convert v1 → v2

Convert scripted v1 flows to agent-first v2 format with natural language instructions.

```bash
flow-walker migrate flows/old-flow.yaml
flow-walker migrate flows/old-flow.yaml --output flows/new-flow.yaml
```

### `schema` — Agent discovery

Machine-readable command introspection. Returns versioned JSON with args, flags, and descriptions.

```bash
flow-walker schema           # all commands with version envelope
flow-walker schema verify    # single command detail
```

## v2 Flow format (agent-first)

```yaml
version: 2
name: tab-navigation
description: Bottom nav bar detection, switch between 4 tabs
app: Omi
app_url: https://omi.me
covers:
  - app/lib/pages/home/page.dart
preconditions:
  - auth_ready

steps:
  - id: S1
    do: Open the home tab and verify the bottom navigation bar has at least 4 tabs
    anchors:
      - "@home-tab"
    expect:
      - milestone: home-visible
        outcome: pass
    evidence:
      - screenshot: tab-home

  - id: S2
    do: Press the second tab in the bottom navigation
    anchors:
      - "@nav-tab-2"
    expect:
      - milestone: tab-switched
        outcome: pass
    evidence:
      - screenshot: tab-2
```

### v2 Step fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique step identifier (e.g., S1, S2) |
| `do` | yes | Natural language instruction for the agent |
| `anchors` | no | Hint refs for fast element access (e.g., @home-tab) |
| `expect` | no | Expected outcomes with milestone names |
| `evidence` | no | Evidence to capture (screenshots, artifacts) |

### Event types

| Type | Scope | Description |
|------|-------|-------------|
| `run.start` | run | Run initialization |
| `step.start` | step | Step begins |
| `action` | step | Agent performed an action |
| `assert` | step | Assertion check |
| `artifact` | step | Evidence captured |
| `step.end` | step | Step complete with status |
| `run.end` | run | Run finished |
| `note` | any | Informational event |

## v1 Flow format (legacy)

v1 flows use scripted step actions (press, fill, scroll, back, assert). They can be converted to v2 with `flow-walker migrate`.

### v1 Assertions

| Assertion | Syntax | Description |
|-----------|--------|-------------|
| `interactive_count` | `{ min: 20 }` | Min total interactive elements on screen |
| `bottom_nav_tabs` | `{ min: 4 }` | Min bottom navigation tabs |
| `has_type` | `{ type: switch, min: 2 }` | Min elements of a specific type |
| `text_visible` | `["Featured", "Home"]` | Text must be visible on screen |
| `text_not_visible` | `["Error", "Sign In"]` | Text must NOT be visible on screen |

## Agent-friendly design

Built following [Poehnelt's CLI-for-agents principles](https://justin.poehnelt.com/posts/rewrite-your-cli-for-ai-agents/):

- **Schema introspection** — `flow-walker schema` returns versioned JSON with typed args/flags
- **Structured errors** — every error returns `{code, message, hint, diagnosticId}` in JSON
- **Input hardening** — path traversal, control chars, URI format all validated
- **TTY-aware JSON** — `--no-json` > `--json` > `FLOW_WALKER_JSON=1` > TTY auto-detect
- **Dry-run** — `--dry-run` parses and resolves targets without executing
- **NDJSON streaming** — walk emits one JSON event per line
- **Unique run IDs** — 10-char base64url per run, filesystem-safe, URL-safe
- **Hosted sharing** — `flow-walker push` uploads report and returns a URL, no auth needed
- **Agent-first URLs** — `/runs/:id` defaults to JSON; `.html` suffix for humans
- **Three verify modes** — strict for CI, balanced for agents, audit for logging
- **App metadata** — optional `app` + `app_url` in YAML flows, shown in reports
- **Environment variables** — `FLOW_WALKER_OUTPUT_DIR`, `FLOW_WALKER_AGENT_PATH`, `FLOW_WALKER_DRY_RUN`, `FLOW_WALKER_JSON`, `FLOW_WALKER_API_URL`
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
6. **Agent-first v2** — natural language instructions, not scripted steps

## Phase history

| Phase | Focus | Status |
|-------|-------|--------|
| 1 | walk: BFS explorer, fingerprinting, safety, YAML generation | Complete |
| 2 | run + report: flow executor, video/screenshots, HTML viewer | Complete |
| 3 | Agent-grade: structured errors, schema, input hardening, run IDs | Complete |
| 4 | Hosted reports: push command, Cloudflare Worker + R2 | Complete |
| 5 | Landing page: live metrics, stats tracking | Complete |
| 6 | Agent-friendly run data + app metadata | Complete |
| 7-9 | v2 agent-first: record/verify pipeline, v2 schema, migrate | Complete |

## Hosted reports

Reports can be pushed to [flow-walker.beastoin.workers.dev](https://flow-walker.beastoin.workers.dev) for sharing.

## License

MIT
