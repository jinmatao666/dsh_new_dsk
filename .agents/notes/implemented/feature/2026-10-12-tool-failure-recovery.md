# Agent Note: Cross-step tool failure recovery

Status: implemented

English | [中文](2026-10-12-tool-failure-recovery.zh.md)

## Problem

Models can resubmit identical invalid edits after clear errors, interleave reads that reset consecutive counters, and spend many requests checking an imagined discrepancy. A global failure count risks ending useful work and disabling transient retries.

## Decision

The [repeat-tool-reminder plugin](../../../../packages/guard/repeat-tool-reminder/README.md) owns optional recovery through tool pre/post-execute and agent lifecycle listeners. [Wanwei desktop](../../../../packages/bundle/wanwei-desktop/cordis.patch.yml) enables it; the official base remains advisory-only. No agent-loop or tool implementations change.

Each agent remembers bounded hashes of exact arguments and failures across intervening calls. Failed results receive logged, source-attributed coaching while original output stays intact. Structured foreground exit failures receive advice but are not classified as invalid arguments. After three identical confirmed argument failures, pre-execute denies only another unchanged call. Changed parameters remain executable. Exact success, human input and idle clear state. Cancellation and downstream post-policy blocks do not train the detector. The model can continue independent work; the plugin never concludes a turn.

Invalidity is limited to structured `INVALID_ARGS` and the established identical-edit error together with matching old/new arguments. Timeouts, permissions, missing files, dependency downloads and service outages do not prove unchanged arguments can never work. Hashes avoid retaining raw credentials in private state or repeating them in notices.

## Alternatives considered

**Stop after a total failure count.** Different failures can belong to independent work; progress can follow an error. This makes weaker models give up rather than recover.

**Consecutive reminders alone.** Intervening reads reset the chain and let the invalid call recur. Failure memory survives those reads.

**Block every repeated failure or rewrite inputs automatically.** External state can recover; changing credentials or commands automatically risks incorrect side effects. Only confirmed unchanged argument mistakes are suppressed, and arguments are never rewritten.

## Consequences

Recovery adds bounded state and corrective history for opt-in agents. It cannot establish semantic progress, catch arbitrary near-identical loops, guarantee obedience, or stop repeated proposals of denied calls. Loader tests cover interleaved reads, corrections, transient retries, isolation, eviction and disposal. A headless recorded-session scenario independently compares the edited workspace rather than trusting completion prose.
