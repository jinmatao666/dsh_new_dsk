# @deepseek-ai/dsh-desktop

Desktop-only patch layer composed after `dsh-base` and `dsh-web-app`. It keeps
the complete native plugin roster and adds the OneAPI authentication gate.

## Model Experience

### No model-visible prompt changes

#### What the model sees

Nothing. This assembly layer contributes no system text, messages, tools, or results to a model request.

#### Token effect

None; this bundle composes `llm-pi-ai` without contributing prompt content.

#### KV Cache effect

None; this bundle changes assembly only.

## Known Limitations and Deferred Work

- `DSH_ONEAPI_URL` is supplied by the desktop launcher from its packaged
  `server.json` resource.
- V1 does not compose an MCP service.
