# Agent Note: Bounded large-file knowledge uploads

Status: implemented

English | [中文](2026-10-22-bounded-knowledge-uploads.zh.md)

## Problem

Knowledge uploads have a 20 MiB ceiling. Reading an entire file into a JavaScript number array and serializing that array through RPC multiplies memory use; raising that ceiling alone makes large selections unsafe. The reported MDB white screen is not reproduced and is not attributed conclusively to the size check.

## Decision

The desktop accepts files up to 1 GiB and sends sequential 1 MiB RPC chunks. The authenticated Host validates declared size, offsets and byte values, permits one active file, and spools it into a randomly named private temporary directory. Finalization requires the exact declared byte count and uses a file-backed Blob for multipart forwarding. Failure, completion, abort, idle expiry and awaited plugin disposal remove the spool. The idle interval is configurable through `knowledgeUploadIdleTimeoutMs`.

OneAPI allows the 1 GiB file plus bounded multipart framing, checks the actual file size, and removes multipart temporary files. RAGFlow multipart framing uses a small buffer and an `io.MultiReader` around the original source; only upload forwarding has a 30-minute HTTP timeout. Desktop errors leave the knowledge page mounted and its upload control usable.

## Alternatives considered

**Only increase the constants.** Whole-file JSON serialization and the server's whole-file multipart buffer would still multiply memory use.

**Send a single large request through the generic desktop HTTP bridge.** That bridge buffers request bodies and caps them at 300 MiB. Bounded knowledge RPC chunks avoid changing shared transport behavior.

## Consequences

Uploads require local temporary disk space and are sequential; resumable uploads across application restarts are not provided. RAGFlow or a deployment proxy can still reject a file, and their errors must remain visible. MDB parsing is not added. Original-file download, preview and cross-library transfer keep their independent 20 MiB limits. Process crashes can leave temporary files, unlike orderly disposal.

## Testing

Focused tests cover a file above 20 MiB, whole-file-read rejection, chunk ordering, incomplete finalization, 1 GiB metadata boundaries, idle expiry, authentication rejection, upstream failure and page recovery. Go tests exercise MDB multipart upload above the former limit and verify that the source is read only after HTTP dispatch. These tests use local/mock services, not a live RAGFlow deployment or the user's database file.
