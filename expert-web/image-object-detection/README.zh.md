# 目标检测专家

[English](README.md) | 中文

本独立Buddy专家接受一张图片和简短目标名称，调用版本1的SAM3 HTTP适配服务，导出真实标注PNG和相对坐标JSON。精准模式必须返回二值PNG掩膜，另导出`mask.png`；缺少掩膜不会用矩形冒充。未检出是明确的空结果。常见中文类别可本地转换，其他中文短语需要配置文字翻译模型，英文目标不依赖Qwen。

## 部署

代码和已复制资源均由本目录持有。将`.env.example`复制为私有`.env`，填写本专家提供方凭据、完整POST端点`SAM3_URL`及可选`SAM3_KEY`。`EXPERT_MODEL_*`只用于中文目标翻译。配套适配器为[inference/sam3_http.py](inference/sam3_http.py)，在单独安装的官方SAM3 CUDA环境中运行，并指定本地`SAM3_CHECKPOINT`。本机端口默认3321，使用前确认空闲；不自动下载权重，也不承接Buddy登录。

执行`docker compose -p wanwei-image-object-detection build`和`docker compose -p wanwei-image-object-detection up -d`；下载源由构建参数`PYTHON_IMAGE`、`PIP_INDEX_URL`指定。host网络、`127.0.0.1:3313`、数据卷`wanwei-image-object-detection-data`、网关`/experts/image-object-detection/`、Cookie `expert_image_object_detection_session`。不加载仓库根目录或兄弟专家源码；更新保留项目名和数据卷。

## 版本1推理接口

POST `/segment`：`schema_version:1`、`image`（base64 PNG）、`text`（英文目标）、`boxes:[]`、`return_masks`（布尔）、`score_threshold`。可选Bearer使用SAM3服务凭据，不是Buddy提供方凭据。响应为`schema_version:1`、`width`、`height`和`objects:[{box:[x0,y0,x1,y1],score,mask_png}]`。坐标归一化到0～1；掩膜与提交图片等尺寸、像素值0/255。任意其他SAM3服务不保证兼容这份自定义HTTP接口。

## 检查与限制

执行`python -m unittest -q test_vision`、`node --check web/app.js`及`python -m unittest discover -s inference -p 'test_*.py'`。替身测试验证子进程成果、HTTP归属和畸形掩膜拒绝，不证明GPU推理准确率。图像校正方向并缩至最长边1600像素，JSON记录分析尺寸和原始尺寸；最多接受50个目标。每个专家持有独立会话、SQLite任务和下载。SAM3适配器串行使用GPU，并发请求返回503，应稍后重试。生产需真实权重、驱动/显存检查和Buddy到模型到文件的验收。参见[Meta SAM3](https://github.com/facebookresearch/sam3)。

## 已部署的sam3-http:v1服务

当前选择 `SAM3_API=deployed_v1`、`SAM3_URL=http://127.0.0.1:8045/v1/images/segment`。请求使用 `image_base64`、`prompt`、原图像素 `positive_boxes`、`confidence_threshold`、`max_detections:50`、`mask_format:png_base64` 和 `mask_space:original`。适配器校验图片/ROI尺寸和坐标系，将像素框归一化为xyxy，读取 `instances[].mask.data`，注意掩膜size为高、宽。截断结果和非检测分数会拒绝。两个专家复用现有服务，不需要另部署SAM3适配器；上文旧 `/segment` 格式仅适用于 `SAM3_API=adapter_v1`。正文、表单和辅助文字沿用OCR工作台放大字号、加深对比度的样式。

## 任务生命周期与结果详情

已结束任务可复用保存的原图，修改设置后重跑。显式指定替换任务，或同一用户使用相同非空任务名，会用新运行替换历史记录；运行中的任务不能替换或删除。已结束任务支持连同文件删除。近乎重合的检测在框 IoU 大于0.9时去重；精准检测还要求掩膜 IoU 大于0.9。结果记录原始数量及过滤数量。JSON/CSV 包含相对坐标及 EXIF 校正后的原图像素框，右、下边界不包含在框内。工作台提供标注图、原图、掩膜切换，置信度分布和坐标表。置信度是模型评分，不是实测准确率。
