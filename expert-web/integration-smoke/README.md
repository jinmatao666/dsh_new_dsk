# Expert website integration smoke site

English | [中文](README.zh.md)

This independent Node 22 website produces a verified report from a real text file to test platform tickets, user-record isolation, file handling and artifact downloads. It is not one of the six production experts. Sessions and tasks are in memory and disappear on restart, so this is not production task storage.

Run `node --test` in this directory. Inject variables listed in `.env.example` and run `node server.mjs`. A real deployment needs an HTTPS reverse proxy and a short-lived one-use platform ticket in `#ticket=...`. The page reads and immediately clears the URL fragment; its backend calls `EXPERT_PLATFORM_REDEEM_URL` to redeem the ticket. The provider credential remains server-side and must not enter the webpage or repository. Real login cannot be tested before the platform exchange endpoint is available. The guide's “检测桌面原生桥” action calls a read-only skill-list command without displaying the list, for an in-app child Webview check.

To verify portability, copy only `integration-smoke/` to an empty directory and run `node --test` and `node server.mjs`. No DSH root dependencies, scripts or assets are needed. Production use would also require persistent tasks, reverse-proxy security configuration and live platform integration.
