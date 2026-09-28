# Meeting minutes expert (in development)

Automatic task polling redraws the page only on the first response or changed task data. It updates cached tasks without replacing an active preparation form. Responses from older requests cannot replace data from a newer successful request; manual result refresh uses the same ordering.

English | [中文](README.zh.md)

An HTTP 401 from task, preview or artifact requests locks the workbench and clears task/material caches. Late responses cannot restore the page; an artifact stream interrupted by expired login is cancelled before native saving. Close the Tab and reopen it from the desktop catalog to exchange a fresh ticket. These frontend checks do not revoke a provider-side job already submitted.

Original upload names label model materials and the Word report's source list. File reads and audio processing use numbered internal paths, never display labels. Task rows without original names retain their stored names; invalid source-label lists fail before document generation.

Compose pins the container's listening port to match its loopback-only port mapping; a different `PORT` in `.env` does not change it. Change the host side of `ports` for a different local proxy port, and configure the public HTTPS origin through `EXPERT_PUBLIC_URL`.

### Same-host Xinference ASR (Linux)

When Xinference listens at `127.0.0.1:20330` on the deployment host with model UID `Qwen3-ASR-1.7B`, copy `.env.xinference-local.example` to `.env` and fill in the platform ticket exchange, provider credential, public HTTPS origin, and separate minutes text-model configuration. The template selects `http://127.0.0.1:20330/v1/audio/transcriptions` with the multipart protocol. Leave `EXPERT_ASR_KEY` empty only if this local Xinference endpoint has no authentication; keep any real key out of Git.

Use `docker compose -f compose.local-xinference.yml up --build -d` on Linux. This host-network variant lets the container reach a loopback-only Xinference service while binding the workbench itself to `127.0.0.1:4303` for the HTTPS reverse proxy. The ordinary bridge-network `compose.yml` cannot reach a host service bound only to loopback. Run `docker compose -f compose.local-xinference.yml exec -T meeting python deployment.py`, then check `/healthz` and `/readyz`. Readiness validates configuration, not real ASR or text-model calls; exercise an actual recording before acceptance. Do not expose an unauthenticated Xinference port to the public network.

```bash
cp .env.xinference-local.example .env
chmod 600 .env
docker compose -f compose.local-xinference.yml config -q
docker compose -f compose.local-xinference.yml up --build -d
docker compose -f compose.local-xinference.yml exec -T meeting python deployment.py
curl -fsS http://127.0.0.1:4303/healthz
curl -fsS http://127.0.0.1:4303/readyz
```

## Standalone verification

Operators can run `python deployment.py` to check configuration and local processing dependencies. It prints check names and pass states, not secrets or endpoint addresses. `/healthz` checks HTTP and database availability; `/readyz` checks required configuration and returns 503 when it is missing. Readiness does not prove live remote connectivity. The Dockerfile includes a liveness check.

In an updated desktop expert Tab, artifact downloads use the native `save_expert_artifact` command to write to the user's Downloads directory. The limit is 128 MB; it accepts no local destination path and does not overwrite a same-name file. Normal browsers retain browser downloading. Byte forwarding and native saving have tests, but actual desktop clicks across platforms still require acceptance.

Run `python verify_portability.py` from this directory. It copies only this expert into a temporary location, excludes local data and credentials, creates a fresh virtual environment, installs its own dependencies and runs Python/Node tests. It reads no DSH root or other expert source. Node.js is required.

`python verify_portability.py --deployment` also requires Docker Compose configuration validation and image building. Missing Docker fails explicitly; unexecuted deployment checks do not count as passed. Container startup, HTTPS, live business endpoints and same-window desktop integration still require target-environment acceptance.

The workbench owns copies of its legacy icons and background. Task lists open details, and artifacts have a separate listing. Original filenames are task metadata only; server upload paths use internal numbers. Existing databases add the filename column without overwriting old records; records without original names display storage names. Visual acceptance for every state remains incomplete.

This project owns its independent webpage, HTTP service, SQLite sessions and tasks, audio normalization/transcription, model-generated minutes and final Word downloads. It imports no DSH, OneAPI or other expert source. Live model integration, actual container execution and legacy visual comparison are incomplete; do not publish it for production.

A task accepts at most one WAV/MP3/M4A recording plus multiple DOCX/PDF/Excel/UTF-8 text materials, or text materials alone. Limits are 30 files totaling 100 MB and a 60-minute recording. Audio becomes mono 16 kHz PCM WAV and is transcribed in 120-second chunks. Combined material and transcript input is limited to 60,000 characters; excess input is rejected, not truncated. Transcription failure publishes no partial minutes. Only the final `会议纪要.docx` is published; temporary normalized audio and segments are deleted after processing.

The meeting title is optional. The minutes model must preserve unknown fields and relative dates rather than invent facts. Users must verify figures, decisions, owners and dates. The Word file contains meeting-information and action-item tables with Chinese styling. Terminal tasks are retained 30 days by default and cleaned on service startup or new-task submission.

After a successful task, its page can display the actual model-generated minutes text through an owner-authenticated, length-limited summary endpoint. This private preview is not a second published artifact; only the final Word file is listed for download. The preview does not replace checking the Word document.

## Run and verify

Task details use the legacy compact status strip, summary/artifact column and source-information column. Summary preview recognizes headings, bullet/numbered items and pipe tables while escaping all text. Tables scroll within their own container; narrow windows stack source information below the summary. Browser downloads replace legacy local-directory operations because tasks belong to this independent server. These differences do not imply full legacy visual acceptance.

Identity exchange accepts only an object containing a nonempty string `user_id` of at most 180 characters. Invalid platform replies create no session and return 401. Sessions expire after eight hours; expired or forged cookies cannot read or submit tasks. A new exchange issues a different cookie and does not revive an expired cookie.

Use Python 3.13, install requirements.txt, then run `python -m unittest -v test_minutes test_server`. Audio tests invoke FFmpeg, while transcription and minutes text use explicit test substitutes; they do not prove live model quality. HTTP tasks fail explicitly without model configuration and do not create demo artifacts.

Inject variables listed in `.env.example` through a process manager and run `python server.py`; it does not load `.env` automatically. The minutes model uses HTTPS chat completions. ASR supports a multipart audio-transcription endpoint or native dashscope protocol; endpoint and model must be explicitly configured. Remote HTTPS ASR requires a key; only the same-host loopback Xinference deployment above may omit it when authentication is disabled. All keys remain server-side. The FFmpeg subprocess does not inherit model or platform credentials.

Container deployment uses the independent Dockerfile/compose.yml: copy the example to `.env`, configure it, and run `docker compose up --build -d`. Port 4303 binds locally by default; expose it through the HTTPS proxy in nginx.conf.example. Docker is unavailable locally and the container has not been built and run. Tasks have a 3,600-second deadline; timeout cleanup stops the whole process group. Operators must configure disk capacity, rate limits and backups, review the base-image digest and avoid multiple instances sharing the same data directory.

Cancellation now stops the local worker process tree without publishing partial minutes; remote ASR or model work already accepted may still continue on its server. Still missing: a real ASR/model end-to-end task, rendered Chinese Word review, full legacy icon/background and specialized-page comparison, user storage quotas and three-platform desktop Tab integration.
Navigation and record icons use the same site-owned SVG set. The usage guide uses an introduction banner and four instruction cards, retaining this expert’s input limits and review requirements. No runtime assets or styles are imported from another expert.
