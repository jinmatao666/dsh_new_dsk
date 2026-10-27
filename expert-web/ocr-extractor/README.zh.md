# OCR识别专家

[English](README.md) | 中文

本独立工作台通过管理员部署的PaddleOCR通用产线识别单张PNG/JPEG/WebP。Qwen只用于自定义文字字段提取，不接收图片。全文TXT、Markdown、JSON和CSV不依赖Qwen；Markdown按文字顺序导出，不还原复杂表格。成功任务同时保存OCR原文和结构化识别依据，字段整理结果需人工核对。

## 部署

将`.env.example`复制为私有`.env`，填写本专家提供方凭据、完整的`PADDLEOCR_URL`（POST `/ocr`）和可选`PADDLEOCR_KEY`。`EXPERT_MODEL_*`只用于自定义文字整理。本机回环HTTP可用，非回环HTTP引擎需显式设置`EXPERT_ALLOW_HTTP_ENGINE=1`。在本目录执行`docker compose -p wanwei-ocr-extractor build`和`docker compose -p wanwei-ocr-extractor up -d`；Dockerfile支持`PYTHON_IMAGE`和`PIP_INDEX_URL`下载源参数，不打包或提交真实`.env`。

Linux host网络监听`127.0.0.1:3315`，数据卷为`wanwei-ocr-extractor-data`。更新保留项目名、数据卷、旧镜像和私有配置；原有已完成记录可继续读取。网关路径为`/experts/ocr-extractor/`，Cookie为`expert_ocr_extractor_session`。更新不执行`down -v`。

## 引擎接口

POST JSON `{"file":"<base64图片>","fileType":1}`，可选引擎Bearer凭据。响应必须包含`result.ocrResults[0].prunedResult`及长度一致的`rec_texts`、`rec_scores`、`rec_polys`；多边形使用方向校正后的输入图像像素坐标。畸形响应、重定向、截断或文字整理失败不发布替代成果；无文字明确返回未识别到文字。参见[官方产线接口](https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/OCR.html)。

## 检查与限制

执行`python -m unittest -q test_ocr`、`node --check web/app.js`和`node --test test_frontend.mjs`。测试使用HTTP替身和真实工作子进程，不加载Paddle权重。生产验收需真实图片、Buddy票据、任务隔离、统计和原生下载。`/healthz`检查进程，`/readyz`只检查配置。输入上限10MB、2000万像素；页面示例不代表实际识别。取消阻止成果发布，不能撤回远端已受理请求。
