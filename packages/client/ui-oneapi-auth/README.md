# @deepseek-ai/dsh-client-ui-oneapi-auth

Desktop-only dual-face plugin that authenticates a user against OneAPI on the
loopback Host, stores the generated token through DSH Credentials, and merges
one managed `llm-pi-ai` provider into native model settings. Its browser half
adds a full-window sign-in gate through `shell.overlay`; it never receives the
generated token.

## Model Experience

### No model-visible prompt changes

#### What the model sees

Nothing. This plugin contributes no system text, messages, tools, or results to a model request.

#### Token effect

None; the selected `llm-pi-ai` provider changes where requests are sent but contributes no prompt tokens.

#### KV Cache effect

None. Authentication and provider configuration do not modify prompts.

## Known Limitations and Deferred Work

- V1 supports username/password login only.
- Logout removes the local credential and managed provider; the generated
  server token remains available for OneAPI administrators to revoke.
- An unreachable server preserves a valid local credential and shows an
  offline gate instead of treating a network failure as logout.
