# Agent Note: Bundle One API tokenizer data for offline startup

Status: implemented

English | [中文](2026-09-17-one-api-offline-tokenizer-cache.zh.md)

## Problem

One API initializes the GPT-3.5, GPT-4, and GPT-4o token encoders before opening its HTTP listener. The tokenizer library downloads missing BPE data during that initialization, so a fresh container can remain unavailable indefinitely when the deployment host cannot reach the public encoding service.

## Decision

The One API runtime image contains the `cl100k_base` and `o200k_base` BPE files under `/opt/tiktoken-cache` and sets `TIKTOKEN_CACHE_DIR` to that directory. The cache filenames are the SHA-1 keys expected by `tiktoken-go`, while the checked-in contents retain the upstream SHA-256 values. Startup therefore loads both encodings from the image without network access.

## Alternatives considered

**Download the encodings during container startup.** Rejected because service availability would still depend on an external host before the HTTP listener exists.

**Download the encodings during each image build.** Rejected because deployment builds would acquire a new external dependency and could fail or change independently of the source archive.

**Initialize the encoders asynchronously.** Rejected because requests could reach token-counting paths before their required encoders exist.

## Consequences

The source archive and runtime image include about five megabytes of tokenizer data. Fresh containers start consistently on restricted networks, and tokenizer updates require deliberately replacing the bundled files and verifying their upstream checksums.
