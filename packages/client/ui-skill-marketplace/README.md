# Skill Marketplace Client

English | [中文](README.zh.md)

This client plugin places the skill marketplace, Expert Library, connectors, and automations in separate desktop overlays. Marketplace entries come from the server catalog and locally installed skills. Expert cards appear only for published server profiles with workbenches shipped in the desktop build. Expert teams remain presentation-only.

Installed skill cards and detail pages expose a Use action. It opens the new conversation screen without a selected workspace; after the user picks a workspace, the client sends a prompt beginning with the installed skill's slash name. The prompt asks for missing task details before the skill proceeds.

The Use action also caches the skill's display name for the composer. The composer shows a compact inline label while retaining the slash identifier in the editable draft sent to the host.

The geology-analysis expert opens a workbench tab inside the Expert Library. Its left navigation exposes material intake, review, personal history, deliverables, and guidance. The form accepts GeoJSON, Shape ZIP, or a selected Shape component set and checks file extensions and the `.shp`/`.shx`/`.dbf` combination; the analysis skill checks polygon geometry and coordinate reference information. The workbench retains a draft while its tab stays open and discards it when the tab closes or the overlay unmounts.

The workbench distinguishes a running task, a completed task, and a failed task using the archived session result. History refreshes each listed task's status and supports local search and status filtering. Deliverables list only Word and Excel paths found in each task directory, with local open-file actions and filename/type filtering; the UI does not infer a percentage, area, map, or structured statistics from the model answer.

Starting an analysis first ensures that `market-gis-geology-analysis` is installed locally, obtaining it from the published skill catalog when absent. It then creates a separate task directory in the selected workspace, imports the source files, and invokes the skill through an archived Host session that does not appear in the ordinary conversation list. The workbench displays that session's actual model answer and marks a task complete only when both a Word report and Excel detail file exist in its directory. The personal task index is stored on this device under the authenticated username; it does not sync across devices, and deleting local data or the task directory makes history or outputs unavailable. The administrative related-skills field is descriptive metadata and does not change this fixed execution path.
