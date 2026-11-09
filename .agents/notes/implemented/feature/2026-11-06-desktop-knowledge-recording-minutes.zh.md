# Agent Note：桌面知识库录音纪要

Status: implemented

[English](2026-11-06-desktop-knowledge-recording-minutes.md) | 中文

## 问题

个人桌面知识库需要应用内麦克风采集，产出可列表的音频与双栏逐字稿 / 速览 / 纪要预览（含播放），入口与本地文件、网页链接并列。仅依赖浏览器 Web Speech 字幕在桌面 Electron 上不可靠，保存后常出现空逐字稿与「未捕获实时转写」。

## 决策

个人库上传菜单打开浮动 `RecordingPanel`，经 `MediaRecorder` 录音（最长 20 分钟），Client 转成单声道 16 kHz WAV，再 POST 到 Host `/api/desktop-knowledge-recording-minutes`。Host 代理 OneAPI `/v1/audio/transcriptions`（配置 `knowledgeTranscriptionModel`）与可选 `/v1/chat/completions`（`defaultModel`）填写逐字稿 / 速览 / 纪要；聊天不可用时用本地问候启发式回退；随后上传 `录音纪要_….md` 与 `录音纪要_….wav`。OneAPI 对音频扩展跳过 RAGFlow 解析，WAV 仅供播放、不出现解析失败。打开任一配对文件进入 `MinutesViewer`。Web Speech 仅在 ASR 为空时作为字幕回退。

## 曾考虑的方案

**仅上传 Markdown + 浏览器 Web Speech。** 桌面空转写回归后否决为唯一路径；ASR 须在已配置 OneAPI 模型的 Host 执行。

**在知识库页嵌入会议纪要专家站。** 否决；专家站须可独立部署，且不得导入 DSH Client 包。

**只上传音频并依赖 RAGFlow 音频解析出全文。** 否决；本部署对音频解析失败或不可用，故上传前写好 Markdown，并对音频跳过解析。

## 后果

录音纪要沿用[桌面知识库仅个人库可上传](2026-11-06-desktop-knowledge-upload-personal-only.zh.md)的个人库门禁。浮动录音器挂在 `.dsh-knowledge` 内，以免 FeaturePanel 外点导航误关。麦克风权限由 OS / 桌面壳管理。部署须通过 `knowledgeTranscriptionModel` 提供可用转写模型。Client / Host 测试覆盖菜单入口、打包辅助、双栏打开、问候启发式与 multipart 字段校验。
