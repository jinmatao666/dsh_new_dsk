# Independent expert websites

English | [中文](README.zh.md)

This directory contains independently buildable expert websites and one integration smoke site. The smoke site tests the protocol and is not a production expert. GIS capabilities are split into `coordinate-transform` (3307), `gis-format-converter` (3308) and `cad-redline-extractor` (3309), served under `http://ac.zjugis.com:3300/experts/<id>/`. Deployment hardening and visual acceptance remain open for several sites. Scope and delivery criteria are in [the expert web integration plan](../WANWEI_EXPERT_WEB_INTEGRATION_PLAN.md).

All nine production experts own copies of their legacy sidebar artwork and workbench backgrounds under `web/assets/`. The one-time `import-legacy-assets.mjs` is migration tooling, not a build or runtime dependency. Deployed sites do not read the old repository. Asset manifests record source names and hashes. Adding artwork does not complete visual acceptance.

Run `node --test test_frontend.mjs` in each expert directory for frontend regressions. They cover retained files and options on return from confirmation and file-order boundaries, but do not replace browser visual checks. Run `python -m unittest discover -p 'test_*.py'` for backend checks. GIS HTTP tests reject mismatched or duplicate Shape companions and mixed independent datasets before task creation.

Each child owns its own frontend, task backend, dependencies, tests and deployment configuration. The DSH desktop consumes only the published catalog, identity exchange and desktop bridge protocol; it imports no expert source.

`document-processing` owns extraction, directional document comparison, configured model summarization, persistent authenticated tasks, a workbench prototype and deployment configuration. Container execution, live model access and legacy visuals remain open; fixture-based summaries do not prove live model behavior.

`meeting-minutes` owns persistent authenticated tasks, audio normalization/transcription, configured minutes generation, final Word output, a workbench prototype and deployment configuration. FFmpeg normalization is locally tested. Live ASR/model integration, legacy visuals, rendered Word and deployment acceptance remain open.

`geology`, `third-survey` and `planning-review` each own a workbench, authenticated tasks, polygon parsers, GIS adapters, office/JSON reports and deployment configuration. Local protocol fixtures exercise real HTTP and Word downloads, but not production GIS. Legacy visuals, container execution and desktop embedding remain open.

`coordinate-transform`, `gis-format-converter` and `cad-redline-extractor` are the split GIS experts from the expert-web operations guide; each has its own cookie, Compose project name, data volume and `nginx.location.conf.example`.
