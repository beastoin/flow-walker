---
name: flow-walker
description: Execute E2E flow tests using flow-walker CLI. Covers 3 use cases: (1) auto-discover app screens via BFS walk, (2) record+verify+report a YAML flow with two-tier verification, (3) replay a flow fast using snapshots. Use when running, creating, or verifying E2E test flows on Flutter/desktop apps via agent-flutter or agent-swift.
---

# flow-walker Agent Skill

## Prerequisites
- `flow-walker` in PATH (v0.5.2+) — `npm install -g flow-walker-cli`
- `agent-flutter` in PATH — `npm install -g agent-flutter-cli`
- A running Flutter app in debug mode connected via ADB (mobile) or agent-swift (desktop)
- Node.js >= 22

## Always use --json

Every flow-walker command supports `--json`. Always use it. Parse the JSON output to get structured data for the next step. Never rely on human-readable text output.

## Exit codes
- 0 = success
- 1 = flow failure (verify found a failing step)
- 2 = error (bad input, unverified result, missing files)

---

## Use Case 1: Auto-Discover App Screens

**When:** You don't know the app's structure and want to generate flow YAML files automatically.

### Steps

```bash
# 1. Connect agent-flutter to the running app
agent-flutter connect
# Connects to the Flutter app via ADB. Must succeed before walk.

# 2. Walk the app — BFS explores every screen
#    REQUIRED: --skip-connect (reuse session from step 1), --app-uri, or --bundle-id
flow-walker walk --skip-connect --json
# => NDJSON stream: one event per line (screens discovered, edges found, flows generated)

# 3. Or generate a scaffold flow for a specific feature (no connection needed)
flow-walker walk --name login-flow --output flows/login.yaml --json
# => {"flow":"login-flow","path":"flows/login.yaml"}
```

### Key flags
- `--skip-connect` — reuse existing agent-flutter session (most common)
- `--app-uri ws://...` — connect by VM Service URI
- `--bundle-id com.example.app` — connect by bundle ID
- `--max-depth 3` — limit exploration depth (default: 5)
- `--dry-run` — snapshot without pressing anything
- `--blocklist "delete,logout"` — prevent pressing destructive elements
- `--agent swift` — use agent-swift instead of agent-flutter

**Note:** One of `--skip-connect`, `--app-uri`, or `--bundle-id` is required (unless using `--name` for scaffold generation).

### Output
YAML flow files in `--output-dir` (default `./flows/`). Each file is a v2 flow ready for the recording pipeline.

---

## Use Case 2: Record, Verify, and Report a Flow

**When:** You have a YAML flow and want to execute it, verify the results, and produce a shareable report.

This is the primary use case. Follow these 6 steps exactly.

### Step 1: Initialize recording

```bash
INIT=$(flow-walker record init --flow flows/login.yaml --no-video --json)
echo "$INIT"
# => {"id":"P-tnB_sgKA","dir":"runs/P-tnB_sgKA","video":false,"recipe":[...]}
```

Extract from the JSON:
- `id` — run ID (use for stream/finish)
- `dir` — run directory (use for stream/finish/verify/report/push)
- `recipe` — per-step event sequence telling you exactly what to stream

**Recipe example:**
```json
[
  {"id":"S1","name":"Open home","events":["step.start","action","artifact (screenshot: step-S1.webp)","assert (milestone: home-visible)","step.end"]},
  {"id":"S2","name":"Tap settings","events":["step.start","action","step.end"]}
]
```

### Step 2: Execute each step and stream events

For each step in the recipe, execute the action with agent-flutter and stream events to flow-walker.

**Event streaming pattern for one step:**

```bash
RUN_ID="P-tnB_sgKA"
RUN_DIR="runs/P-tnB_sgKA"
STEP_ID="S1"

# 2a. Start the step
echo '{"type":"step.start","step_id":"'$STEP_ID'"}' | \
  flow-walker record stream --run-id $RUN_ID --run-dir $RUN_DIR --json

# 2b. Execute action with agent-flutter
SNAP=$(agent-flutter snapshot --json)  # get current screen state
agent-flutter press @5 --json  # tap the element
# Stream the action event — include element details for snapshot replay
# Extract element info from the snapshot for richer action events:
#   element_ref, element_text, element_type, element_bounds (enables fast-tap replay)
echo '{"type":"action","step_id":"'$STEP_ID'","action":"tap","ref":"@5",
  "element_ref":"e5","element_text":"Login","element_type":"button",
  "element_bounds":{"x":100,"y":200,"width":80,"height":40}}' | \
  flow-walker record stream --run-id $RUN_ID --run-dir $RUN_DIR --json

# 2c. Capture screenshot (for steps with judge or evidence)
agent-flutter snapshot --json > /tmp/snap.json
# Save screenshot as WebP in run dir (via agent-flutter, not direct ADB)
agent-flutter screenshot --output $RUN_DIR/step-$STEP_ID.webp --json 2>/dev/null || \
  (adb exec-out screencap -p > /tmp/raw.png && \
   cwebp -q 70 -resize 270 600 /tmp/raw.png -o $RUN_DIR/step-$STEP_ID.webp)
# Stream artifact event
echo '{"type":"artifact","step_id":"'$STEP_ID'","path":"step-'$STEP_ID'.webp"}' | \
  flow-walker record stream --run-id $RUN_ID --run-dir $RUN_DIR --json

# 2d. Check assertions (for steps with expect)
# Use agent-flutter to verify text/elements, then stream assert
echo '{"type":"assert","step_id":"'$STEP_ID'","milestone":"home-visible","passed":true}' | \
  flow-walker record stream --run-id $RUN_ID --run-dir $RUN_DIR --json

# 2e. Agent review (for steps with judge)
# Look at the screenshot, evaluate the judge prompt, stream verdict
echo '{"type":"agent-review","step_id":"'$STEP_ID'","prompt_idx":0,"verdict":"pass","reason":"Home tab bar visible with 4 icons"}' | \
  flow-walker record stream --run-id $RUN_ID --run-dir $RUN_DIR --json

# 2f. End the step
echo '{"type":"step.end","step_id":"'$STEP_ID'"}' | \
  flow-walker record stream --run-id $RUN_ID --run-dir $RUN_DIR --json
```

**Batch streaming (preferred — send all step events at once):**

```bash
echo '{"type":"step.start","step_id":"S1"}
{"type":"action","step_id":"S1","action":"tap","ref":"@5","element_ref":"e5","element_text":"Home","element_type":"button","element_bounds":{"x":10,"y":500,"width":100,"height":40}}
{"type":"artifact","step_id":"S1","path":"step-S1.webp"}
{"type":"assert","step_id":"S1","milestone":"home-visible","passed":true}
{"type":"agent-review","step_id":"S1","prompt_idx":0,"verdict":"pass","reason":"Home visible"}
{"type":"step.end","step_id":"S1"}' | \
  flow-walker record stream --run-id $RUN_ID --run-dir $RUN_DIR --json
```

### Step 3: Finish recording

```bash
FINISH=$(flow-walker record finish --run-id $RUN_ID --run-dir $RUN_DIR \
  --status pass --flow flows/login.yaml --json)
echo "$FINISH"
# => {"snapshotSaved":true,"snapshotSteps":3,"warnings":[]}
```

**Check warnings!** If warnings appear (e.g., "Step S2: missing assert event"), you missed streaming required events. The recipe told you what was needed.

### Step 4: Verify (REQUIRED)

```bash
VERIFY=$(flow-walker verify flows/login.yaml --run-dir $RUN_DIR --mode balanced --json)
echo "$VERIFY"
# => {"schema":"flow-walker.run.v3","flow":"login","mode":"balanced","result":"pass",
#     "automatedResult":"pass","agentResult":"pass","steps":[...],"issues":[]}
```

**Result values:**
- `"pass"` — all checks passed (exit code 0)
- `"fail"` — at least one step failed (exit code 1)
- `"unverified"` — checks exist but none produced evidence (exit code 2)

**Verify modes:**
- `strict` — all expectations must match via automated checks
- `balanced` (default) — flexible matching, skipped steps OK
- `audit` — agent-attested, generates structure from events

### Step 5: Generate report

```bash
REPORT=$(flow-walker report $RUN_DIR --json)
echo "$REPORT"
# => {"report":"runs/P-tnB_sgKA/report.html"}
```

### Step 6: Push to hosted service

```bash
PUSH=$(flow-walker push $RUN_DIR --json)
echo "$PUSH"
# => {"id":"P-tnB_sgKA","url":"https://flow-walker.beastoin.workers.dev/runs/P-tnB_sgKA",
#     "htmlUrl":"https://flow-walker.beastoin.workers.dev/runs/P-tnB_sgKA.html"}
```

The `htmlUrl` is the shareable report link.

---

## Use Case 3: Replay a Flow Fast

**When:** You already ran a flow successfully and want to re-run it faster (regression testing, re-verification after app update).

### How it works

After a successful `record finish`, a snapshot is automatically saved next to the flow YAML (`<flow>.snapshot.json`). On the next `record init`, the snapshot is loaded automatically and returned as a replay plan.

```bash
# Init returns replay plan with cached step data
INIT=$(flow-walker record init --flow flows/login.yaml --no-video --json)
# => {"id":"...","dir":"...","replay":{"mode":"replay","valid":true,
#     "steps":{"S1":{"kind":"action","command":"press","ref":"e5","text":"Login",
#       "type":"button","bounds":{"x":100,"y":200,"width":80,"height":40},
#       "center":{"x":140,"y":220},"waitAfterMs":500,"durationMs":1500},...},
#     "verifySteps":["S1","S3"]}}
```

### Replay logic

```
if replay.mode == "replay":
  for each step:
    if step.id in replay.verifySteps:
      # Full verification: snapshot screen, check elements, run assertions
      agent-flutter snapshot --json
      agent-flutter press @ref --json
    else if replay.steps[id].center exists:
      # Fast path: tap cached coordinates directly (x y as positional args)
      agent-flutter press replay.steps[id].center.x replay.steps[id].center.y --json
    else:
      # No coordinates cached — use text/type to re-discover element
      agent-flutter snapshot --json  # find element by replay.steps[id].text
      agent-flutter press @ref --json
    stream events as normal (step.start, action, step.end)
else:
  # No snapshot or flow changed — full exploration mode
  execute all steps with full UI discovery
```

**Important:** Center coordinates are only available in snapshots when action events include `element_bounds` (see UC2 Step 2b). Without bounds, replay falls back to text-based element re-discovery, which is slower but still works.

To enable fast-tap replay, always include these fields in action events:
- `element_ref` — element reference (e.g., "e5")
- `element_text` — visible text on the element
- `element_type` — element type (e.g., "button", "InkWell")
- `element_bounds` — `{"x":100,"y":200,"width":80,"height":40}` from agent-flutter snapshot

### Manual snapshot management

```bash
# Save snapshot from a run
flow-walker snapshot save --flow flows/login.yaml --run-dir runs/abc --json
# => {"saved":true,"path":"flows/login.snapshot.json","steps":3,"verifySteps":2}

# Load snapshot (check if replay available)
flow-walker snapshot load --flow flows/login.yaml --json
# => {"mode":"replay","steps":{...},"verifySteps":["S1","S3"]} or {"mode":"explore","reason":"..."}
```

---

## Flow YAML v2 Format

```yaml
version: 2
name: login-flow
description: Verify login with email and password
app: com.example.app
covers:
  - lib/pages/login_page.dart
preconditions:
  - app_installed

steps:
  - id: S1
    name: Open login
    do: Navigate to the login page
    claim: Login form is visible with email and password fields
    verify: true
    expect:
      - kind: text_visible
        values: ["Email", "Password"]
        milestone: login-form-visible
    evidence:
      - screenshot: step-S1.webp
    judge:
      - prompt: Does the screenshot show a login form with email and password fields?
        look_for: [email input, password input, submit button]
        fail_if: [error dialog, blank screen, loading spinner]

  - id: S2
    name: Fill credentials
    do: Enter test@example.com in email and password123 in password field
    expect:
      - kind: text_visible
        values: ["test@example.com"]

  - id: S3
    name: Submit
    do: Tap the login/submit button
    claim: User is logged in and sees the home screen
    verify: true
    judge:
      - prompt: Is the user now on the home screen after login?
        look_for: [home tab, welcome message, user avatar]
        fail_if: [login form still visible, error message]
```

### Step fields reference

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique step ID (S1, S2, ...) |
| `name` | no | Short description |
| `do` | yes | What action to perform (human-readable instruction) |
| `claim` | no | What this step proves (shown as headline in report) |
| `verify` | no | If `true`, always verify on replay (not just fast-tap) |
| `expect` | no | Tier 1: automated checks (`kind`, `values`, `milestone`, `min`) |
| `judge` | no | Tier 2: agent review prompts (`prompt`, `look_for`, `fail_if`) |
| `evidence` | no | Screenshots/artifacts to capture |
| `note` | no | Implementation notes, coordinates |

### Two-tier verification

- **Tier 1 (expect → assert):** Deterministic. Agent checks text visibility, element counts, milestones. Streams `assert` events with `passed: true/false`.
- **Tier 2 (judge → agent-review):** Vision-based. Agent examines screenshot, evaluates prompt, streams `agent-review` events with `verdict: pass/fail` and `reason`.

Both tiers feed into the step outcome and overall result. If both pass → PASS. If either fails → FAIL. If checks exist but none produced evidence → UNVERIFIED.

---

## Event Types Reference

| Type | Scope | Required fields | When to stream |
|------|-------|----------------|---------------|
| `step.start` | step | `step_id` | Before executing each step |
| `action` | step | `step_id`, `action` + optional: `element_ref`, `element_text`, `element_type`, `element_bounds` | After each agent-flutter command |
| `assert` | step | `step_id`, `milestone` or `kind`, `passed` (boolean: true/false) | After checking expect conditions |
| `artifact` | step | `step_id`, `path` | After saving screenshot/file |
| `agent-review` | step | `step_id`, `prompt_idx`, `verdict`, `reason` | After evaluating judge prompt |
| `step.end` | step | `step_id` | After completing each step |
| `note` | step | `step_id` | Optional annotation |

---

## Common Mistakes

1. **Running `walk` without connection flags** — `flow-walker walk --json` will error. You must provide `--skip-connect` (after `agent-flutter connect`), `--app-uri`, or `--bundle-id`.
2. **Not streaming assert events** — If the flow has `expect` fields, you MUST stream matching `assert` events or verify will show `no_evidence`.
3. **Not streaming agent-review events** — If the flow has `judge` fields, you MUST stream `agent-review` events or prompts stay `pending` and result is `unverified`.
4. **Missing screenshots for judge steps** — Judge prompts expect a screenshot. Save it as `step-{step_id}.webp` in the run directory and stream an `artifact` event.
5. **Omitting --json** — Without `--json`, output is human-readable text that's hard to parse. Always use `--json`.
6. **Skipping recipe** — `record init` returns a recipe. Read it. It tells you exactly which events each step needs.
7. **Not checking warnings** — `record finish` returns warnings for missing events. Fix them before verify.
8. **Forgetting verify before report** — `report` will reject non-v2 data. Always run `verify` first.
9. **Missing element_bounds in action events** — Without `element_bounds`, snapshots won't have center coordinates, so replay falls back to slow text-based re-discovery instead of fast coordinate taps.

---

## Quick Reference: Full Pipeline

```bash
# 1. Init
INIT=$(flow-walker record init --flow $FLOW --no-video --json)
RUN_ID=$(echo $INIT | jq -r .id)
RUN_DIR=$(echo $INIT | jq -r .dir)

# 2. For each step: execute with agent-flutter, stream events
# (see recipe from $INIT for per-step event requirements)

# 3. Finish
flow-walker record finish --run-id $RUN_ID --run-dir $RUN_DIR --status pass --flow $FLOW --json

# 4. Verify
flow-walker verify $FLOW --run-dir $RUN_DIR --mode balanced --json

# 5. Report
flow-walker report $RUN_DIR --json

# 6. Push
PUSH=$(flow-walker push $RUN_DIR --json)
echo $PUSH | jq -r .htmlUrl
```
