# Knowledge base PDF covers

Status: implemented

English | [中文](2026-11-16-knowledge-pdf-covers.zh.md)

OneAPI queues PDF covers after upload or transfer. A database lease lets a worker resume interrupted jobs without allowing an expired worker to overwrite the current result. Poppler renders only page one, and the completed JPEG is stored under the knowledge base and document IDs. The desktop fetches the image after the list reports it ready. The cover endpoint checks library access and paid preview eligibility before serving the image.

The OneAPI container includes Poppler. Standalone deployments need `pdftoppm` on the server process's PATH. Historic files with no cover job use the placeholder.
