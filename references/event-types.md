# Event Types

## Contents

1. Global rules
2. Event reference
3. Recommended action payloads
4. Notes on replay and verification

## Global Rules

`record stream` validates event type names and requires `step_id` on step-scoped events. It also adds `seq` and `ts` if they are missing. Artifact files (`path` on artifact events, `screenshot` on any event) are auto-renamed to `{compactTimestamp}-{stepId}-{originalName}` for chronological synthesis.

Step-scoped event types:
- `step.start`
- `action`
- `assert`
- `artifact`
- `step.end`
- `agent-review`

Use these cross-event rules:
- Always send one JSON object per line.
- Use `passed: true|false` on `assert`.
- Use `prompt_idx` plus `verdict: "pass"|"fail"` on `agent-review`.
- Use `outcome: "pass"|"fail"|"skipped"|"recovered"` on `step.end`.
- Include replay-friendly metadata on `action`, especially `command` and `element_bounds`.

## Event Reference

### `run.start`

Validator-required fields:
- `type`

Useful fields:
- `run_id`
- `flow`
- `device`
- `platform`

Example:

```json
{"type":"run.start","run_id":"P-tnB_sgKA","flow":"login-flow"}
```

### `step.start`

Validator-required fields:
- `type`
- `step_id`

Useful fields:
- `name`
- `do`

Example:

```json
{"type":"step.start","step_id":"S1"}
```

### `action`

Validator-required fields:
- `type`
- `step_id`

Operationally important fields:
- `command`: `press`, `fill`, `scroll`, `back`
- `target`: raw action target such as `@e3`
- `element_ref`
- `element_text`
- `element_type`
- `element_bounds`
- `fill_value`
- `scroll_text`
- `scroll_direction`

Example press action:

```json
{
  "type":"action",
  "step_id":"S1",
  "command":"press",
  "target":"@e3",
  "element_ref":"e3",
  "element_text":"Login",
  "element_type":"button",
  "element_bounds":{"x":480,"y":1180,"width":120,"height":44}
}
```

Example coordinate replay action:

```json
{
  "type":"action",
  "step_id":"S2",
  "command":"press",
  "target":"540 1200",
  "element_bounds":{"x":500,"y":1160,"width":80,"height":80}
}
```

### `assert`

Validator-required fields:
- `type`
- `step_id`

Operationally important fields:
- `passed`
- `milestone`
- `kind`
- `actual`
- `count`
- `found`

Use `passed` as a boolean.

Example:

```json
{
  "type":"assert",
  "step_id":"S1",
  "milestone":"home-visible",
  "kind":"text-visible",
  "passed":true,
  "found":["Home"]
}
```

### `artifact`

Validator-required fields:
- `type`
- `step_id`

Operationally important fields:
- `path`
- `kind`
- `label`

Use `path` relative to the run directory. Any filename works — `record stream` auto-renames it with a timestamp prefix for chronological ordering.

Example:

```json
{"type":"artifact","step_id":"S1","kind":"screenshot","path":"screenshot.webp"}
```

### `step.end`

Validator-required fields:
- `type`
- `step_id`

Operationally important fields:
- `outcome`
- `status`
- `summary`

Valid `outcome` values:
- `pass`
- `fail`
- `skipped`
- `recovered`

Non-standard values are accepted with a warning and may be normalized later.

Example:

```json
{"type":"step.end","step_id":"S1","outcome":"pass"}
```

### `run.end`

Validator-required fields:
- `type`

Useful fields:
- `run_id`
- `status`
- `summary`

Example:

```json
{"type":"run.end","run_id":"P-tnB_sgKA","status":"pass"}
```

### `note`

Validator-required fields:
- `type`

Useful fields:
- `step_id`
- `message`
- `kind`

Example:

```json
{"type":"note","step_id":"S2","message":"Recovered after reconnect"}
```

## Log Evidence (Machine-Synthesized Timeline)

**The primary way to get a correlated log timeline is to provide raw log files as evidence.** flow-walker machine-synthesizes the timeline — agents do NOT need to write synthesis manually.

### How it works

1. **Agent captures raw logs** — save timestamped log output to files in the run directory:
   - `app.log` — Flutter/app-side logs (e.g., `adb logcat -d > app.log`)
   - `backend.log` — server-side logs (e.g., `curl .../logs > backend.log`)
   - Any `*.log` file works — the filename (minus extension and timestamp prefix) becomes the source name
2. **`record finish`** — auto-renames log files with timestamp prefix (e.g., `app.log` → `20260330T100001Z-app.log`)
3. **`report`** — auto-discovers all `.log` files, parses timestamps from each line, filters to the run time window, correlates each line with the step it falls within (by time range), and injects step boundary markers (▶ start, ■ end)
4. **Output** — the `logTimeline` array in run.json contains the full machine-synthesized timeline with:
   - `ts` — parsed timestamp from the log line
   - `source` — derived from filename (`backend.log` → `"backend"`, `app.log` → `"app"`)
   - `message` — the raw log line content
   - `stepId` — which step this line falls within (by timestamp correlation)
   - `level` — detected log level (`error`, `warn`, `info`, `debug`)
   - `cite` — `"filename:lineNo"` citation linking to the raw log

### Supported timestamp formats

The parser handles:
- ISO 8601: `2026-03-30T10:00:01.200Z`
- Python comma-ms: `2026-03-30 10:00:01,200`
- Space-separated: `2026-03-30 10:00:01.200`
- Logcat (no year): `03-30 10:00:01.200`

### Agent workflow

```bash
# During recording, capture logs as evidence:
adb logcat -d > $RUN_DIR/app.log
curl -s https://api.example.com/logs?since=$START > $RUN_DIR/backend.log

# finish auto-timestamps the log files
flow-walker record finish --run-id $ID --run-dir $DIR --status pass

# report machine-synthesizes the timeline
flow-walker report $RUN_DIR

# JSON output includes the full timeline
flow-walker get $ID --json  # → { logTimeline: [...], ... }
```

### Timeline output example

```json
{
  "logTimeline": [
    { "ts": "2026-03-30T10:00:00.000Z", "source": "step", "message": "▶ S1: Navigate to Offline Sync", "stepId": "S1" },
    { "ts": "2026-03-30T10:00:00.500Z", "source": "app", "message": "SyncProvider: auto-sync triggered", "stepId": "S1", "cite": "20260330T100000Z-app.log:42" },
    { "ts": "2026-03-30T10:00:01.000Z", "source": "backend", "message": "POST /v2/sync-local-files 202", "stepId": "S1", "level": "info", "cite": "20260330T100000Z-backend.log:15" },
    { "ts": "2026-03-30T10:00:05.000Z", "source": "step", "message": "■ S1: pass", "stepId": "S1" },
    { "ts": "2026-03-30T10:00:05.100Z", "source": "step", "message": "▶ S2: Upload phase begins", "stepId": "S2" }
  ]
}
```

### `agent-review`

Validator-required fields:
- `type`
- `step_id`

Operationally important fields:
- `prompt_idx`
- `verdict`
- `reason`

Valid verdicts for prompt resolution:
- `pass`
- `fail`

Example:

```json
{
  "type":"agent-review",
  "step_id":"S2",
  "prompt_idx":0,
  "verdict":"pass",
  "reason":"Home shell is visible and no error banner appears"
}
```

## Recommended Action Payloads

Use this minimum replay-friendly set for every actionable step:

```json
{
  "type":"action",
  "step_id":"S1",
  "command":"press",
  "element_ref":"e3",
  "element_text":"Login",
  "element_type":"button",
  "element_bounds":{"x":480,"y":1180,"width":120,"height":44}
}
```

Why each field matters:
- `command` drives snapshot replay semantics.
- `element_ref` gives a ref fallback.
- `element_text` and `element_type` help rediscovery.
- `element_bounds` enables `center` coordinate caching.

## Notes on Replay and Verification

- Snapshot save reads `action.command`, `action.element_ref`, `action.element_text`, `action.element_type`, `action.fill_value`, `action.scroll_text`, `action.scroll_direction`, and `action.element_bounds`.
- `verify` reads `assert.milestone`, `assert.kind`, and `assert.passed`.
- `verify` resolves judge prompts from `agent-review.prompt_idx` and `agent-review.verdict`.
- Missing `element_bounds` removes fast coordinate replay even when the rest of the action data is present.
