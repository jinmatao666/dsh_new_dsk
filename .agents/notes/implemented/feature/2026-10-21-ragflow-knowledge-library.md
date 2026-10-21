# Agent Note: Server-owned RAGFlow knowledge library

Status: implemented

English | [中文](2026-10-21-ragflow-knowledge-library.zh.md)

## Problem

Desktop users need personal and shared document collections with department-aware access and isolated retrieval conversations. Sending the RAGFlow credential to the browser would let users bypass OneAPI authorization, while reusing one RAGFlow chat assistant would make dataset and model changes affect unrelated conversations.

## Decision

OneAPI stores knowledge bases, user or department grants, and conversation mappings. It keeps `RAGFLOW_BASE_URL` and `RAGFLOW_API_KEY` in the server environment and proxies dataset, document, assistant, session, completion, and related-question operations. Desktop list and document operations resolve the current user against ownership and grants before contacting RAGFlow: personal libraries stay with their owner, shared libraries require ownership or a user/department grant, published common libraries appear for every user, and offline shelves stay hidden. Administrators receive the full catalog on both the desktop list and the workbench routes.

The Wanwei desktop mounts an independent knowledge-base Client plugin through the product bundle. Its sidebar entry uses the same environment-specific administrator setting as Automation and Connectors. Desktop Q&A posts to `POST /api/knowledge-bases/:id/chat/completions` for the currently selected library. OneAPI authorizes that library, reuses or creates the caller's isolated RAGFlow assistant and session for the same user and knowledge base, then returns the answer and related questions. Opening a library loads prior turns from `GET /api/knowledge-bases/:id/chat/messages`, which reads the mapped RAGFlow session and returns plain-text user and assistant messages.

Answers are plain text: the RAGFlow assistant prompt forbids Markdown markup, and OneAPI strips residual Markdown before returning. Streaming Q&A uses `stream: true` on that completion route; the Host exposes `POST /api/desktop-knowledge-chat` so the desktop can render cumulative answer chunks instead of waiting for one final dump.

The knowledge-base feature flag is additive. Backend deployment parsing, the administrator form and desktop deployment validation default an absent `knowledgeBases` flag to true for each existing environment object, preserving explicit false and all existing flags. Null or non-boolean flags remain invalid. Public reads normalize the response without rewriting the stored option; administrator saves persist the complete object. This allows an older configured deployment to upgrade without a login-blocking 503.

## Alternatives considered

**Call RAGFlow from the browser:** rejected because it exposes the deployment API key and bypasses local user and department grants.

**Reuse one assistant per knowledge base:** rejected because model changes and `@` knowledge selection would mutate other users' active conversations.

**Client-only typewriter after a unary answer:** rejected for streaming UX because tokens still arrive only at the end; progressive display needs an authenticated Host SSE proxy of RAGFlow's stream.

## Consequences

OneAPI and the desktop plugin must be deployed together. RAGFlow failures do not create local knowledge-base records; a local create failure compensates the remote dataset. The desktop page supports creation, listing, document upload, selection with row highlight, move/copy into personal or shared libraries, RAGFlow-synced deletion, chunk-backed document preview, original-file download, isolated questions with restored session history, and recommendations. Local folder upload still stores each nested file in the current library; OneAPI forwards RAGFlow `parent_path`, renames the document to the relative path when RAGFlow accepts it, and also persists that path in local `KnowledgeDocumentPath` rows because RAGFlow list responses often return only the base file name. Document list responses merge those rows into `location` so the content pane can render an expandable folder tree. Move and copy download the source file and upload it into the authorized destination dataset (optional same-name keep or replace), then move deletes the source through RAGFlow `DELETE /api/v1/datasets/{datasetId}/documents`. After a successful upload, OneAPI returns the document metadata immediately and asynchronously calls RAGFlow `POST /api/v1/datasets/{datasetId}/chunks` with the new `document_ids`, so chunking starts without blocking the client. The workbench page at `/knowledge` manages tags, file lists, upload, chunk browsing via RAGFlow's paginated list-chunks API, manual re-parse, summaries, download, and deletion for common, shared, and personal libraries, and shows each library's owner so administrators can find user-created rows; grant editing stays on the administration API. Shelf visibility remains a server-side filter for desktop catalogs and is not toggled from the workbench UI.
