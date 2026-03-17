# flow-walker

Auto-explore apps, execute YAML test flows, and publish shareable HTML reports.

flow-walker is the **flow layer** — it defines, discovers, records, verifies, and reports on E2E flows. It uses [agent-flutter](https://github.com/beastoin/agent-flutter) and [agent-swift](https://github.com/beastoin/agent-swift) as **transport layers** for device interaction.

```
flow-walker (flows + reporting)
    │
agent-flutter / agent-swift (device control)
    │
Android / iOS / macOS devices
```

**Live reports:** [flow-walker.beastoin.workers.dev](https://flow-walker.beastoin.workers.dev)

## Install

```bash
npm install -g flow-walker-cli
```

Requires Node.js >= 22, [agent-flutter](https://github.com/beastoin/agent-flutter) in PATH, and a Flutter app running in debug mode.

## Commands

| Command | Description |
|---------|-------------|
| `walk` | Auto-explore app via BFS, generate YAML flows |
| `record` | 3-phase recording: `init` → `stream` → `finish` |
| `verify` | Verify recorded events against flow expectations |
| `report` | Generate self-contained HTML report |
| `push` | Upload report, get shareable URL |
| `get` | Fetch run data from hosted service |
| `snapshot` | Save/load replay data for fast re-execution |
| `migrate` | Convert v1 flows to v2 format |
| `schema` | Machine-readable command introspection |

## Recording pipeline

The primary workflow for E2E testing. An agent executes flow steps and streams events in real time.

```bash
# 1. Initialize — creates run directory and unique run ID
flow-walker record init --flow flows/login.yaml --no-video --json
# => {"id":"P-tnB_sgKA","dir":"runs/P-tnB_sgKA","video":false}

# 2. Stream events — pipe NDJSON via stdin (one event per line)
echo '{"type":"step.start","step_id":"S1","name":"Open app"}' | \
  flow-walker record stream --run-id P-tnB_sgKA --run-dir runs/P-tnB_sgKA

# 3. Finish — finalizes recording, auto-saves snapshot
flow-walker record finish --run-id P-tnB_sgKA --run-dir runs/P-tnB_sgKA \
  --status pass --flow flows/login.yaml --json

# 4. Verify — produces run.json from events + flow expectations
flow-walker verify flows/login.yaml --run-dir runs/P-tnB_sgKA --json > runs/P-tnB_sgKA/run.json

# 5. Report — generates self-contained HTML
flow-walker report runs/P-tnB_sgKA --json

# 6. Push — uploads and returns shareable URL
flow-walker push runs/P-tnB_sgKA --json
# => {"id":"P-tnB_sgKA","htmlUrl":"https://flow-walker.beastoin.workers.dev/runs/P-tnB_sgKA.html"}
```

### Event types

Events are streamed as NDJSON. Step-scoped events require `step_id`.

| Type | Scope | Description |
|------|-------|-------------|
| `run.start` | global | Run began |
| `step.start` | step | Step execution started |
| `action` | step | User action (tap, swipe, fill, keyevent) |
| `assert` | step | Assertion check with pass/fail |
| `artifact` | step | Screenshot or file captured |
| `step.end` | step | Step completed |
| `run.end` | global | Run finished |
| `note` | step | Free-form annotation |

Example event stream for one step:

```jsonl
{"type":"step.start","step_id":"S1","name":"Navigate to Settings","ts":"2026-03-17T06:22:38.489Z"}
{"type":"action","step_id":"S1","action":"tap","target":"Settings icon","adb_coords":"960,180","ts":"2026-03-17T06:22:39.102Z"}
{"type":"assert","step_id":"S1","expect":"text_visible","values":["Settings"],"pass":true,"ts":"2026-03-17T06:22:41.330Z"}
{"type":"artifact","step_id":"S1","artifact":"screenshot","path":"step-S1.webp","ts":"2026-03-17T06:22:41.890Z"}
{"type":"step.end","step_id":"S1","status":"pass","ts":"2026-03-17T06:22:42.015Z"}
```

Every event should include a `ts` field with a real wall-clock timestamp. This is how the report calculates duration.

## Flow YAML format (v2)

```yaml
version: 2
name: conversations
description: Browse conversation list, open detail, switch tabs
app: com.friend.ios.dev
evidence:
  video: true
covers:
  - app/lib/pages/conversations/conversations_page.dart
preconditions:
  - auth_ready

steps:
  - id: S1
    name: Verify home screen
    do: "Verify the home screen shows Conversations heading and folder tabs"
    verify: true
    expect:
      - kind: text_visible
        values: ["Conversations"]
      - kind: interactive_count
        min: 4
    evidence:
      - screenshot: step-S1.webp
    note: "ADB coordinates for bottom nav tabs on 1080x2400 device"

  - id: S2
    name: Open conversation detail
    do: "Tap a conversation item to open the detail page"
    expect:
      - kind: text_visible
        values: ["Summary"]
```

### Step fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique step ID (e.g., `S1`, `S2`) |
| `name` | yes | Short description |
| `do` | yes | Detailed action instructions |
| `verify` | no | If `true`, step is always verified on replay |
| `expect` | no | Expectations to check (`text_visible`, `interactive_count`) |
| `evidence` | no | Screenshots/artifacts to capture |
| `note` | no | Implementation details, coordinates, edge cases |

## Auto-explore

Discovers app screens by pressing every interactive element via BFS.

```bash
flow-walker walk --max-depth 3 --output-dir ./flows/ --json
flow-walker walk --dry-run       # snapshot without pressing
flow-walker walk --skip-connect  # use existing agent-flutter session
```

Safety: walk avoids destructive elements by default (`delete`, `sign out`, `remove`, `reset`, etc.). Customize with `--blocklist`.

## Snapshot & replay

After a successful run, `record finish` auto-saves a snapshot next to the flow YAML (`<flow>.snapshot.json`). Snapshots cache coordinates and timing for fast re-execution.

```bash
# On next record init, snapshot is loaded automatically
flow-walker record init --flow flows/login.yaml --json
# => {"id":"...","dir":"...","replay":{"mode":"replay","steps":{...}}}

# Manual save/load
flow-walker snapshot save --flow flows/login.yaml --run-dir runs/abc --json
flow-walker snapshot load --flow flows/login.yaml --json
```

When `replay.mode` is `"replay"`, agents use `replay.steps[id].center` coordinates for cached steps and only do full exploration for `replay.verifySteps` (steps marked `verify: true`).

## Verify modes

```bash
flow-walker verify flow.yaml --run-dir runs/abc --mode balanced --json
```

| Mode | Description |
|------|-------------|
| `strict` | All expectations must be met via automated checks |
| `balanced` | Default — some flexibility in matching |
| `audit` | Agent-attested — generates structure from events without automated UI checks |

## Hosted reports

Reports are hosted at [flow-walker.beastoin.workers.dev](https://flow-walker.beastoin.workers.dev).

```bash
# Push report
flow-walker push runs/abc --json
# => {"id":"abc","url":"https://flow-walker.beastoin.workers.dev/runs/abc","htmlUrl":"...","expiresAt":"..."}

# Fetch run data (JSON)
flow-walker get abc --json
curl https://flow-walker.beastoin.workers.dev/runs/abc

# View report (HTML)
open https://flow-walker.beastoin.workers.dev/runs/abc.html
```

Reports expire after 30 days. Re-pushing updates the expiry.

## run.json schema

The `verify` command produces `run.json` in `VerifyResult` format. The `report` command reads this format.

```json
{
  "flow": "conversations",
  "mode": "balanced",
  "result": "pass",
  "steps": [
    {
      "id": "S1",
      "name": "Verify home screen",
      "do": "Verify the home screen shows Conversations heading",
      "outcome": "pass",
      "events": [],
      "expectations": [
        {"kind": "text_visible", "values": ["Conversations"], "met": true}
      ]
    }
  ],
  "issues": []
}
```

Key fields: top-level `result` (not `status`), per-step `outcome` (not `status`).

## Agent-friendly design

- **Schema introspection** — `flow-walker schema` returns versioned JSON with typed args/flags
- **Structured errors** — `{code, message, hint, diagnosticId}` in JSON
- **Input hardening** — path traversal, control chars, URI format validated
- **TTY-aware JSON** — `--no-json` > `--json` > `FLOW_WALKER_JSON=1` > TTY auto-detect
- **Dry-run** — `--dry-run` resolves without executing
- **NDJSON streaming** — walk emits events as one JSON per line
- **Unique run IDs** — 10-char base64url, filesystem-safe, URL-safe
- **Agent-first URLs** — `/runs/:id` defaults to JSON; `.html` for humans
- **Exit codes** — 0 = success, 1 = flow failure, 2 = error

## Environment variables

| Variable | Description |
|----------|-------------|
| `FLOW_WALKER_OUTPUT_DIR` | Default output directory |
| `FLOW_WALKER_AGENT_PATH` | Path to agent-flutter binary |
| `FLOW_WALKER_DRY_RUN` | Enable dry-run mode |
| `FLOW_WALKER_JSON` | Force JSON output |
| `FLOW_WALKER_API_URL` | Custom hosted service URL |

## Architecture

```
src/
├── cli.ts              Entry point, arg parsing, dispatch
├── walker.ts           BFS exploration algorithm
├── record.ts           3-phase recording (init/stream/finish)
├── verify.ts           Event verification against flow expectations
├── reporter.ts         HTML report generation
├── push.ts             Report upload to hosted service
├── snapshot.ts         Save/load replay snapshots
├── event-schema.ts     Event type definitions and validation
├── flow-parser.ts      YAML → Flow object parsing
├── flow-v2-schema.ts   V2 flow schema and validation
├── agent-bridge.ts     Thin wrapper around agent-flutter CLI
├── fingerprint.ts      Screen identity hashing
├── graph.ts            Navigation graph
├── safety.ts           Blocklist evaluation
├── run-schema.ts       RunResult type and validation
├── yaml-writer.ts      YAML flow generation
├── migrate.ts          V1 → V2 flow migration
├── command-schema.ts   Command schemas for agent discovery
├── errors.ts           Structured error handling
├── validate.ts         Input validation
└── types.ts            Shared type definitions
```

Zero external runtime dependencies. Node.js built-ins only.

## License

MIT
