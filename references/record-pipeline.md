# Record Pipeline

## Contents

1. Contract
2. Initialize
3. Parse the recipe
4. Stream events
5. Finish and verify
6. Batch pattern
7. Replay-aware execution

## Contract

Use this file for the fragile path: `record init` -> `record stream` -> `record finish` -> `verify` -> `report` -> `push`.

Keep these rules:
- Pass `--json` on every `flow-walker` command.
- Treat `record init` output as authoritative.
- Stream NDJSON. One event object per line.
- Use `verify ... --mode audit --json` before `report` or `push`.
- Read [event-types.md](event-types.md) before inventing event payloads.

## Initialize

```bash
INIT=$(flow-walker record init --flow ./flows/login.yaml --output-dir ./runs --no-video --json)
```

Extract:
- `id`: run ID
- `dir`: run directory
- `recipe`: per-step event sequence
- `replay`: cached snapshot plan when available

Example shape:

```json
{
  "id": "P-tnB_sgKA",
  "dir": "./runs/P-tnB_sgKA",
  "video": false,
  "replay": {
    "mode": "replay",
    "valid": true,
    "verifySteps": ["S1", "S3"],
    "steps": {
      "S2": {
        "kind": "action",
        "command": "press",
        "ref": "e5",
        "text": "Settings",
        "type": "button",
        "bounds": { "x": 100, "y": 200, "width": 80, "height": 40 },
        "center": { "x": 140, "y": 220 },
        "waitAfterMs": 500,
        "durationMs": 1300
      }
    }
  },
  "recipe": [
    {
      "id": "S1",
      "name": "Open home",
      "events": [
        "step.start",
        "action",
        "artifact (screenshot: step-S1.webp)",
        "assert (milestone: home-visible)",
        "step.end"
      ]
    }
  ]
}
```

## Parse the recipe

Treat each `recipe[].events` array as a contract generated from the YAML flow.

Generation rules:
- Always include `step.start`.
- Always include `action`.
- Add `artifact (screenshot: step-{step_id}.webp)` when the step has `judge` or step-level `evidence`.
- Add one `assert` entry for each `expect` item.
- Add one `agent-review` entry for each `judge` prompt.
- Always include `step.end`.

Operational meaning:
- If the recipe includes `assert`, the step needs at least one streamed `assert` event.
- If the recipe includes `artifact`, the step needs a screenshot file in the run directory and a streamed `artifact` event.
- If the recipe includes `agent-review`, the step needs one review event per prompt index.
- If `record finish` warns about gaps, fix the streamed events or the flow definition. Do not ignore the warning.

## Stream events

`record stream` accepts newline-delimited JSON through stdin or `--events`.

Pipe pattern:

```bash
flow-walker record stream --run-id "$RUN_ID" --run-dir "$RUN_DIR" --json < ./events.ndjson
```

Inline flag pattern:

```bash
flow-walker record stream \
  --run-id "$RUN_ID" \
  --run-dir "$RUN_DIR" \
  --events "$(cat ./events.ndjson)" \
  --json
```

Practical step recipe:

1. Emit `step.start`.
2. Take a fresh `agent-flutter snapshot --json` before acting.
3. Execute the action with `agent-flutter`.
4. Emit `action` with replay-friendly metadata.
5. Capture a screenshot when the recipe includes `artifact`.
6. Emit `assert` events for every executed automated check.
7. Emit `agent-review` events for every judge prompt you resolved.
8. Emit `step.end`.

Use positional `agent-flutter` commands:

```bash
agent-flutter press @e3
agent-flutter press 540 1200
agent-flutter screenshot "$RUN_DIR/step-S1.webp"
```

Recommended `action` event for a press:

```json
{
  "type": "action",
  "step_id": "S1",
  "command": "press",
  "target": "@e3",
  "element_ref": "e3",
  "element_text": "Login",
  "element_type": "button",
  "element_bounds": { "x": 480, "y": 1180, "width": 120, "height": 44 }
}
```

Recommended `assert` event:

```json
{
  "type": "assert",
  "step_id": "S1",
  "milestone": "home-visible",
  "kind": "text-visible",
  "passed": true
}
```

Use a boolean `passed`. Do not emit `"pass"` as a string in `assert`.

## Finish and verify

Finish the recording:

```bash
flow-walker record finish \
  --run-id "$RUN_ID" \
  --run-dir "$RUN_DIR" \
  --status pass \
  --flow ./flows/login.yaml \
  --json
```

Interpret the response:
- `finished: true` means the run metadata closed successfully.
- `warnings` means the streamed events do not satisfy the recipe or flow-derived expectations.
- `snapshotSaved: true` means a replay snapshot was written automatically for a passing run.

Verify immediately:

```bash
flow-walker verify ./flows/login.yaml --run-dir "$RUN_DIR" --mode audit --json
```

Then generate artifacts:

```bash
flow-walker report "$RUN_DIR" --json
flow-walker push "$RUN_DIR" --json
```

Use these follow-up commands when needed:

```bash
flow-walker verify ./flows/login.yaml --run-dir "$RUN_DIR" --recheck --json
flow-walker verify ./flows/login.yaml --run-dir "$RUN_DIR" --agent-prompt --json
flow-walker get "$RUN_ID" --json
```

## Batch Pattern

Prefer sending a whole step at once.

```json
{"type":"step.start","step_id":"S1"}
{"type":"action","step_id":"S1","command":"press","element_ref":"e3","element_text":"Login","element_type":"button","element_bounds":{"x":480,"y":1180,"width":120,"height":44}}
{"type":"artifact","step_id":"S1","path":"step-S1.webp","kind":"screenshot"}
{"type":"assert","step_id":"S1","milestone":"home-visible","kind":"text-visible","passed":true}
{"type":"agent-review","step_id":"S1","prompt_idx":0,"verdict":"pass","reason":"Home UI is visible"}
{"type":"step.end","step_id":"S1","outcome":"pass"}
```

Stream it:

```bash
flow-walker record stream --run-id "$RUN_ID" --run-dir "$RUN_DIR" --json < ./step-S1.ndjson
```

Why this pattern:
- Keep event order stable.
- Let `record stream` assign `seq` and `ts`.
- Reduce partial-step writes.

## Replay-Aware Execution

When `record init` returns `replay.mode: "replay"`:
- Use `replay.verifySteps` for steps that still need full UI inspection.
- Use `replay.steps[stepId].center` for fast coordinate taps when present.
- Fall back to `replay.steps[stepId].ref`, then text/type matching.
- Keep streaming normal events. Replay changes discovery, not the run data contract.

Fast replay only works when prior `action` events included `element_bounds`. Missing bounds remove the cached `center` coordinates.
