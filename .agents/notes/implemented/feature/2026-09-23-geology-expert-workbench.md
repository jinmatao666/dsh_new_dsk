# Agent Note: Geology expert workbench

Status: implemented

English | [中文](2026-09-23-geology-expert-workbench.zh.md)

## Problem

A chat-oriented skill can perform geology analysis, but a user who expects a guided expert page needs material intake, task history, and report access without an extra ordinary conversation entry. Administrators also need to control whether the expert appears without editing its execution code.

## Decision

The OneAPI expert roster contains only workbenches shipped with the desktop client. Administrators edit presentation metadata and publication state; the optional related-skills list is descriptive and never changes execution. The geology, third-survey current land use, and land-use plan review desktop tabs each have fixed intake, history, and results components. Before execution each workbench installs its fixed published skill when necessary: `market-gis-geology-analysis`, `market-gis-third-survey-analysis`, or `market-gis-land-use-plan-review`. Each run creates a dedicated directory and archived Host session, invokes only that expert's skill, and displays that session's answer, analysis-view data, and actual Word and Excel files. Every expert uses a separate per-user local task index.

The workbench renders running, completed, and failed states from the archived session and files. History reads each task's result; deliverables enumerate only files returned for that task. The design leaves maps, numeric statistics, progress percentages, and stage logs absent because this execution path does not provide verified values for them.

## Alternatives considered

**Upload arbitrary workbench pages through administration.** Each workbench needs reviewed input, execution, and result code, so unrestricted uploaded pages would break the relationship between a published card and a working analysis flow.

**Drive execution from the administrative related-skills field.** A metadata edit could silently change the task pipeline or bypass required preprocessing. The shipped workbench fixes the invocation instead.

**Create ordinary chat sessions for expert tasks.** That would add visible conversations for an interaction the user performs entirely inside the expert page. Archived sessions preserve the Host skill/model pipeline without cluttering the conversation list.

## Consequences

Publication and card text can change on the server without a desktop release, while a new workbench still needs a desktop implementation. Local history does not sync across devices and depends on the task directory and Host session remaining available. Completion requires both actual output files; a model answer alone cannot mark a task successful. The third-survey and planning workbenches reuse the geology interaction structure while keeping skill parameters, task directories, sessions, history, results, and publication entries independent.

## Office file expert extension

The file conversion and PDF expert fixes five official skills in its workbench: Word to PDF, PDF to images, PDF organizer, images to PDF, and image optimizer. The document intelligence expert independently fixes the document summary and document comparison skills. Both reuse a small task shell for file intake, archived sessions, real status evaluation, local history, and artifact opening, while retaining separate task indexes, directories, tabs, server roster entries, and skill choices. Uploaded source files are excluded from deliverables, and batch completion depends on the expected number of generated files. A document intelligence icon remains a centrally replaceable server-side presentation field until the formal asset arrives.
