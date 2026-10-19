---
description: "Configure persistent local Wanwei tasks, execute them through ordinary Sessions, and inspect their real run records."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-automations

English | [中文](README.zh.md)

## Summary

Users can create local tasks, pause them, run them immediately and open their execution Sessions. Tasks and run records survive page closure and desktop restart. The desktop must remain running and logged in; missed schedules are not replayed. Administrator entry visibility remains effective, but the intranet label does not disable local scheduling. Model and task dependencies must actually be reachable; this package does not enable cloud scheduling.

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

The desktop shows only Host-saved tasks, with enabled/paused filters, editing and batch actions. Choose an existing Workspace or local folder and a local execution time. Confirming a new task saves and enables it; editing preserves its enabled state. Each run creates a fresh ordinary Session. Full access is on by default and skips approval prompts; switching it off uses workspace-write with approvals, which can leave unattended work waiting. Use only trusted tasks and working directories; ordinary conversation defaults remain unchanged.

The New menu offers manual creation, creation from a task, and templates. Creation from a task opens a new conversation with `帮我创建一个定时任务：` staged in the composer; it does not send a message or save a scheduled task automatically. Six office templates open editable drafts. Confirm the description, working directory and schedule before saving. Templates are not sample tasks in storage. Batch controls remain at the bottom of the page.

Creation controls use Lucide SVG icons rather than font characters. The chevron is centered inside a fixed-size trigger, and decorative icons stay out of accessible labels. The compact menu matches the entire split button's width with a two-pixel gap and retains its Escape and focus-leaving dismissal behavior.

The editor's upward-opening Workspace menu uses the same folder icon as the conversation picker and can extend outside the dialog without clipping. It supports search and the shared local folder picker, not manual path entry. Selection changes only the draft's path, not the active conversation or Workspace registrations; cancellation preserves it. The searchable model menu lists and checks concrete models from the Host catalog. An unconfigured draft initially selects the current default route and saves it explicitly; an existing task retains its selected route. Execution selects that route only for its Session, without changing the user's default. The permission panel carries the full-access warning and switch; the form has no enable checkbox, persistent approval note or message-push control. Run records remain filterable and open their Sessions.

Workspace and model searches retain automatic focus, filtering and Escape dismissal. Focus uses a subtle inset border on the complete search bar rather than a blue outline around its inner input.

Repeat, time and validity controls open above three equally sized fields. Supported recurrences are interval, once, daily, workdays, weekly, biweekly, monthly and yearly; saved Friday schedules remain supported. Intervals use positive whole minutes from the selected start date and time. Weekly and biweekly schedules retain the anchor weekday; monthly and yearly schedules retain the anchor day, clamping missing days to month end. Validity uses local calendar dates with an inclusive end date. A completed one-shot or exhausted validity range pauses automatically; enabling an exhausted schedule requires editing its dates. Public holidays are not interpreted.

Editor popovers retain an explicit link to their mounted trigger when rendered under the document body. Choosing a model, Workspace, permission, recurrence, time or date therefore keeps the feature page and draft open. Escape dismisses the popover; outside navigation and the page's Back control retain their normal closing behavior.

Empty task and run-record prompts are vertically centered in the remaining content area below the filters and table headings as the window resizes.

Each execution Session attaches to the selected Workspace and appears in its sidebar group as well as run records. A local folder is registered as a Workspace when execution starts. Startup does not archive Sessions; existing manually or previously archived Sessions remain archived. History filters reserve space between their labels and chevrons.

Every task receives generic prerequisite, scope and result-checking instructions plus a bounded top-level directory inventory. An empty directory is evidence, not an automatic failure: the model determines whether the task needs input files. Missing necessary inputs are reported as waiting; other unfinished work is incomplete. The model is instructed not to search unrelated directories or guess temporary paths. Full access remains full access; these instructions are not an OS filesystem restriction.

The Session-scoped automation_checkpoint tool saves prerequisite findings, stage summaries, real paths and next steps in the locked run ledger and Session log. Run records expose the latest progress. Completed Agent turns without a completed checkpoint are incomplete, not successful. File-producing tasks cannot drop their declared output requirement or complete without files. The Host checks canonical output paths inside the Workspace, regular nonempty readable files, and uses the desktop document helper to open DOCX, PDF and XLSX files; a missing parser fails verification. Other formats receive the basic file check, while semantic accuracy remains outside this guarantee. documentTool overrides DSH_DOCUMENT_TOOL; outputCheckTimeoutMs defaults to 60000 per file.

Open an interrupted or timed-out run's original Session to continue from its saved progress and process files. This is manual continuation, not automatic replay or a new scheduled run; continuing does not rewrite the original run's terminal status. Process files remain in the Workspace and are excluded from the final delivery list by the task instructions.

Task and record search expand in the header without adding a row; Escape clears and closes search. Ledger columns stay left-aligned and single-line, with truncated task names and horizontal scrolling on narrow windows. Clicking a linked row or pressing Enter/Space opens its Session. The delete icon requests confirmation and removes only a non-running record owned by the current account; tasks, Sessions and files remain. Running records cannot be deleted because they prevent overlapping executions.

The default task file is automations.json inside the Harness home. Reads are account-filtered; mutations use a file lock and atomic replacement. Invalid storage causes an explicit error instead of resetting tasks. Stop the desktop before repairing a damaged file or an abandoned sibling lock file; retain a copy before repair.

Disable this plugin's row to remove its entry; do not disable another business plugin as a substitute. Shared authentication, renderer and sidebar services remain provider-owned.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Client owns selections and notices, retrieves committed state through authenticated local RPC, and rejects obsolete polling responses after edits. It uses feature-panels for presentation and navigation. Its controller closes on sidebar navigation or logout.

The [Host runtime](src/runtime.ts) claims due slots durably before invoking the existing Session Controller. It advances the next occurrence before launch and prevents overlapping runs of the same task. Completed-turn records, not idle status alone, determine success; timeout, interruption and execution failures are recorded. Disposal stops the scheduler and cancels owned executions.

Desktop update shutdown is vetoed during initialization, due-slot claiming, scheduling and active execution, including post-turn output verification. Once the update Host freezes admission, new manual and scheduled runs cannot start. This protects the complete automation interval rather than only the agent's running status.

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

- Timezone changes follow the desktop's local clock; the scheduler does not retain a separate task timezone.
- No cloud execution or missed-slot recovery exists. Logout stops admission; timeout defaults to sixty minutes, including waits for task input. Stop remains available, and timeout records preserve progress with an explicit timeout reason.
- Records retain Session links, not independent artifact copies. Task deletion does not delete Sessions or working files.
- Account isolation uses the local login username; separate deployments require separate Harness homes.
- Real-model and native UOS/macOS/Windows acceptance remain deployment checks; automated integration tests script the external model response.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
