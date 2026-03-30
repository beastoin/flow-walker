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

Log timeline fields (reporter auto-renders these as a correlated timeline):
- `source` — origin of the log line (e.g., `"app"`, `"backend"`, `"device"`). Color-coded in report.
- `message` — the log content.
- `level` — `"error"`, `"warn"`, `"info"`, or `"debug"`. Error/warn get highlighted.

The reporter also auto-discovers `.log` files in the run directory, parses their timestamps, correlates lines with steps by time range, and renders them in the timeline with `filename:line` citations. Drop log files as artifacts — no manual note events needed.

Examples:

```json
{"type":"note","step_id":"S2","message":"Recovered after reconnect"}
{"type":"note","step_id":"S3","source":"app","message":"SyncProvider: POST /v2/sync-local-files"}
{"type":"note","step_id":"S3","source":"backend","message":"POST /v2/sync 202 Accepted","level":"info"}
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
