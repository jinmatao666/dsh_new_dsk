package model

type ImageRequest struct {
	Model          string `json:"model"`
	Prompt         string `json:"prompt" binding:"required"`
	N              int    `json:"n,omitempty"`
	Size           string `json:"size,omitempty"`
	Quality        string `json:"quality,omitempty"`
	ResponseFormat string `json:"response_format,omitempty"`
	Style          string `json:"style,omitempty"`
	User           string `json:"user,omitempty"`

	// 图像编辑（P 图）相关字段，用于 DashScope wanx2.1-imageedit 等编辑模型。
	// Function 指定编辑能力：description_edit / description_edit_with_mask /
	// expand / super_resolution / remove_watermark / colorization 等。
	// 走 base64 JSON（非 multipart）：Image / Mask 传公网 URL 或 base64。
	Function      string   `json:"function,omitempty"`
	Image         string   `json:"image,omitempty"`          // 待编辑的原图（URL 或 base64）
	Images        []string `json:"images,omitempty"`         // 多张参考图（wan2.7 multimodal：合成/多图融合，URL 或 base64）
	Mask          string   `json:"mask,omitempty"`           // 蒙版图（局部重绘用，白色为编辑区）
	Strength      float64  `json:"strength,omitempty"`       // 指令编辑强度 0.0~1.0
	UpscaleFactor int      `json:"upscale_factor,omitempty"` // 超分倍数 1~4
	TopScale      float64  `json:"top_scale,omitempty"`      // 扩图：上方外扩比例 1.0~2.0
	BottomScale   float64  `json:"bottom_scale,omitempty"`   // 扩图：下方外扩比例
	LeftScale     float64  `json:"left_scale,omitempty"`     // 扩图：左侧外扩比例
	RightScale    float64  `json:"right_scale,omitempty"`    // 扩图：右侧外扩比例
}

// IsImageEdit 判断该请求是否为图像编辑（携带 function 即视为编辑）。
func (r *ImageRequest) IsImageEdit() bool {
	return r.Function != ""
}
