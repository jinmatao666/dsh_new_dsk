---
description: "Advisory loop-hygiene guard that nudges the model out of identical tool-call loops, for users and maintainers choosing, configuring, or debugging the plugin."
kind: "package-reference"
---

# @deepseek-ai/dsh-repeat-tool-reminder

English | [中文](README.zh.md)

## Summary

A model can get stuck calling the same tool with the same arguments — re-running a failing command, re-reading an unchanged file — burning time and tokens without making progress. `dsh-repeat-tool-reminder` notices the pattern and tells the model to stop: at chosen repeat counts it delivers a reminder to analyze the last result and either try a different approach or finish. The reminder is advice, never a block: a legitimate repeated call is delayed by nothing, and the decision to continue, change approach, or stop stays with the model. It tracks each agent separately, so one agent's loop never disturbs another's work, and a new user message clears the count. It ships enabled in the `dsh` base bundle with reminders at 3, 5, and 8 repeats.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin when the model should catch itself looping on identical tool calls. There is nothing to learn or wire: the `dsh` base bundle already runs it, and the defaults work for most sessions — tune the thresholds and tool scope below when you want the nudge sooner, later, or on fewer tools.

### When to choose it

Choose it when the model works autonomously for long stretches and a stuck loop is the failure you want to break with advice rather than force. Avoid it when identical repeats are legitimate and must run undisturbed — the guard only reminds, and a reminder is a small extra message after the repeated call — and when near-identical variants must be caught, because only exact repeats (same tool, same arguments regardless of property order) are detected.

### Setting the thresholds and scope

When you want to change when reminders fire or which tools they cover, mount the plugin with configuration:

```yaml
- name: '@deepseek-ai/dsh-repeat-tool-reminder'
  config:
    thresholds: [3, 5, 8]        # remind at 3, 5, and 8 consecutive repeats
    include: []                  # track every tool; list patterns to track only some
    exclude: [todo_write]        # never track these tools
    argumentsPreviewChars: 500   # cap on arguments shown in the detailed reminder
    failureRecovery: true        # cross-step recovery; default false
    invalidRetryLimit: 3         # unchanged invalid attempts allowed
    failureMemorySize: 128       # bounded failed-call identities per agent
```

| Field | Default | Meaning |
|---|---|---|
| `thresholds` | `[3, 5, 8]` | Repeat counts that trigger a reminder |
| `include` | `[]` | Only these tools are tracked; empty means every tool |
| `exclude` | `[]` | These tools are never tracked; calls to them neither count nor reset |
| `argumentsPreviewChars` | `500` | How many characters of the repeated arguments the detailed reminder shows |
| `failureRecovery` | `false` | Cross-step failure coaching and invalid-input suppression; enabled in Wanwei desktop |
| `invalidRetryLimit` | `3` | Invalid failures allowed before another unchanged call is denied; integer at least 2 |
| `failureMemorySize` | `128` | Maximum failed call identities per agent; integer at least 1 |

Invalid configuration fails at startup with a clear error — an empty `thresholds` list, a repeat count below 2, or a duplicate — never a silent change of behavior. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-repeat-tool-reminder) documents every accepted value.

### What you get

With `failureRecovery: true`, failed tools and structured foreground-process nonzero exits or timeouts receive corrective context without replacing original results. Failures remain remembered across intervening reads. Only identical calls confirmed as `INVALID_ARGS` or identical old/new edit text are denied after `invalidRetryLimit` failures. Changed arguments, transient errors, successful polling and other operations remain executable; the plugin never concludes a turn. Coaching asks the model to inspect evidence, correct necessary inputs, continue independent work and report a blocker only when an essential operation truly cannot proceed. Successful exact calls, new user messages and idle clear failure state; oldest entries are evicted at the memory bound. Private state retains hashes, not argument or error copies. Other profiles retain advisory-only defaults. See the [recovery decision](../../../.agents/notes/implemented/feature/2026-10-12-tool-failure-recovery.md).

With the defaults, a model that repeats the same call with identical arguments receives a short reminder on the third repeat — to analyze the previous result before calling again — and detailed reminders on the fifth and eighth, naming the tool and the repeated arguments so it can decide whether to change approach, gather more evidence, or finish. A new user message clears the count, so a fresh instruction is never treated as a loop. Reminders appear in the conversation after the repeated call's result, attributed to the plugin, so the model reads them like any other message.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the guard detects repeats and delivers reminders, and points at the code that realizes it; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The guard is built on four commitments:

- **Advisory by default.** Consecutive reminders do not block or rewrite calls; optional recovery denies only repeatedly invalid unchanged inputs before execution.
- **Count in post-execute.** Detection runs on `tools/post-execute`, which also fires for denied calls; counting there lets one listener cover every attempt with no cross-event state.
- **Exact-match canonicalization.** Arguments reach the guard as the loop's `JSON.parse` output (or its raw-string fallback), so JSON's value domain is the whole input domain and a deep key-sort plus `JSON.stringify` is a complete, deterministic identity — no bigint, cycle, or `undefined` handling exists because no input path can produce them.
- **Fail loud at load.** `thresholds` and `argumentsPreviewChars` validate in `apply` and throw, never falling back to defaults.

### Detection: the repeat chain

Each agent's chain is keyed by `(tool name, canonical arguments)` — two calls with the same tool and canonically identical arguments (property order ignored) count as consecutive, and a different tracked call resets the count to 1. The chain lives in a `WeakMap<Agent, Chain>`.

- **Untracked calls are transparent to the chain.** A call excluded by `include`/`exclude` neither increments nor resets the counter, so `grep X → todo_write → grep X` still counts as two consecutive `grep X` when `todo_write` is excluded — bookkeeping tools interleaved into a loop do not launder it.
- **Denied calls count.** Detection sits on `tools/post-execute`, which also runs for calls a `tools/pre-execute` listener denied; a model hammering a denied call is exactly the loop worth breaking.
- **Calls without an agent are ignored.** A direct `ctx.tools.execute()` caller has no model to remind and no live agent object to key on.
- **Per-agent keying, reset on user prompts.** One agent's repetition never trips another's reminder; a user prompt (`agent/pre-step`) deletes the submitting agent's chain, and object lifetime bounds the weak entry without a disposal listener.
- **In-memory only.** A session resumed from persistence starts with a fresh chain — the guard is a heuristic nudge, not a logged invariant, so reminders after a resume are the accepted cost.

### Reminder delivery

Reminders ride the post-execute decision's `additionalContexts` (source `{kind: 'plugin', plugin: 'repeat-tool-reminder', form: 'notice', summary: '<tool> × <count>'}`), never a `content` replacement: the `tool/result` event stays the tool's own output for audit. The loop buffers the context and appends it as an injected `user/message` after the step's tool results, which the session renders as a plain synthetic user message — model-visible, source-attributed, and reconstructable from the session log with no new session event. The guard always delegates via `next()` and prepends its reminder to the downstream decision's context array, so both decision variants (a blocked call included) still get the nudge while every entry retains its own source and metadata.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, fail-loud validation, chain listeners |
| [`src/failure-recovery.ts`](src/failure-recovery.ts) | Optional bounded failure memory, coaching and invalid-input suppression |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant: the chain is private to one post-execute listener) |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the tools waterfall to exhaustive configuration and the guard group map.

- [Tools subsystem reference](../../../docs/subsystems/tools.md) — the `tools/execute` waterfall, `additionalContexts`, and decision shapes this guard consumes.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-repeat-tool-reminder) — every accepted config field and its source declaration.
- [guard group map](../README.md) — the sibling guard packages and the loop-hygiene family.

-----

<a id="model-experience"></a>
## Model Experience

### First-threshold context message

#### What the model sees

At the first configured consecutive-repeat threshold, that agent receives the reminder below. No tool schema or normal-call text is added.

##### First-threshold reminder

```markdown
You are repeating the exact same tool call with identical arguments. Carefully analyze the previous result before calling again: if the task is not complete, try a different approach or different arguments instead of repeating the call.
```

#### Token effect

Zero tokens before the threshold. The reminder is retained history for that agent.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Later-threshold context message

#### What the model sees

A later threshold receives the detailed reminder template below. A capped argument preview ends exactly `… (+<omitted> more chars)`.

##### Later-threshold reminder

```markdown
Repeated tool call detected:
- tool: <toolName>
- consecutive_calls: <count>
- arguments: <canonicalArguments>
The repeated calls are not making progress. Do not call this tool with these exact arguments again. Inspect the latest result and choose a different action, different arguments, or finish the task if enough evidence has been gathered.
```

#### Token effect

Each reminder is retained history; `argumentsPreviewChars` bounds its data-dependent argument text, while agents keep independent counters.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Failure-recovery feedback

#### What the model sees

When recovery is enabled, failed calls receive the common notice below. Identical edits, repeated exact failures and related changed-argument failures append the corresponding notices. Suppressed invalid retries receive the final denial instead; the original earlier errors remain in history.

##### Common failure coaching

```markdown
工具执行失败不等于整个任务失败。先依据本次原始错误核对参数、路径、前置条件或执行结果，再选择一个针对原因的修正；不要把猜测当成事实。允许有依据的有限重试，但不要原样重复已确认无效的操作，也不要只改变无关参数。权限或安全策略拒绝时不得换工具绕过。已经正确的内容不要为了“修正”而改写；先比较实际内容，必要时只读取相关片段。继续能独立完成的工作，只有必需步骤确实无法推进时才说明具体阻塞和已完成部分，不得声称未验证的内容成功。
```

##### Identical edit coaching

```markdown
本次修改的新旧文本完全相同，文件没有因此发生修改。先逐字比较实际原文和目标文本；若内容本来正确，跳过修改继续任务；若确有差异，只提交包含真实差异的替换。不要凭显示效果猜测空格或字符，也不要重新抄写整个文件。
```

##### Repeated exact failure coaching

```markdown
这次调用与此前失败调用的参数和错误相同，中间的其他调用不代表问题已经解决。下一步应针对错误改变必要条件或有效参数，而不是再次原样尝试。网络或服务临时故障可在有恢复依据时重试；不要为了避免报错而提前放弃整个任务。
```

##### Related operation failure coaching

```markdown
同一工具的相关操作已反复报告相同错误，虽然参数不同，也需要核对是否真正修正了失败原因。先检查共同的前置条件或实际内容，再作针对性修正；不要只换无关参数，也不要仅凭错误次数判断整个任务无法完成。
```

##### Invalid retry denial

```markdown
相同参数已多次被工具确认无效，本次未执行。请依据此前错误修正参数，或核对是否确实需要这一步。不要换工具重复同一无效操作。其他步骤仍可继续，不要仅因这一步被拦截就结束整个任务。
```

#### Token effect

Corrective notices add retained history only after failures; successful calls add none. No raw argument or error copies are added to notices.

#### KV Cache effect

Append-only feedback preserves the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the guard is a poor fit. They are current package constraints, not a task backlog.

- **Exact-match detection only** — canonicalization is a deep key-sort, so near-identical variants (a tweaked path, extra whitespace inside a value) evade the chain; fuzzy matching is rejected pending evidence of need.
- **Compaction does not reset chains** — a chain spanning a compaction checkpoint keeps counting.
- **No general failure cutoff** — transient errors remain retryable; the plugin cannot determine whether every essential operation can proceed.
- **No subagent chain-sharing** — chains stay isolated per agent; a parent and its subagent repeating the same call never combine.
- **Legitimate idempotent polling still draws nudges** past the thresholds — the pressure valves are the `thresholds`/`exclude` config.
- **Past the highest consecutive threshold a chain goes silent** — optional recovery separately retains failed calls across steps while the agent remains active.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

The [repeat-tool-guard feature note](../../../.agents/notes/archived/feature/2026-07-08-repeat-tool-guard.md) records the original design and alternatives under the former package name; the [naming ledger](../../../.agents/notes/implemented/architecture/2026-08-11-repository-naming-contract-and-rename-ledger.md) records the rename to `repeat-tool-reminder` and its reason.

</details>
