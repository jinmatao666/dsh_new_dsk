# 目标检测专家

[English](README.md) | 中文

本独立Buddy专家接受一张图片和简短目标名称，调用版本1的SAM3 HTTP适配服务，导出真实标注PNG和相对坐标JSON。精准模式必须返回二值PNG掩膜，另导出`mask.png`；缺少掩膜不会用矩形冒充。未检出是明确的空结果。中文目标需配置文字翻译模型，英文目标不依赖Qwen。

## 部署

代码和已复制资源均由本目录持有。将`.env.example`复制为私有`.env`，填写本专家提供方凭据、完整POST端点`SAM3_URL`及可选`SAM3_KEY`。`EXPERT_MODEL_*`只用于中文目标翻译。配套适配器为[inference/sam3_http.py](inference/sam3_http.py)，在单独安装的官方SAM3 CUDA环境中运行，并指定本地`SAM3_CHECKPOINT`。本机端口默认3321，使用前确认空闲；不自动下载权重，也不承接Buddy登录。

执行`docker compose -p wanwei-image-object-detection build`和`docker compose -p wanwei-image-object-detection up -d`；下载源由构建参数`PYTHON_IMAGE`、`PIP_INDEX_URL`指定。host网络、`127.0.0.1:3313`、数据卷`wanwei-image-object-detection-data`、网关`/experts/image-object-detection/`、Cookie `expert_image_object_detection_session`。不加载仓库根目录或兄弟专家源码；更新保留项目名和数据卷。

## 版本1推理接口

POST `/segment`：`schema_version:1`、`image`（base64 PNG）、`text`（英文目标）、`boxes:[]`、`return_masks`（布尔）、`score_threshold`。可选Bearer使用SAM3服务凭据，不是Buddy提供方凭据。响应为`schema_version:1`、`width`、`height`和`objects:[{box:[x0,y0,x1,y1],score,mask_png}]`。坐标归一化到0～1；掩膜与提交图片等尺寸、像素值0/255。任意其他SAM3服务不保证兼容这份自定义HTTP接口。

## 检查与限制

执行`python -m unittest -q test_vision`、`node --check web/app.js`及`python -m unittest discover -s inference -p 'test_*.py'`。替身测试验证子进程成果、HTTP归属和畸形掩膜拒绝，不证明GPU推理准确率。图像校正方向并缩至最长边1600像素，JSON记录分析尺寸和原始尺寸；最多接受50个目标。每个专家持有独立会话、SQLite任务和下载。SAM3适配器串行使用GPU，并发请求返回503，应稍后重试。生产需真实权重、驱动/显存检查和Buddy到模型到文件的验收。参见[Meta SAM3](https://github.com/facebookresearch/sam3)。
