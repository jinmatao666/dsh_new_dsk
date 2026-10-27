# Agent Note: PaddleOCR原始依据与SAM3图像专家

Status: implemented

[English](2026-10-27-paddleocr-sam3-experts.md) | 中文

## Problem

图像文字生成不能证明专门OCR识别，也不能交付真实检测与分割成果。独立专家需要可部署的图像服务接入，而不向Buddy或OneAPI加入图像业务逻辑。

## Decision

本说明补充[独立OCR说明](2026-10-27-independent-ocr-expert.zh.md)的图像服务接入；原有身份、归属及部署边界继续适用。

[OCR](../../../../expert-web/ocr-extractor/README.zh.md)调用官方PaddleOCR通用产线，保留识别原文与行级依据；可选Qwen只接收文字。[目标检测](../../../../expert-web/image-object-detection/README.zh.md)和[变化发现](../../../../expert-web/image-change-detection/README.zh.md)分别持有网站、会话、SQLite任务、子进程和数据卷，通过HTTP调用带版本的本机SAM3适配器，不导入兄弟专家源码。图像成果包含归一化xyxy坐标和真实PNG；精准模式必须使用与提交图片等尺寸的二值掩膜，畸形响应不得退化成伪造掩膜。

## Alternatives considered

把任意SAM3 HTTP服务视为可互换会掩盖输入和掩膜格式差异。让Qwen生成坐标或将差异矩形称为分割掩膜会错误描述真实推理。共享源码目录会破坏专家目录独立部署。

## Consequences

SAM3适配器在独立CUDA环境加载管理员提供的本地权重，串行执行推理。代码提交已记录，驱动兼容、显存与真实准确性仍需目标主机验收。变化发现保守配准后分析视觉差异，精准结果为SAM3掩膜与差异候选邻域交集，不识别变化原因，阴影、季节和视差可能误报。无结果明确呈现，模型失败不替换成成功示例。OCR现有任务存储和数据卷身份保留。

## Verification

HTTP替身覆盖三个真实工作子进程、成果生成、坐标验证、两图归属、服务缺失、畸形响应、空结果和配准拒绝。SAM3适配器测试不加载Torch，验证请求、Bearer鉴权和并发拒绝。Headless Edge覆盖检测及变化页面的测试身份、上传、结果图、下载入口、历史和手机溢出。这些检查不加载PaddleOCR/SAM3权重，也不证明真实Buddy票据、原生下载、CUDA性能或生产部署。
