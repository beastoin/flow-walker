---
name: flow-walker
description: Execute E2E flow tests using flow-walker CLI. Covers 3 use cases -- (1) auto-discover app screens via BFS walk, (2) record, verify, report, and push a YAML flow with two-tier verification, (3) replay a flow fast using snapshots. Use when an agent must operate flow-walker against Flutter or macOS desktop apps through agent-flutter or agent-swift, must emit or consume structured JSON/NDJSON, must stream record events correctly, or must preserve replay data for fast reruns.
---

# flow-walker

## Start Here

- Require `node >= 22`, `flow-walker-cli >= 0.5.2`, and `agent-flutter-cli` in `PATH`.
- Pass `--json` on every `flow-walker` command. Parse JSON or NDJSON only.
- Treat exit codes as contract: `0` success, `1` flow failure, `2` error or unverified result.
- Query the live CLI surface before guessing: `flow-walker schema --json` or `flow-walker schema <command>`.
- Use positional `agent-flutter` commands: `agent-flutter press @e3`, `agent-flutter press 540 1200`, `agent-flutter screenshot path.webp`.
- Read [references/flow-yaml-v2.md](references/flow-yaml-v2.md) before writing or repairing a flow.
- Read [references/record-pipeline.md](references/record-pipeline.md) and [references/event-types.md](references/event-types.md) before streaming events.

## Use Case 1: Auto-Discover Screens

Use `walk` when the app structure is unknown and the goal is to generate starter v2 flows.

```bash
agent-flutter connect
flow-walker walk --skip-connect --output-dir ./flows --json
```

Use one of `--skip-connect`, `--app-uri`, or `--bundle-id` unless using `--name` to scaffold.

```bash
flow-walker walk --app-uri ws://127.0.0.1:12345/ws --max-depth 3 --json
flow-walker walk --bundle-id com.example.app --blocklist "delete,logout" --json
flow-walker walk --name login-flow --output ./flows/login-flow.yaml --json
```

Expect NDJSON events during exploration. The stream includes `walk:start`, `screen`, `edge`, `skip`, `log`, and a final `result`.

Use medium freedom here:
- Prefer `agent-flutter connect` plus `--skip-connect` for repeated runs.
- Use `--dry-run` to inspect reachability without pressing.
- Use `--agent swift` only when the target is desktop and `agent-swift` is the transport.
- Open [references/flow-yaml-v2.md](references/flow-yaml-v2.md) after generation to tighten assertions, judge prompts, and snapshot-friendly step IDs.

## Use Case 2: Record, Verify, Report

Use low freedom here. Follow the pipeline exactly:

```bash
INIT=$(flow-walker record init --flow ./flows/login.yaml --output-dir ./runs --no-video --json)
flow-walker record stream --run-id "$RUN_ID" --run-dir "$RUN_DIR" --json < events.jsonl
flow-walker record finish --run-id "$RUN_ID" --run-dir "$RUN_DIR" --status pass --flow ./flows/login.yaml --json
flow-walker verify ./flows/login.yaml --run-dir "$RUN_DIR" --mode audit --json
flow-walker report "$RUN_DIR" --json
flow-walker push "$RUN_DIR" --json
```

Apply these rules:
- Treat `record init` output as the source of truth for `id`, `dir`, `recipe`, and optional `replay`.
- Stream one JSON object per line. Prefer batching a whole step in one `record stream` call.
- Match the recipe exactly. Missing `assert` or `artifact` events produce `record finish` warnings.
- Use `passed: true|false` on `assert` events. Do not use `"pass"` or `"fail"` strings there.
- Include `command`, `element_ref`, `element_text`, `element_type`, and `element_bounds` on `action` events whenever possible. Snapshot replay depends on them.
- Run `verify` before `report` or `push`. `report` rejects non-v2 run data.

Read these files before executing the pipeline:
- [references/record-pipeline.md](references/record-pipeline.md) for recipe parsing, step batching, and exact command patterns.
- [references/event-types.md](references/event-types.md) for every event shape and field.
- [references/flow-yaml-v2.md](references/flow-yaml-v2.md) when a missing event warning points back to the flow definition.

## Use Case 3: Replay From Snapshots

Use snapshots to rerun known flows faster after at least one passing recorded run.

```bash
flow-walker snapshot load --flow ./flows/login.yaml --json
flow-walker snapshot save --flow ./flows/login.yaml --run-dir "$RUN_DIR" --json
```

Prefer the automatic path first:
- Run `record init --flow ... --json`.
- Inspect `replay.mode`.
- If `replay.mode` is `replay`, use the cached plan instead of rediscovering the UI.

Execute replay with medium freedom:
- For step IDs listed in `replay.verifySteps`, re-snapshot the UI and perform full verification work.
- For other steps, prefer cached `center` coordinates with `agent-flutter press X Y`.
- Fall back to `element_ref` or text/type matching when `center` is absent.
- Still stream normal events. Replay only changes how the action is found.

Treat `element_bounds` as mandatory for fast taps. Without them, snapshot replay falls back to slower rediscovery.

## References

- Open [references/record-pipeline.md](references/record-pipeline.md) for the full UC2 execution recipe.
- Open [references/flow-yaml-v2.md](references/flow-yaml-v2.md) for the v2 YAML contract and two-tier verification model.
- Open [references/event-types.md](references/event-types.md) for complete event payload guidance.
