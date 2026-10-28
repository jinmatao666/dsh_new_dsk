# 变化发现专家

[English](README.md) | 中文

本独立Buddy专家接受同一场景按前期、后期顺序上传的两张图片。将前期配准到后期，补偿全局亮度后寻找视觉差异，输出标注图和相对坐标。精准模式取两期SAM3轮廓与差异候选邻域的交集。这是疑似视觉变化筛查，不是专门训练的语义变化模型，不能证明变化原因。

## 部署

将`.env.example`复制为私有`.env`，填写本专家提供方凭据和配套版本1 SAM3适配器的完整POST地址`SAM3_URL`。`SAM3_KEY`用于可选模型服务鉴权；本专家不需要Qwen。执行`docker compose -p wanwei-image-change-detection build`和`docker compose -p wanwei-image-change-detection up -d`，Dockerfile支持`PYTHON_IMAGE`和`PIP_INDEX_URL`。host网络、`127.0.0.1:3314`、数据卷`wanwei-image-change-detection-data`、网关`/experts/image-change-detection/`、Cookie `expert_image_change_detection_session`。项目可独立构建，不读取兄弟专家源码。

## 推理与坐标

适配器请求包含`schema_version:1`、`image`（base64 PNG）、`text:""`、`boxes`（最多8个归一化xyxy提示框）、`return_masks:true`和`score_threshold`。响应要求`schema_version:1`、提交图片的`width`/`height`、`objects`中的归一化`box`、`score`及同尺寸base64 `mask_png`。交付的SAM3适配器是配套服务，不能直接换成任意第三方接口。服务不可用或缺少掩膜时不伪造精准成果。

坐标和掩膜统一对应后期分析图，左上角为原点，xyxy数值0～1。前期图变换到该坐标系，导出`aligned-before.png`及单应矩阵。输入校正方向并缩至最长边1600像素；关闭自动配准时，两图必须已对齐且尺寸一致。

## 检查与限制

执行`python -m unittest -q test_vision`和`node --check web/app.js`。替身测试验证工作进程成果、坐标范围、两图归属、有界平移对齐及回退行为。真实SAM3/GPU效果、Buddy票据和原生下载需要部署验收。同尺寸且无法可靠估计变换时沿用原像素位置，对齐备注会说明这种可能性。重叠不足或变形过大明确失败。候选分批处理；超过128个连通区域时使用8×8网格合并保留的像素。阴影、季节、视差和曝光可能误报；二值掩膜为准，导出轮廓是近似点列，带孔洞标记。取消任务不发布成果，但远端推理可能继续；更新保留数据卷和私有配置。

## 已部署的sam3-http:v1服务

当前选择 `SAM3_API=deployed_v1`、`SAM3_URL=http://127.0.0.1:8045/v1/images/segment`。请求使用 `image_base64`、`prompt`、原图像素 `positive_boxes`、`confidence_threshold`、`max_detections:50`、`mask_format:png_base64` 和 `mask_space:original`。适配器校验图片/ROI尺寸和坐标系，将像素框归一化为xyxy，读取 `instances[].mask.data`，注意掩膜size为高、宽。截断结果和非检测分数会拒绝。两个专家复用现有服务，不需要另部署SAM3适配器；上文旧 `/segment` 格式仅适用于 `SAM3_API=adapter_v1`。正文、表单和辅助文字沿用OCR工作台放大字号、加深对比度的样式。

## 任务生命周期与视觉核对

已结束任务可复用保存的两期图片，修改设置后重跑，通过显式任务 ID 或同一用户的相同非空任务名替换历史记录。运行中的任务不能替换或删除；已结束记录和文件支持删除。自动对齐先估计有界平移，再估计相似变换。同尺寸且未获得可靠估计时沿用原像素位置，这是候选筛查的后备方式，不证明图片已对齐。亮度、对比度补偿和区域过滤可减少外观噪声，也可能漏掉大范围变化。请结合对齐前期图、并排对比图、差异热力图、二值掩膜、坐标 CSV 和 JSON 核对。超过8处候选分批处理；超过128个连通区域时网格合并保留像素，但显示区域数会改变。真实 SAM3 精准分割和语义变化准确性仍需服务器验收。
