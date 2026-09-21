---
name: office-meeting-minutes
description: 会议纪要：将常见音频转换、分段转写，并结合会议材料生成结构化会议纪要。 当用户明确提出这类办公文件处理请求时使用。
---

# 会议纪要

## 当前能力

- 可基于 WAV、M4A、MP3 等语音、已有转写稿和常见办公材料生成会议纪要。
- 默认服务为 `http://ac.zjugis.com:20330/v1`：`Qwen3-ASR-1.7B` 通过 `/audio/transcriptions` 转写，`qwen3.8-27b-fp8` 通过 `/chat/completions` 生成纪要。配置 OneAPI 的 `/v1/audio/transcriptions` 地址时，技能使用标准 multipart 请求并把模型名交给后台动态路由；配置百炼原生 generation 地址时，技能自动把分段 WAV 编码为 Base64 JSON。
- 音频在本地统一转换为 16 kHz、单声道、16 位 PCM WAV，并按默认 120 秒切分后逐段串行转写，最后按原顺序拼接。可用 `--audio-segment-seconds` 或 `WANWEI_AUDIO_SEGMENT_SECONDS` 在 30–180 秒范围内调整。

## 执行与交互

1. 文字材料：`scripts/invoke.ps1 prepare --materials <文件...> --transcript <可选转写稿> --meeting-title <名称> --output-directory <目录>`。
2. 音频材料：`scripts/invoke.ps1 prepare --audio <音频> --materials <可选文件...> --meeting-title <名称> --output-directory <目录>`。脚本依次完成转写、内容整理和 Word 渲染。
   - `prepare` 必须作为前台命令执行并等待完成，不要设置 `run_in_background`，也不要改用 `job_output` 收集结果。这样最终的 `WANWEI_RESULT` 会直接发布唯一的会议纪要 Word 产物。
   - 非标准 WAV 的转换需要本机 `ffmpeg`。脚本会先检查；缺失时只请求一次安装或让用户安装，Windows 可使用 `winget install --id Gyan.FFmpeg -e`，安装完成后原样重试处理命令。
   - 长音频只允许逐段串行请求转写接口，不并发上传片段。任一片段失败时停止，并指出失败片段序号；不得跳过后继续生成不完整纪要。
3. 默认服务不要求密钥。经 OneAPI 调用时，通过 `WANWEI_TRANSCRIPTION_URL`、`WANWEI_TRANSCRIPTION_MODEL` 和 `WANWEI_TRANSCRIPTION_API_KEY` 提供 `/v1/audio/transcriptions` 地址、模型名和令牌。直接使用百炼原生接口时，URL 必须是 `/api/v1/services/aigc/multimodal-generation/generation` 地址，密钥也可通过 `DASHSCOPE_API_KEY` 提供。协议只由 URL 判断，不把密钥或模型写死在技能中。纪要生成服务继续使用 `WANWEI_MEETING_BASE_URL`、`WANWEI_MEETING_MODEL` 和 `WANWEI_MEETING_API_KEY`。任何密钥都不能写入技能包、命令记录或报告。
4. 责任人、期限、参会人未在材料中出现时必须写“未明确”。相对时间保留材料原文，不把“今天下班前”“周三开始”等表达转换成材料没有给出的具体日期或钟点。接口失败时报告原始原因和失败片段，不得伪造纪要。

## 输出样式

- 开头用信息表展示会议名称、时间、地点、参会人、记录人。
- 决策事项使用编号列表；待办事项必须使用“事项｜责任人｜截止时间｜状态”表格；风险单独成节。
- Word 使用 A4 纵向页面和正式会议材料版式：会议名称作为副标题，章节采用清晰的黑色层级，信息表与待办表按内容分配列宽，跨页待办表重复表头。
- 对话中只给执行摘要和最终会议纪要链接。音频转写 TXT 仅作为内部处理文件保留，不作为产物展示；无论输入是音频还是文字材料，都只交付最终 Word。Markdown、JSON、内部材料汇总和处理报告不得作为产物展示。
- 清楚区分“材料明确内容”和“未明确项”，不得补造会议结论。
## 运行依赖

执行处理脚本前检查 `requirements.txt` 中声明的依赖。只有依赖缺失时才运行 `python -m pip install --user -r <技能目录>/requirements.txt`；Workspace Write 模式拒绝该写入时，使用相同命令申请桌面端依赖安装审批。用户拒绝或安装失败时停止，安装成功后自动重试原处理命令。

## 通用约束

- 输入可以来自工作区外；先使用用户提供的绝对路径。技能安装目录视为只读，所有输出写入用户指定目录或输入文件旁的独立输出目录。
- 不修改、不删除、不覆盖输入文件。除批量重命名的确认执行外，所有产物都使用安全的新文件名。
- 只有命令成功且目标文件真实存在时才能声明完成。错误信息应包含失败文件、原因和下一步，不展示堆栈给普通用户。
- 最终回复先给结果摘要，再给主要产物链接，最后列出必要的限制或失败项。
