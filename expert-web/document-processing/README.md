# Document processing expert (in development)

Automatic task polling redraws the page only on the first response or changed task data. It updates cached tasks without replacing an active preparation form. Responses from older requests cannot replace data from a newer successful request; manual result refresh uses the same ordering.

English | [中文](README.zh.md)

An HTTP 401 from task, preview or artifact requests locks the workbench and clears task/material caches. Late responses cannot restore the page; an artifact stream interrupted by expired login is cancelled before native saving. Close the Tab and reopen it from the desktop catalog to exchange a fresh ticket. These frontend checks do not revoke a provider-side job already submitted.

Compose pins the container's listening port to match its loopback-only port mapping; a different `PORT` in `.env` does not change it. Change the host side of `ports` for a different local proxy port, and configure the public HTTPS origin through `EXPERT_PUBLIC_URL`.

## Standalone verification

The public website origin and platform redemption endpoint support HTTP and HTTPS. HTTPS remains recommended: HTTP exposes tickets, provider credentials, cookies and task data to interception or modification. Origin checks still include scheme, hostname and port; redemption refuses redirects. Upgrading from HTTPS-only code requires rebuilding the platform image and desktop package as well as redeploying this website. Existing HTTPS proxy examples remain usable; prior HTTPS-only wording is superseded by this support policy, not by a claim of encrypted HTTP.

Operators can run `python deployment.py` to check configuration and local processing dependencies. It prints check names and pass states, not secrets or endpoint addresses. `/healthz` checks HTTP and database availability; `/readyz` checks required configuration and returns 503 when it is missing. Readiness does not prove live remote connectivity. The Dockerfile includes a liveness check.

In an updated desktop expert Tab, artifact downloads use the native `save_expert_artifact` command to write to the user's Downloads directory. The limit is 128 MB; it accepts no local destination path and does not overwrite a same-name file. Normal browsers retain browser downloading. Byte forwarding and native saving have tests, but actual desktop clicks across platforms still require acceptance.

Run `python verify_portability.py` from this directory. It copies only this expert into a temporary location, excludes local data and credentials, creates a fresh virtual environment, installs its own dependencies and runs Python/Node tests. It reads no DSH root or other expert source. Node.js is required.

`python verify_portability.py --deployment` also requires Docker Compose configuration validation and image building. Missing Docker fails explicitly; unexecuted deployment checks do not count as passed. Container startup, HTTPS, live business endpoints and same-window desktop integration still require target-environment acceptance.

The workbench owns copies of its legacy icons and background. Task lists open details, and artifacts have a separate listing. Original filenames are task metadata only; server upload paths use internal numbers. Existing databases add the filename column without overwriting old records; records without original names display storage names. Visual acceptance for every state remains incomplete.

This project independently owns its workbench, identity sessions, persistent SQLite tasks, text extraction, summaries and version comparison. It imports no DSH, OneAPI or other expert source. Live model integration, actual container execution and legacy visual acceptance remain incomplete; do not publish it for production.

Supported inputs are DOCX, PDF, XLSX, XLSM and UTF-8 TXT/Markdown/CSV/TSV/JSON/YAML. DOCX retains paragraph and table order. Excel reads saved values without running macros or calculating formulas. A scanned PDF without text is rejected with OCR guidance. Limits are 200,000 characters per material, 300 PDF pages, 100,000 Excel cells and 64 MB decompressed XML package data.

Comparison is directional: the first file is the original and the second is the new version. Outputs include real DOCX, line-by-line HTML, Markdown and JSON. Layout, images, comments and tracked edits are not compared.

Task workers pass original upload names as display-only source labels to summaries and comparisons. Model prompts and downloaded reports retain those names; file reads use internal numbered paths. Legacy task rows without original names use their stored names. Invalid source-label lists fail before output publication.

The comparison form retains the legacy scope and additional-requirements fields. Non-empty requirements use the server's configured model to analyze both complete versions, up to 60,000 combined characters. Model analysis is labeled separately in the webpage, DOCX, Markdown and JSON and never changes deterministic difference counts. Missing model configuration or failure fails the task without substitute analysis. Leaving both fields blank requests exact text differences only.

Summaries call a server-configured HTTPS OpenAI-compatible chat completions endpoint via EXPERT_MODEL_URL, EXPERT_MODEL and EXPERT_MODEL_KEY. Desktop model tokens are not reused and the webpage receives no key. Missing configuration, model failure or truncated output fails explicitly without generating a demo report. Summary materials have a combined 60,000-character limit; larger input is rejected, not silently truncated. Production must choose a model with sufficient context.

From this directory, run:

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m unittest -v test_processors test_summary test_store test_server
```

Summary tests inject explicit model responses. They verify prompting, source references and file creation, not live model quality or network access.

## Independent service and deployment

Task result pages use the legacy workbench's single state-and-output container, workflow steps and task heading. Comparison statistics and color-coded added/deleted/modified paragraphs remain inside it, with at most 100 changes previewed; the full files remain downloadable. New model analysis stays separate from deterministic counts. Parameters are retained in collapsible details below the result, and unfinished or failed tasks publish no download links. A remote server task directory is not exposed as a local desktop path.

Summary previews use the legacy level-two-heading sections and line rendering for paragraphs, headings and bullets. A level-three heading stays within its section. Raw HTML is escaped and Markdown links are not activated; downloaded files preserve the full generated content. Previews are limited to 30,000 characters and disclose truncation.

History rows identify the task type as well as its name, time, input count and state. Empty history and output pages offer a new-task button that opens document summary preparation, matching the first-tool entry in the legacy workbench.

Inject configuration from `.env.example` through environment variables and run `python server.py`; it does not automatically load `.env`. For containers, copy the example to `.env`, configure it and run `docker compose up --build -d`. Run one service instance only and use the HTTPS proxy in `nginx.conf.example`. Docker is unavailable locally; containers have not been run. Pin the base-image digest before release.

A task allows up to 30 files totaling 32 MB; summarization further limits input to 10 files. The expert owns its task data; it does not write platform conversations. Its subprocess receives configured model parameters via standard input and does not inherit platform provider credentials. Cancellation publishes no results and stops the local worker process tree; a remote model request already accepted may continue on its server. Linux timeout cleanup also stops the whole process group. Terminal tasks are retained for 30 days and cleaned on startup and new-task submission. Operators need disk monitoring, capacity limits and backups. HTTP tests cover webpage options, directory ownership, account isolation and real comparison-file downloads.
The four navigation icons are site-owned copies of the original expert PNG artwork. The usage guide uses an introduction banner and four instruction cards, retaining this expert’s input limits and review requirements. No runtime assets or styles are imported from another expert.
