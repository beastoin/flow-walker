# Flow YAML v2

## Contents

1. Core rules
2. Top-level fields
3. Step fields
4. Two-tier verification
5. Example

## Core Rules

Use only v2 flows.

Required:
- `version: 2`
- `name`
- `steps`
- For every step: `id` and `do`

Reject legacy action keys inside steps:
- `press`
- `fill`
- `scroll`
- `back`
- `adb`
- `wait`

Use `do:` instead. The parser rejects legacy keys when they are present.

## Top-Level Fields

Supported top-level fields:

| Field | Required | Notes |
| --- | --- | --- |
| `version` | yes | Must equal `2`. |
| `name` | yes | Flow name. |
| `description` | no | Free text. |
| `app` | no | App label. |
| `app_url` or `appUrl` | no | URL metadata. |
| `covers` | no | List of code paths or features. |
| `preconditions` | no | List of setup conditions. |
| `defaults.timeout_ms` | no | Metadata only. |
| `defaults.retries` | no | Metadata only. |
| `defaults.vision` | no | Metadata only. |
| `evidence.video` | no | Flow-level video preference. |
| `steps` | yes | Ordered step list. |

## Step Fields

Supported step fields:

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Must be unique. Keep it stable for replay and reports. |
| `name` | no | Human label. |
| `do` | yes | Action instruction for the agent. |
| `claim` | no | Overrides the report-facing statement for the step. |
| `anchors` | no | Strings that describe expected UI anchors. |
| `expect` | no | Tier 1 automated verification rules. |
| `judge` | no | Tier 2 agent verification prompts. |
| `evidence` | no | Step-level evidence requests, usually screenshots. |
| `note` | no | Agent note. |
| `verify` | no | Force this step into snapshot replay verification. |

### `expect`

Supported fields per item:

| Field | Required | Notes |
| --- | --- | --- |
| `milestone` | no | Matched against `assert.milestone`. |
| `kind` | no | Matched against `assert.kind`. |
| `outcome` | no | Metadata for the flow definition. |
| `min` | no | Threshold for numeric checks. |
| `values` | no | List for set or text checks. |

Use at least one of `milestone` or `kind` for meaningful verification.

### `judge`

Supported fields per item:

| Field | Required | Notes |
| --- | --- | --- |
| `prompt` | yes in practice | The review question. |
| `id` | no | Stable identifier for the check. |
| `screenshot` | no | Screenshot label without path resolution logic. |
| `look_for` | no | Positive cues for the reviewer. |
| `fail_if` | no | Negative cues for the reviewer. |

### `evidence`

Supported fields per item:

| Field | Required | Notes |
| --- | --- | --- |
| `screenshot` | no | Requests a screenshot artifact for the step. |

## Two-Tier Verification

`verify` builds `run.json` from the flow and streamed events.

Tier 1:
- Read `expect`.
- Match `assert` events by `milestone` or `kind`.
- Use `assert.passed` as the decisive boolean when a `kind` check exists.
- Mark the automated result as `pass`, `fail`, or `no_evidence`.

Tier 2:
- Read `judge`.
- Create pending agent prompts.
- Resolve each prompt with an `agent-review` event using `prompt_idx` and `verdict`.
- Mark the agent result as `pass`, `fail`, or `pending`.

Overall result:
- `fail` if any step fails.
- `unverified` if checks exist but all automated checks are `no_evidence` and all agent checks remain pending.
- `pass` otherwise.

Snapshot interaction:
- `verify: true` pins a step into `snapshot.verifySteps`.
- Without explicit `verify: true`, snapshot save falls back to first step, last step, and verify-only steps.

## Example

```yaml
version: 2
name: login-flow
description: Verify login reaches the home screen
app: Omi
app_url: https://omi.me
preconditions:
  - user-is-signed-out
evidence:
  video: false
steps:
  - id: S1
    name: Open login
    do: Open the login screen
    anchors: [Login, Email]
    expect:
      - milestone: login-visible
        kind: text-visible
        values: [Login, Email]
    evidence:
      - screenshot: step-S1
    verify: true

  - id: S2
    name: Submit credentials
    do: Enter valid credentials and submit
    claim: User reaches the home screen
    expect:
      - milestone: home-visible
        kind: text-visible
        values: [Home]
    judge:
      - id: home-shell
        prompt: Is the user on the home screen with the primary navigation visible?
        screenshot: step-S2
        look_for: [home content, bottom navigation]
        fail_if: [login form, error banner]
```
