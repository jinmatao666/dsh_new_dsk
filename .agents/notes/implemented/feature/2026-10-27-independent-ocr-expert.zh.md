# Agent Note: 独立OCR专家与显式配置失败

Status: implemented

[English](2026-10-27-independent-ocr-expert.md) | 中文

## Problem

新增OCR专家需要复用桌面到网站的身份与文件流程，但不应把专家业务写进DSH或OneAPI。视觉示例不能证明OCR能力，也不能在模型缺失时充当兜底结果。

## Decision

[OCR目录](../../../../expert-web/ocr-extractor/README.zh.md)独立持有网站、SQLite会话和任务、图像校验、子进程工作器、PaddleOCR适配器和可选文字整理模型、部署文件和复制的自有图标，不导入仓库或其他专家源码。页面区分展示示例、仅回环测试预览和真实认证任务。PaddleOCR接口未配置时拒绝提交，无效或截断的结构化输出不能发布成功结果。识别请求使用服务端PaddleOCR配置和图像内容；可选文字整理仅接收识别文本，不使用浏览器提供的凭据。

## Alternatives considered

把OCR嵌入平台会将独立部署的业务与目录服务耦合。通过相对导入复用其他专家会破坏目录迁出能力。模型失败时生成示例成果会隐藏部署缺陷，并错误地验证接入链路。

## Consequences

网站可以在确定真实模型前，通过测试替身验证身份、异步任务归属与下载。真实OCR仍依赖已部署的兼容PaddleOCR服务，自定义提取还需要配置文字整理模型；同时增加独立服务、依赖和数据卷的维护责任。支持现有环境HTTP不代表传输受保护，同源托管需要审查自有代码。取消阻止发布，不终止已经被远端接受的推理。

## Verification

本地Python测试验证真实测试HTTP和工作子进程成果、上传拒绝、票据复用、Origin、用户隔离、取消及完成记录持久化。Node检查覆盖相对路径、资源及示例与成果区分。无头Edge检查覆盖设置、示例隔离、导航及桌面/平板/手机布局。真实模型质量、平台票据核验、生产统计上报、Docker/Nginx部署和桌面原生下载仍需目标环境验收。

## Related image experts

独立的[目标检测](../../../../expert-web/image-object-detection/README.zh.md)与[变化检测](../../../../expert-web/image-change-detection/README.zh.md)工作台沿用相同的身份、任务归属、隔离工作器与下载边界，各自持有源码和数据卷。目标检测使用版本化SAM3 HTTP接口；精细结果必须有真实二值掩膜。变化检测先配准与补偿亮度，再提出差异候选，精细模式使用两期掩膜筛选，不将视觉差异解释为确定的语义原因。SAM3适配器需要单独安装官方环境和权重。测试替身验证成果和错误处理；真实GPU推理、正式票据、Docker/Nginx和原生下载仍需部署验收。
