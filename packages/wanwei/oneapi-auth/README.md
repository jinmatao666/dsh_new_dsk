# Wanwei OneAPI authentication

English | [中文](README.zh.md)

This private Host plugin migrates the proven OneAPI login, generated-token storage, server-governed model discovery, managed pi-ai provider, and default-model selection from the previous Wanwei desktop client. It targets the existing OneAPI deployment and does not require an image or database change.

The browser login surface is deliberately separate. This package keeps passwords and generated tokens on the loopback Host and exposes only authentication state and model identifiers to the desktop UI transport.

## Model experience

After authentication, the plugin replaces the Wanwei-managed pi-ai provider with only the models allowed for the current OneAPI account and selects the server default when available. The desktop Models section lists this server-managed catalog without provider-editing controls. Model requests continue through the standard DSH LLM provider to OneAPI's OpenAI-compatible endpoint.

## Limitations

The desktop requires a reachable OneAPI service to discover models. The product bundle disables the official editable Models section and DeepSeek adapter; model administration belongs to the server management console.
