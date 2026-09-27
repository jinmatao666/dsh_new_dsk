# File conversion expert (in development)

Automatic task polling redraws the page only on the first response or changed task data. It updates cached tasks without replacing an active preparation form. Responses from older requests cannot replace data from a newer successful request; manual result refresh uses the same ordering.

English | [中文](README.zh.md)

An HTTP 401 from task, preview or artifact requests locks the workbench and clears task/material caches. Late responses cannot restore the page; an artifact stream interrupted by expired login is cancelled before native saving. Close the Tab and reopen it from the desktop catalog to exchange a fresh ticket. These frontend checks do not revoke a provider-side job already submitted.

Compose pins the container's listening port to match its loopback-only port mapping; a different `PORT` in `.env` does not change it. Change the host side of `ports` for a different local proxy port, and configure the public HTTPS origin through `EXPERT_PUBLIC_URL`.

## Standalone verification

Operators can run `python deployment.py` to check configuration and local processing dependencies. It prints check names and pass states, not secrets or endpoint addresses. `/healthz` checks HTTP and database availability; `/readyz` checks configuration and returns 503 when it is missing. Readiness does not prove live remote connectivity. The Dockerfile includes a liveness check.

In an updated desktop expert Tab, artifact downloads use the native `save_expert_artifact` command to write to the user's Downloads directory. The limit is 128 MB; it accepts no local destination path and does not overwrite a same-name file. Normal browsers retain browser downloading. Byte forwarding and native saving have tests, but actual desktop clicks across platforms still require acceptance.

Run `python verify_portability.py` from this directory. It copies only this expert into a temporary location, excludes local data and credentials, creates a fresh virtual environment, installs its own dependencies and runs Python/Node tests. It reads no DSH root or other expert source. Node.js is required.

`python verify_portability.py --deployment` also requires Docker Compose configuration validation and image building. Missing Docker fails explicitly; unexecuted deployment checks do not count as passed. Container startup, HTTPS, live business endpoints and same-window desktop integration still require target-environment acceptance.

The workbench owns copies of its legacy icons and background. Task lists open details, and artifacts have a separate listing. Original filenames are task metadata only; server upload paths use internal numbers. Existing databases add the filename column without overwriting old records; records without original names display storage names. Visual acceptance for every state remains incomplete.

This directory has no DSH, OneAPI or other expert source dependency. It contains a workbench prototype, HTTP service and real processing engine, but production resource isolation and legacy visual acceptance remain incomplete. Do not publish it for production.

## Implemented

- Merge PDFs and split them by page range or into individual pages.
- Convert PDF pages to PNG/JPG with selected pages and DPI.
- Combine images into PDF with original-size, A4, A3 or Letter pages, orientation and margins.
- Reduce images and convert PNG/JPG/WebP; transparent areas become white.
- Enforce page count, pixel count, batch count and option limits; write outputs to a new directory without overwriting other tasks.
- Redeem platform tickets, create separate website sessions, persist SQLite tasks, isolate users, upload files and download outputs.
- Queue one processing job, time out conversion subprocesses, mark interrupted jobs after restart and publish no outputs for cancelled jobs.

## Local verification

With Python 3.13, run from this directory:

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m unittest -v test_processors test_store test_server test_office
```

On Linux/macOS use `.venv/bin/python`. Tests generate and reopen actual PDFs and images without platform login or original-repository dependencies.

## Not yet completed

Legacy icons/background and visual comparison for all states, per-user disk quotas, actual container build and run, real LibreOffice conversion, live platform accounts and same-window desktop integration.

The image-to-PDF and image-optimization forms preview selected images locally using temporary object URLs. Removing a file or leaving the page releases its URL. The preview does not upload a file; submission sends the selected files to this expert service. All five tools have keyboard-accessible upload buttons, file ordering and removal controls.

Before submission, the review page shows the task name, ordered input files, processing parameters and expected output types. Expected outputs describe the requested operation, not a successful result; only completed server tasks expose actual output files. Returning to edit retains the selected files and parameters.

Result pages retain the workflow steps, task name, creation time and input count. A single legacy-style result container holds the server-reported state and actual output list; input parameters stay below it in collapsible task details. Unfinished or failed tasks have no download links. Unlike the legacy local workbench, this service does not expose its server task directory to the desktop file manager; users download the published outputs instead.

Empty history and output pages provide a new-task entry that opens the first tool, Word to PDF, matching the legacy workbench. History rows identify the task, creation time, input count, tool and server-reported state.

## Running the service

Inject variables listed in `.env.example` through the process manager and run `python server.py`; the program does not automatically load `.env`. One service instance must exclusively own the data directory and its queue. Restart marks unfinished tasks failed. The default listener is `127.0.0.1:4301`; an HTTPS reverse proxy must expose it, restrict request bodies to 45 MB and limit concurrent uploads and request rates. Tests inject a ticket redeemer; it is not a production login backdoor.

Cancellation hides task outputs and stops the local conversion process tree. On Linux a timeout also stops the process group; Windows uses taskkill for the process tree. Linux subprocess limits are 1 GB address space, 128 MB per file and 120 seconds CPU. The container limits are 1.5 GB memory and 2 CPUs. Completed, failed and cancelled tasks are retained 30 days by default and cleaned at startup or new-task submission. EXPERT_RETENTION_DAYS allows 1–365 days. Operators still need volume-capacity monitoring and backup; there is no per-user total storage quota.

## Container deployment (not run on this machine)

Copy `.env.example` to `.env`, configure real HTTPS addresses and server-side credentials, then run `docker compose up --build -d`. The standalone Dockerfile installs LibreOffice and Chinese fonts and runs as a non-root user. Compose binds only to a local port; `nginx.conf.example` gives the HTTPS proxy configuration. On the target server, inspect `docker compose config`, container logs, real Word conversion and backup restoration. Pin the base image to a reviewed digest before the first release.

`test_office` includes a real DOCX-to-PDF test; without soffice it explicitly skips and does not count as successful conversion verification. Run it where LibreOffice is installed and inspect text in the generated PDF.

Only the server may call `processors.convert` with its owned upload paths and a new task output directory; the browser cannot supply local paths. A failed conversion may leave partial files; the task service marks the task failed and publishes only successful outputs. Never return underlying exceptions, server paths or provider keys to the browser.

Word-to-PDF conversion uses LibreOffice on the independent server, not Word/WPS on the user's computer. The webpage and deployment instructions must disclose this difference. Review PyMuPDF licensing and commercial deployment rights before production use.
Navigation and record icons use the same site-owned SVG set. The usage guide uses an introduction banner and four instruction cards, retaining this expert’s input limits and review requirements. No runtime assets or styles are imported from another expert.
