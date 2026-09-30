# Land-use planning review expert (in development)

Automatic task polling redraws the page only on the first response or changed task data. It updates cached tasks without replacing an active preparation form. Responses from older requests cannot replace data from a newer successful request; manual result refresh uses the same ordering.

English | [中文](README.zh.md)

After a task is submitted to the worker, this site reports its stable task ID and redeemed user ID to the platform usage endpoint using its provider credential. Reporting retries do not duplicate a task; a telemetry failure does not stop the accepted task.

Active task details display elapsed time from the server's creation timestamp, updated once per second without redrawing the result. It is waiting duration, not a completion estimate or percentage. The timer stops when the page closes or login expires; reduced-motion users see a static progress indicator.

An HTTP 401 from task, preview or artifact requests locks the workbench and clears task/material caches. Late responses cannot restore the page; an artifact stream interrupted by expired login is cancelled before native saving. Close the Tab and reopen it from the desktop catalog to exchange a fresh ticket. These frontend checks do not revoke a provider-side job already submitted.

Model interpretation uses readable chapters with distinct conclusions, verification warnings, evidence labels and bold emphasis. Known layer and field codes display their Chinese names from the expert's terminology map; unknown codes remain unchanged. Technical record identifiers collapse into traceability details while business fields and original numbers remain visible. The complete escaped response remains available, including file lists and raw data. Model output cannot inject HTML or execute scripts. New tasks include the terminology map in result JSON and model evidence; the UI retains known geology names for earlier results. Units and grade meanings are never inferred by presentation.

`interpretation.py` owns this expert's HTTPS model adapter and domain-specific grounding rules. Tasks use current complete GIS records for interpretation and publish the model text separately in Word, result JSON and the webpage, without changing service statistics. Configure `EXPERT_MODEL_URL`, `EXPERT_MODEL` and `EXPERT_MODEL_KEY` on this expert's server. Missing configuration, oversized input, empty or truncated output fails the task before report publication. Readiness requires both GIS and model configuration. Local protocol/worker tests use explicit model substitutes and do not establish production model quality or complete visual parity.

Compose pins the container's listening port to match its loopback-only port mapping; a different `PORT` in `.env` does not change it. Change the host side of `ports` for a different local proxy port, and configure the public HTTPS origin through `EXPERT_PUBLIC_URL`.

## Standalone verification

The public website origin and platform redemption endpoint support HTTP and HTTPS. HTTPS remains recommended: HTTP exposes tickets, provider credentials, cookies and task data to interception or modification. Origin checks still include scheme, hostname and port; redemption refuses redirects. Upgrading from HTTPS-only code requires rebuilding the platform image and desktop package as well as redeploying this website. Existing HTTPS proxy examples remain usable; prior HTTPS-only wording is superseded by this support policy, not by a claim of encrypted HTTP.

Refreshing the same result task preserves the expanded input details and reading position. Opening another task resets the details to collapsed.

Preparation places advanced options below the input-file list, with separate data requirements and delivery guidance beside the form. Guidance does not imply successful output creation or coordinate conversion.

The preparation guide includes a site-owned copy of the legacy TerrainIllustration SVG contours. It is decorative, hidden from assistive technology and never represents uploaded geometry or service results.

The result page separates the state banner, service data and published output cards from the task-information sidebar. Narrow windows stack these regions. Only successful tasks expose output downloads; failure and cancellation preserve the recorded reason and allow a new task.

Failed and cancelled tasks explicitly state that no analysis result is available; they never display a pending-results prompt.

The result header offers manual refresh in addition to automatic polling. It reloads account-scoped tasks and invalidates the selected task's cached analysis preview after a successful response. Repeated refresh clicks are blocked while the request is pending; a failed refresh retains the existing data and allows retry.

Operators can run `python deployment.py` to check configuration and local processing dependencies. It prints check names and pass states, not secrets or endpoint addresses. `/healthz` checks HTTP and database availability; `/readyz` checks required configuration and returns 503 when it is missing. Readiness does not prove live remote connectivity. The Dockerfile includes a liveness check.

In an updated desktop expert Tab, artifact downloads open the native Save As dialog through `save_expert_artifact`. Only the user selects the destination and confirms replacement. Websites cannot supply local paths. The command validates bounded bytes (128 MB), filenames and unchanged supported extensions, returning the saved path or null on cancellation. Normal browsers use browser downloads; desktop interaction across platforms still requires acceptance.

Run `python verify_portability.py` from this directory. It copies only this expert into a temporary location, excludes local data and credentials, creates a fresh virtual environment, installs its own dependencies and runs Python/Node tests. It reads no DSH root or other expert source. Node.js is required.

`python verify_portability.py --deployment` also requires Docker Compose configuration validation and image building. Missing Docker fails explicitly; unexecuted deployment checks do not count as passed. Container startup, HTTPS, live business endpoints and same-window desktop integration still require target-environment acceptance.

The workbench owns copies of its legacy icons and background. Task lists open details, and artifacts have a separate listing. Original filenames are task metadata only; server upload paths use internal numbers. Existing databases add the filename column without overwriting old records; records without original names display storage names. Visual acceptance for every state remains incomplete.

This directory independently owns the web workbench, identity sessions, persistent SQLite tasks, geometry parsing, GIS adapter and artifact generation. It imports no DSH, OneAPI or other expert source. Live GIS, container execution, legacy visuals and desktop embedding are not accepted; do not publish it for production.

The service accepts one GeoJSON/JSON file, a Shape ZIP or one complete Shape group (.shp, .shx, .dbf, optionally .prj). It accepts polygon areas only and checks closed rings, finite numbers, record boundaries and counts. ZIP contents are read in memory, not extracted to user-selected paths. Limits are 100,000 coordinate points and 64 MB expanded ZIP data. Coordinates are preserved without reprojection; users and operators must verify the reference required by the analysis service. Successful upload does not establish correct coordinates.

The server explicitly configures EXPERT_GIS_URL as the full analysis endpoint. No legacy production address is built in, and the webpage cannot supply an arbitrary target. Existing internal HTTP services are allowed, but operators must provide a trusted network. The public website entry must use HTTPS. /Analysis.svc/OneKeyAnalysis uses review category 4 by default and enables planning analysis.

Successful processing generates real Word reports, Excel details, raw service JSON and Chinese result JSON. The result page reads that task's Chinese JSON for a bounded on-screen dataset preview; the complete files remain downloadable. Reports interpret mapped fields only; unmapped fields remain in the raw response with a verification warning. Reports do not invent conclusions. Layer area definitions are independent, and area units retain the service's original values without conversion. An empty dataset does not automatically mean no risk.

Create a Python 3.13 virtual environment in this directory, install requirements.txt, then run `python -m unittest -v test_geometry test_analysis`. Local tests use explicit service-response substitutes; they do not prove live availability, response compatibility or correct spatial conclusions. Before release, use an authorized test area for a real GIS request and verify raw results, units, coordinates and Office artifacts.

Still missing: complete legacy resources and specialized workbench fidelity, full field-mapping review, live GIS tasks, Chinese report rendering, actual container execution and same-main-window desktop Tab acceptance on three platforms.

## Service and deployment

Inject variables from .env.example through a process manager and run `python server.py`. The program does not load .env automatically; one instance exclusively owns the data directory. Container configuration belongs to this directory. After configuring .env, run `docker compose up --build -d` and expose it through the HTTPS proxy in nginx.conf.example. Pin the base image to a reviewed digest before release. Docker is unavailable on this machine; the container has not been built and run here.

Run `python -m unittest -v test_geometry test_analysis test_server`. HTTP tests start a separate local protocol service and exercise real network requests, processing subprocesses and file downloads to verify Word artifacts. This is not a production GIS connection. Tasks fail explicitly without an endpoint and do not generate demonstration results. Website requests cannot choose the service address.

Each task allows up to 30 files totaling 32 MB. Terminal tasks are retained for 30 days by default. Cancellation publishes no artifacts and stops the local worker process tree; an already accepted remote GIS request may still continue on its server. Linux timeout cleanup also stops the entire process group. Deployment requires disk monitoring, capacity limits, backups and request-rate limits.
The four navigation icons are site-owned copies of the original expert PNG artwork. The usage guide uses an introduction banner and four instruction cards, retaining this expert’s input limits and review requirements. No runtime assets or styles are imported from another expert.
