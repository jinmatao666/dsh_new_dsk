# Skill review sandbox

English | [中文](README.zh.md)

This reference describes the trusted sandbox manager and its disposable Linux execution containers. The [backend review API](../one-api/controller/skill_test_session.go) owns model calls, reviewer permissions, upload snapshots and transcripts. The manager has no model credentials and never executes uploaded scripts in its own process.

## Lifecycle and safety

An explicit “新建测试” click creates one container per review session. Multi-turn questions reuse that container; ending, stopping, execution limits or the configured deadline remove it. Closing the browser stops polling but does not immediately stop execution; the independent manager deadline still applies. Only pending public submissions accept new tests or turns. A changed upload invalidates the existing snapshot. Approved skills, publication and formal usage events are not modified by testing.

Execution containers run as UID 65532 with no network, no production mounts, no Docker socket, a read-only root filesystem, dropped capabilities and CPU/memory/PID limits. Uploaded skill files are root-owned and read-only; a sticky workspace directory prevents their replacement. Input and output are writable. File access rejects path traversal and symlinks. Shell commands can inspect the execution image but cannot access production directories or credentials through mounted files.

The manager mounts the host Docker socket and therefore has host-level authority. Its API is operator-configured, bearer-authenticated and not published on a host port. Uploaded code receives neither the socket nor that bearer secret. Docker shares the host kernel; this is not protection against container/kernel vulnerabilities. A separate Docker host or daemon is recommended when accepting highly untrusted code. Build runtime images only from trusted sources.

The manager retains up to 20 regular files from the output root, each at most 20 MB and at most 80 MB in total. Nested output directories are not exported. Artifacts remain in its named volume for the retention period, while inputs and process files disappear with the container. Database audit snapshots and transcripts have independent database retention. Manager restarts remove containers with the exact owned label, but cannot recover their tmpfs contents. Do not run two managers against the same Docker daemon.

## Configuration

Copy [.env.example](.env.example) to a private `.env` and replace the secret with at least 32 random characters. Do not commit it or print full resolved Compose configuration.

| Manager variable | Default | Meaning |
|---|---|---|
| `SKILL_TEST_RUNNER_SECRET` | required | Shared internal bearer secret |
| `SKILL_TEST_IMAGE` | `wanwei-skill-test-runtime:1` | Trusted execution template |
| `SKILL_TEST_SESSION_SECONDS` | `600` | Absolute lifetime, 60–3600 seconds |
| `SKILL_TEST_CONCURRENCY` | `2` | Global capacity, 1–20; one session per reviewer |
| `SKILL_TEST_MEMORY` | `2g` | Memory and swap limit per execution container |
| `SKILL_TEST_CPUS` | `2` | CPU quota per execution container |
| `SKILL_TEST_WORKSPACE_SIZE` | `1g` | In-memory workspace size |
| `SKILL_TEST_RETENTION_SECONDS` | `604800` | Output retention, at least 3600 seconds |

OneAPI needs `SKILL_TEST_RUNNER_URL=http://skill-test-runner:9080` and the same `SKILL_TEST_RUNNER_SECRET`. `SKILL_TEST_TOKEN_QUOTA` limits each turn’s temporary model token; its default is 1000000 existing quota units, with an allowed range of 1–100000000. `SKILL_TEST_RELAY_URL` optionally overrides the trusted chat-completion endpoint; the default is OneAPI’s own `127.0.0.1:$PORT/v1/chat/completions`, with port 3000 when `PORT` is absent. These values are never supplied by the browser or the uploaded skill.

The existing `DefaultModel` must name an enabled chat model with tool calling, available to the reviewer’s group and role. Calls use the normal model relay, quota and logs; the token name starts with `技能审核测试:`. Testing does not insert skill/expert usage events. OneAPI startup automatically migrates `skill_test_sessions`. A backend/frontend update and manager deployment are required; desktop installers are unchanged.

## Deployment tutorial

Prerequisites are a Linux test host, Docker with Compose, the existing `dsh-internal` network and access to the trusted build dependencies. The following commands run from this directory and deploy only the test manager and its runtime template:

```sh
install -m 600 .env.example .env
# Edit .env and replace the placeholder with a random shared secret.
docker build -f runtime.Dockerfile -t wanwei-skill-test-runtime:1 .
docker compose config --quiet
docker compose up -d --build skill-test-runner
docker compose exec -T skill-test-runner python3 smoke.py
```

The [Compose file](compose.yml) publishes no host ports. Keep the gateway’s public port 3300, OneAPI’s `127.0.0.1:13300 → 3000` mapping and all six expert URLs unchanged. Add the two runner variables through the existing OneAPI deployment procedure while preserving its complete environment and network configuration. Do not recreate OneAPI from an incomplete standalone `docker run` command.

The smoke test allocates and deletes only its own labeled test session. It verifies real execution, non-root identity, no external connectivity, immutable uploaded instructions, symlink rejection, output retention and container deletion. It consumes no model quota. Run it on a test host, not while reviewing live submissions. Then verify a pending upload through “测试”: attach a file, ask a task, reply to a clarification, download a real output, stop an executing task, and inspect the retained record after refreshing. Verify model logs have the test token label and formal usage totals remain unchanged.

## Limits and verification

The runtime template includes Python and common document/table/image libraries. Windows-only commands, Microsoft Office automation, external APIs and dependencies not installed in the image are unavailable. Testing accepts arbitrary uploaded skill types, but cannot guarantee that every skill is compatible with this Linux image. Missing capability is a visible test failure, not a successful review. Extend the trusted image outside test sessions when required.

Model replies are non-streaming; the page polls durable progress. Each turn permits at most 20 model requests, eight tool calls per response, 60 seconds per shell command, 128 KB command output, 2 MB model context and 4 MB execution events. Files are limited to ten inputs per turn, 20 MB each and 80 MB total. No automatic scoring, approval, batch test system or desktop capability clone is provided.

```sh
python3 -m unittest -v test_server
cd ../one-api
go test ./controller -run '^TestSkillTest' -count=1
cd web/air
npm test -- --watchAll=false --runInBand src/pages/SkillTest/index.test.js src/components/SkillReviewTable.test.js
```

Database tests need CGO and SQLite. Windows unit tests replace Docker calls and do not establish Linux-container acceptance. The real smoke test and a configured default-model review remain required before production use.
