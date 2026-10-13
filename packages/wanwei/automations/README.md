---
description: "Configure persistent local Wanwei tasks, execute them through ordinary Sessions, and inspect their real run records."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-automations

English | [中文](README.zh.md)

## Summary

Users can create local tasks, pause them, run them immediately and open their execution Sessions. Tasks and run records survive page closure and desktop restart. The desktop must remain running and logged in; missed schedules are not replayed. Existing entry visibility and intranet restrictions remain provider-owned; this package does not enable cloud scheduling.

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

The Wanwei desktop product mounts this plugin through its [composition patch](../../bundle/wanwei-desktop/cordis.patch.yml). Its [Host configuration](src/runtime.ts) controls storage, scheduler interval, lateness tolerance, execution timeout and retention limits.

The desktop shows only Host-saved tasks, with enabled/paused filters, editing and batch actions. Create a task with an existing absolute working directory and a local execution time. Enabling permits scheduled execution using the default model; immediate execution also works for paused tasks. Each run creates a fresh ordinary Session with workspace-write permissions; operations requiring approval still require human confirmation.

The New menu offers manual creation, creation from a task, and templates. Creation from a task opens a new conversation with `帮我创建一个定时任务：` staged in the composer; it does not send a message or save a scheduled task automatically. Six office templates open editable, paused drafts. Confirm the description, working directory, time and enabled state before saving. Templates are not sample tasks in storage. Batch controls remain at the bottom of the page.

The default task file is automations.json inside the Harness home. Reads are account-filtered; mutations use a file lock and atomic replacement. Invalid storage causes an explicit error instead of resetting tasks. Stop the desktop before repairing a damaged file or an abandoned sibling lock file; retain a copy before repair.

Disable this plugin's row to remove its entry; do not disable another business plugin as a substitute. Shared authentication, renderer and sidebar services remain provider-owned.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Client owns selections and notices, retrieves committed state through authenticated local RPC, and rejects obsolete polling responses after edits. It uses feature-panels for presentation and navigation. Its controller closes on sidebar navigation or logout.

The [Host runtime](src/runtime.ts) claims due slots durably before invoking the existing Session Controller. It advances the next occurrence before launch and prevents overlapping runs of the same task. Completed-turn records, not idle status alone, determine success; timeout, interruption and execution failures are recorded. Disposal stops the scheduler and cancels owned executions.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Product composition](../../bundle/wanwei-desktop/README.md) — profile ownership.
- [Authentication and network policy](../oneapi-auth/README.md) — shared services.
- [Independent page decision](../../../.agents/notes/implemented/architecture/2026-10-10-independent-wanwei-pages.md) — lifecycle and dependency rationale.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the ordinary Session Controller, the scheduler submits the user-authored task description while existing Agent and model providers own request assembly, tools and token consumption.

#### KV Cache effect

Each execution starts a fresh Session; this package does not reuse earlier task conversations or change the provider's cache policy.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only daily, Monday–Friday and Friday recurrences are offered; public holidays are not interpreted.
- No cloud execution or missed-slot recovery exists. Logout stops admission; timeout defaults to ten minutes, including waits for approval.
- Records retain Session links, not independent artifact copies. Task deletion does not delete Sessions or working files.
- Account isolation uses the local login username; separate deployments require separate Harness homes.
- Real-model and native UOS/macOS/Windows acceptance remain deployment checks; automated integration tests script the external model response.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
