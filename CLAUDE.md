# CLAUDE.md — Working on flow-walker

## Publish rule

This repo is the **publish target** only. Source of truth is [`beastoin/autoloop`](https://github.com/beastoin/autoloop).
All code changes must go through autoloop's phase-gated build loop first, then get copied here for npm publish.
Do not edit this repo directly — add a new phase program in autoloop instead.

## Project overview

`flow-walker` is a Node.js CLI that auto-explores Flutter apps, executes YAML test flows, and generates HTML reports.
It builds on [agent-flutter](https://github.com/beastoin/agent-flutter) for all device interaction.

**Eight commands:**
- `walk` — BFS-explore the app, discover screens, generate YAML flows
- `record` — 3-phase recording: `init` → `stream` → `finish`
- `verify` — Verify recorded events against flow expectations, produce run.json
- `report` — Generate self-contained HTML report from run.json
- `push` — Upload report to hosted service, return shareable URL
- `get` — Fetch run data from hosted service by run ID
- `snapshot` — Save/load replay data for fast re-execution
- `schema` — Machine-readable command introspection

**Design principles:**
1. **agent-flutter as transport** — never touches VM Service or ADB directly
2. **Fingerprint by structure** — screen identity uses element types/counts, not text
3. **Safety first** — blocklist prevents pressing destructive elements
4. **Self-contained output** — HTML reports embed everything as base64
5. **YAML as contract** — flows are portable, readable, version-controllable

## Architecture

- `src/cli.ts` — entry point, arg parsing, subcommand routing
- `src/walker.ts` — BFS exploration algorithm
- `src/fingerprint.ts` — screen identity hashing
- `src/graph.ts` — navigation graph data structure
- `src/safety.ts` — blocklist evaluation
- `src/yaml-writer.ts` — YAML flow generation
- `src/agent-bridge.ts` — thin wrapper around agent-flutter CLI
- `src/flow-parser.ts` — YAML → Flow object parsing
- `src/record.ts` — 3-phase recording (init/stream/finish)
- `src/verify.ts` — event verification, VerifyResult schema, two-tier checks
- `src/reporter.ts` — HTML report generation
- `src/snapshot.ts` — save/load replay snapshots
- `src/run-schema.ts` — run ID generation
- `src/types.ts` — shared type definitions
- `src/errors.ts` — structured error handling (FlowWalkerError)
- `src/validate.ts` — input validation (paths, URIs, control chars)
- `src/command-schema.ts` — command schema for agent discovery
- `src/push.ts` — report upload to hosted service

## Build and test

```bash
npm install
npm test                    # all tests
npx tsc --noEmit            # typecheck
```

## Code conventions

- TypeScript ESM modules (`.ts` imports with explicit extension)
- Node built-ins only; no external runtime dependencies
- Node.js ≥ 22 with `--experimental-strip-types`
- Exit codes: 0 = success, 1 = flow failure, 2 = error

## Phase history

| Phase | Focus | Eval |
|-------|-------|------|
| 1 | walk: BFS explorer, fingerprinting, safety, YAML generation | eval.sh (19 gates) |
| 2 | run + report: flow executor, video/screenshots, HTML viewer | eval2.sh (25 gates) |
| 3 | Agent-grade: structured errors, schema, input hardening, run IDs | eval3.sh (41 gates) |
| 4 | Hosted reports: push command, Cloudflare Worker + R2 | eval4.sh (17 gates) |
| 5 | Landing page: live metrics, stats tracking | eval5.sh (14 gates) |
| 6 | Agent-friendly run data + app metadata | eval6.sh (13 gates) |

## What not to do

- Do not edit this repo directly — use autoloop
- Do not add external runtime dependencies
- Do not change exit code semantics
- Do not bypass blocklist safety checks
- Do not access VM Service or ADB directly (use agent-flutter)
