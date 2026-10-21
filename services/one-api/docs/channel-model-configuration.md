# Channel-based model configuration

English | [中文](channel-model-configuration.zh.md)

## Reference

The model definition list supports all channels, one source channel, or unbound definitions. A definition with several sources appears in every matching channel filter. The source column shows the matched source only. Individual connectivity tests and Test current list pass the selected channel ID to the server, which excludes other sources before making test requests. With All channels selected, those tests retain the existing all-source behavior. Capability detection remains an all-source operation.

Single creation requires selecting a channel before selecting a model ID. The searchable model menu matches its input width and uses the channel's saved model names, not an upstream discovery response. Changing the channel clears the selected ID and display name. The server validates the submitted `source_channel_id` against the channel's current configuration before creating the definition. Existing API callers that omit that field retain their existing creation behavior; the general source-editing API remains unchanged.

The model page reads an unpaginated, administrator-only channel catalog containing IDs, names, configured model names and status. It does not include API keys. Switching back from channel configuration refreshes the catalog. Discovery failure does not prevent manually configured models from being selected, and inclusion in a configured list does not prove upstream authorization or successful inference.

## Batch creation

Select a channel, search its configured models and explicitly select entries. Select all and Invert affect matching selectable entries; selections outside the search remain unchanged. Entries already registered and bound to that channel cannot be selected. An existing definition missing that binding is selectable and marked as binding-only. Next opens per-model display name, type, context and billing-ratio review. Existing definitions are read-only in this review.

Each selected model is submitted separately to `POST /api/model_definition/from_channel`. A new definition, its default-group source and its two billing-ratio entries commit in one transaction. New definitions are disabled until explicitly enabled. A zero ratio means free usage and needs review before enablement. Existing definitions retain their metadata, ratios and other sources; only a missing binding is inserted. Repeating a completed request reports `skipped` without updating configuration. Registration performs no discovery, connectivity tests or vision probes.

The dialog retains success, skip and failure messages per model and retries only failed or unconfirmed entries. Requests time out after 30 seconds; timeout is an unknown outcome, not proof of rollback, and retry is safe against duplicate registration. Closing and changing the review are disabled while submissions run. A batch is not one transaction: successful items remain committed when another item fails. No routing aliases or automatic cost/speed policies are added. The existing single-edit save sequence and automatic vision detection remain unchanged.

## Verification

`ChannelModelTools.test.js` covers the actual model page and batch/picker interactions. `go test ./controller -run '^TestChannelModelRegistration$' -count=1` covers real Gin handlers and an isolated SQLite database, or a temporary PostgreSQL schema when `DSH_SKILL_INSTALLATION_TEST_POSTGRES_DSN` is supplied. Tests check source membership, default-disabled creation, safe repeats, preserved configuration, transactional rollback, the secret-free catalog and selected-channel-only connectivity against a local fake upstream. Never supply production credentials for testing.
