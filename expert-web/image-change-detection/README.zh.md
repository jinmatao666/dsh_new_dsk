# 变化发现专家

[English](README.md) | 中文

本独立Buddy专家接受同一场景按前期、后期顺序上传的两张图片。将前期配准到后期，补偿全局亮度后寻找视觉差异，输出标注图和相对坐标。精准模式取两期SAM3轮廓与差异候选邻域的交集。这是疑似视觉变化筛查，不是专门训练的语义变化模型，不能证明变化原因。

## 部署

将`.env.example`复制为私有`.env`，填写本专家提供方凭据和配套版本1 SAM3适配器的完整POST地址`SAM3_URL`。`SAM3_KEY`用于可选模型服务鉴权；本专家不需要Qwen。执行`docker compose -p wanwei-image-change-detection build`和`docker compose -p wanwei-image-change-detection up -d`，Dockerfile支持`PYTHON_IMAGE`和`PIP_INDEX_URL`。host网络、`127.0.0.1:3314`、数据卷`wanwei-image-change-detection-data`、网关`/experts/image-change-detection/`、Cookie `expert_image_change_detection_session`。项目可独立构建，不读取兄弟专家源码。

## 推理与坐标

适配器请求包含`schema_version:1`、`image`（base64 PNG）、`text:""`、`boxes`（最多8个归一化xyxy提示框）、`return_masks:true`和`score_threshold`。响应要求`schema_version:1`、提交图片的`width`/`height`、`objects`中的归一化`box`、`score`及同尺寸base64 `mask_png`。交付的SAM3适配器是配套服务，不能直接换成任意第三方接口。服务不可用或缺少掩膜时不伪造精准成果。

坐标和掩膜统一对应后期分析图，左上角为原点，xyxy数值0～1。前期图变换到该坐标系，导出`aligned-before.png`及单应矩阵。输入校正方向并缩至最长边1600像素；关闭自动配准时，两图必须已对齐且尺寸一致。

## 检查与限制

执行`python -m unittest -q test_vision`和`node --check web/app.js`。替身测试验证工作进程成果、坐标范围、两图归属和不可对齐图片拒绝。真实SAM3/GPU效果、Buddy票据和原生下载需要部署验收。低纹理、重叠不足和变形过大明确失败；候选区域超过8处需裁切或调整参数。阴影、季节、视差和曝光可能误报；二值掩膜为准，导出轮廓是近似点列，带孔洞标记。取消任务不发布成果，但远端推理可能继续；更新保留数据卷和私有配置。
