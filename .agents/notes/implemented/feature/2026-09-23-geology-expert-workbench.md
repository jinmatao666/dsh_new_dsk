# Agent Note: Geology expert workbench

Status: implemented

English | [中文](2026-09-23-geology-expert-workbench.zh.md)

## Problem

A chat-oriented skill can perform geology analysis, but a user who expects a guided expert page needs material intake, task history, and report access without an extra ordinary conversation entry. Administrators also need to control whether the expert appears without editing its execution code.

## Decision

The OneAPI expert roster contains only workbenches shipped with the desktop client. Administrators edit presentation metadata and publication state; the optional related-skills list is descriptive and never changes execution. The geology expert's desktop tab has fixed intake, history, and results components. Before execution it installs `market-gis-geology-analysis` from the published skill catalog when necessary. Each run creates a dedicated directory and archived Host session, invokes that skill, and displays that session's answer and actual Word and Excel files. The task index is local to the authenticated username on one device.

The workbench renders running, completed, and failed states from the archived session and files. History reads each task's result; deliverables enumerate only files returned for that task. The design leaves maps, numeric statistics, progress percentages, and stage logs absent because this execution path does not provide verified values for them.

## Alternatives considered

**Upload arbitrary workbench pages through administration.** Each workbench needs reviewed input, execution, and result code, so unrestricted uploaded pages would break the relationship between a published card and a working analysis flow.

**Drive execution from the administrative related-skills field.** A metadata edit could silently change the task pipeline or bypass required preprocessing. The shipped workbench fixes the invocation instead.

**Create ordinary chat sessions for expert tasks.** That would add visible conversations for an interaction the user performs entirely inside the expert page. Archived sessions preserve the Host skill/model pipeline without cluttering the conversation list.

## Consequences

Publication and card text can change on the server without a desktop release, while a new workbench still needs a desktop implementation. Local history does not sync across devices and depends on the task directory and Host session remaining available. Completion requires both actual output files; a model answer alone cannot mark a task successful.
