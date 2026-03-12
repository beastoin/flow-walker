# flow-walker — Agent Workflow Guide

## What is flow-walker

flow-walker auto-explores Flutter apps and executes YAML test flows.
It builds on [agent-flutter](https://github.com/beastoin/agent-flutter) — all device interaction goes through agent-flutter.

**Three commands:**
- `walk` — BFS-explore the app, discover screens, generate YAML flows
- `run` — Execute a YAML flow, produce run.json + video + screenshots
- `report` — Generate self-contained HTML report from run results

## Prerequisites

1. **agent-flutter** installed and in PATH (`npm install -g agent-flutter-cli`)
2. Flutter app running via `flutter run` with Marionette initialized
3. ADB connected (Android) or Simulator running (iOS)
4. Run `agent-flutter doctor` to verify setup

## Canonical workflows

### Auto-explore an app

```bash
# 1. Connect agent-flutter
agent-flutter connect ws://127.0.0.1:38047/abc=/ws

# 2. Walk the app
flow-walker walk --skip-connect --max-depth 3 --output-dir ./flows/

# Output: YAML flows + _nav-graph.json
```

### Execute a flow

```bash
# 1. Run flow (connects to agent-flutter automatically)
flow-walker run flows/tab-navigation.yaml \
  --output-dir ./results/ \
  --agent-flutter-path agent-flutter

# Output: run.json, recording.mp4, step-*.png, device.log
```

### Generate report

```bash
# 2. Generate HTML viewer
flow-walker report ./results/

# Output: results/report.html (self-contained, can be shared)
```

### CI pipeline (typical)

```bash
# Walk → Run → Report in sequence
flow-walker walk --app-uri ws://... --output-dir ./flows/ --json
flow-walker run ./flows/home-navigation.yaml --output-dir ./run-1/ --json
flow-walker report ./run-1/
# Exit code: 0 = all pass, 1 = any fail, 2 = error
```

## Walk: how exploration works

```
[start] → snapshot home screen → fingerprint
                ↓
        for each interactive element:
            press → snapshot → fingerprint new screen?
                ↓ yes              ↓ no
            queue children     skip (already visited)
                ↓
            back() → verify return to parent
                ↓
            next element
```

**Screen fingerprinting:** Hash of element type/count pairs. Text is ignored (dynamic).
Count bucketing ensures small variations (list items loading) don't create duplicates.

**Safety:** Elements matching blocklist keywords (delete, sign out, logout, reset, remove, unpair) are skipped.

**Depth control:** `--max-depth` limits BFS recursion. Default 5.

**Output per screen:**
- `screen-<name>.yaml` — YAML flow to reach and verify that screen
- `_nav-graph.json` — Full navigation graph (nodes + edges)

## Run: how execution works

Each YAML step is executed sequentially:

1. **Snapshot** current screen via agent-flutter
2. **Resolve** target element (by ref, type, position, or bottom_nav_tab index)
3. **Execute** action (press, scroll, fill, back)
4. **Wait** for transition (configurable delay)
5. **Re-snapshot** to get new element state
6. **Assert** conditions if specified (interactive_count, bottom_nav_tabs)
7. **Screenshot** if requested

**Error handling:** If a step fails, it's marked FAIL and execution continues to remaining steps.

## Output shapes

### run.json

```json
{
  "flow": "tab-navigation",
  "device": "Pixel_7a",
  "startedAt": "2026-03-12T10:00:00Z",
  "duration": 78300,
  "result": "pass",
  "steps": [
    {
      "name": "Verify home tab",
      "action": "assert",
      "status": "pass",
      "timestamp": 0,
      "duration": 12431,
      "elementCount": 22,
      "screenshot": "step-1-tab-home.png",
      "assertion": {
        "interactive_count": { "min": 20, "actual": 22 },
        "bottom_nav_tabs": { "min": 4, "actual": 4 }
      }
    }
  ],
  "video": "recording.mp4",
  "log": "device.log"
}
```

### _nav-graph.json (from walk)

```json
{
  "nodes": [
    { "id": "abc123", "name": "home-screen", "elementCount": 24, "visits": 3 }
  ],
  "edges": [
    { "source": "abc123", "target": "def456", "element": { "ref": "@e3", "type": "button", "text": "Settings" } }
  ]
}
```

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success (walk complete, all flow steps pass) |
| `1` | Flow has failing steps (run command) |
| `2` | Error (invalid args, file not found, device error) |

## YAML flow format

```yaml
name: flow-name
description: What this flow tests
covers:
  - app/lib/pages/home.dart
prerequisites:
  - auth_ready
setup: normal

steps:
  - name: Step description
    press: { type: button, position: rightmost }
    assert:
      interactive_count: { min: 20 }
    screenshot: label
```

### Press targets

| Target | Syntax | Description |
|--------|--------|-------------|
| By ref | `{ ref: "@e3" }` | Direct element reference |
| By type | `{ type: button }` | First element of type |
| By position | `{ type: button, position: rightmost }` | Positional (leftmost/rightmost) |
| By nav tab | `{ bottom_nav_tab: 0 }` | Bottom nav tab by index (0-based, left to right) |

### Assertions

| Assertion | Syntax | Description |
|-----------|--------|-------------|
| Element count | `interactive_count: { min: 20 }` | Minimum interactive elements on screen |
| Nav tabs | `bottom_nav_tabs: { min: 4 }` | Minimum bottom navigation tabs |

## Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `AGENT_FLUTTER_DEVICE` | ADB device ID | auto-detect |
| `ANDROID_ADB_SERVER_ADDRESS` | Remote ADB server host | localhost |
| `ANDROID_ADB_SERVER_PORT` | Remote ADB server port | 5037 |

## Relationship to agent-flutter

flow-walker is a **higher-level tool** built on agent-flutter:

```
flow-walker (explore + execute + report)
    ↓ uses
agent-flutter (connect + snapshot + press + scroll + fill + back)
    ↓ uses
Dart VM Service + Marionette (widget tree access)
```

flow-walker never accesses VM Service or ADB directly.
All device interaction goes through `agent-flutter` CLI commands.

## Recipes

### Discover flows for a new app

```bash
agent-flutter connect
flow-walker walk --skip-connect --max-depth 2 --output-dir ./discovered/
# Review YAML files, edit assertions, commit to repo
```

### Run a flow suite

```bash
for flow in flows/*.yaml; do
  name=$(basename "$flow" .yaml)
  flow-walker run "$flow" --output-dir "./results/$name/" --json
  flow-walker report "./results/$name/"
done
```

### Compare runs

```bash
# Run same flow twice, compare run.json
diff <(jq '.steps[].status' run-a/run.json) <(jq '.steps[].status' run-b/run.json)
```
