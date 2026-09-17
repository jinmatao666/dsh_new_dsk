# Agent Note: 按请求模型路由音频转写

Status: implemented

[English](2026-09-17-one-api-audio-model-routing.md) | 中文

## Problem

One API 在令牌鉴权、角色鉴权、渠道选择、计费和渠道模型映射阶段，把所有 multipart 转写和翻译请求都视为 `whisper-1`。因此，转发前会忽略调用方提交的 `model` 字段；即使配置了音频模型映射，发送给上游的请求仍保留未映射的模型字段。

阿里云百炼 `qwen-audio-3.0-asr-flash` 服务接收原生多模态 JSON，而不是[会议纪要技能](../feature/2026-09-01-desktop-skill-install-and-dependency-grant.md)使用的 OpenAI multipart 转写请求。通用音频转发即使按照已配置的模型选择了正确渠道，也无法满足供应商协议。

## Decision

可复用表单绑定把目标指针直接交给 Gin，使 multipart 音频请求保留调用方提交的 `model`。令牌与角色鉴权和渠道分发使用这个对外模型名。音频请求没有模型字段时，继续使用兼容默认值 `whisper-1`。

音频控制器使用请求模型计费，并在转发前应用渠道模型映射。映射改变模型时，控制器重建 multipart 请求体，只替换模型字段，保留音频字节、文件名、请求头和其他字段。

`AliBailian` 渠道明确选择供应商原生转写接口。控制器把 multipart 音频转换为 Base64 JSON，携带渠道凭据请求原生接口，再把供应商返回的文本转换为调用方请求的 OpenAI `json`、`verbose_json` 或 `text` 响应。其他渠道类型继续接收 OpenAI multipart 请求。

会议纪要技能根据配置的端点而不是模型名选择客户端协议。One API 的 `/v1/audio/transcriptions` 端点始终接收包含所选模型字段的 multipart；只有直连阿里云百炼原生 generation 端点时才接收 Base64 JSON。这样既保留直连供应商能力，也避免部署提供 One API 地址时绕过网关路由。

渠道与模型连通性测试读取已登记的模型类型。`audio` 模型使用程序生成的一秒 16 kHz 单声道 PCM WAV，按照已配置的转写协议探测，不再发送到聊天补全接口。该探测验证路由、凭据、请求转换和响应解析；由于合成音调不是语音质量样本，即使转写文本为空也视为连通成功。聊天模型测试保留现有请求路径。

## Alternatives considered

**为每个 ASR 模型登记 `whisper-1` 别名。** 未采用，因为鉴权和渠道选择会隐藏调用方实际请求的模型，上游 multipart 请求体仍包含不兼容的模型与协议。

**让每个技能直接调用供应商。** 未作为唯一部署方式，因为当部署选择网关端点时，凭据、供应商选择、审计、额度和模型权限应由 One API 管理。

**根据模型名或 URL 识别阿里云百炼。** 未采用，因为模型名和部署 URL 都可能变化。现有明确的 `AliBailian` 渠道类型负责选择供应商，并保证 OpenAI 兼容渠道不受影响。

## Consequences

ASR 客户端可以像文本请求一样，通过令牌、角色和渠道策略选择已配置模型。未提交模型的旧请求继续使用 `whisper-1`，OpenAI 兼容音频渠道继续使用 multipart 协议。阿里云百炼原生转写当前只返回纯文本类响应格式，并假定会议纪要流程已经提供规范化的 16 kHz 音频；该供应商路径暂不支持带时间戳的 `srt` 和 `vtt` 响应。
